<?php

namespace App\Http\Controllers;

use App\Services\UploadQuotaService;
use App\Services\WebPushService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

class NotificationController extends Controller
{
    public function __construct(private readonly WebPushService $webPushService)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $limit = max(1, min(200, (int) $request->query('limit', 50)));
        $rows = DB::table('notifications')
            ->leftJoin('users', 'users.id', '=', 'notifications.created_by_id')
            ->select([
                'notifications.*',
                DB::raw('COALESCE(users.full_name, users.nickname, users.email) as creator_name'),
            ])
            ->whereNotNull('sent_at')
            ->orderByDesc('sent_at')
            ->limit($limit)
            ->get();

        $attachmentMap = $this->attachmentMapForNotificationIds(
            $rows->pluck('id')->map(static fn ($value): int => (int) $value)->all()
        );

        return response()->json([
            'notifications' => $rows->map(fn ($row): array => $this->mapRow($row, $attachmentMap))->values(),
        ]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $query = DB::table('notifications')
            ->leftJoin('users', 'users.id', '=', 'notifications.created_by_id')
            ->select([
                'notifications.*',
                DB::raw('COALESCE(users.full_name, users.nickname, users.email) as creator_name'),
            ])
            ->where('notifications.id', $id);

        if (!$this->isAdmin($request)) {
            $query->whereNotNull('notifications.sent_at');
        }

        $row = $query->first();
        if (!$row) {
            return response()->json(['message' => 'Notification not found.'], 404);
        }

        $attachmentMap = $this->attachmentMapForNotificationIds([(int) $row->id]);

        return response()->json([
            'notification' => $this->mapRow($row, $attachmentMap),
        ]);
    }

    public function adminIndex(Request $request): JsonResponse
    {
        $this->assertAdmin($request);

        $rows = DB::table('notifications')
            ->leftJoin('users', 'users.id', '=', 'notifications.created_by_id')
            ->select([
                'notifications.*',
                DB::raw('COALESCE(users.full_name, users.nickname, users.email) as creator_name'),
            ])
            ->orderByDesc('created_at')
            ->get();

        $attachmentMap = $this->attachmentMapForNotificationIds(
            $rows->pluck('id')->map(static fn ($value): int => (int) $value)->all()
        );

        return response()->json([
            'notifications' => $rows->map(fn ($row): array => $this->mapRow($row, $attachmentMap))->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->assertAdmin($request);

        $payload = $request->validate([
            'title' => ['required', 'string', 'max:180'],
            'body' => ['required', 'string'],
            'type' => ['nullable', 'in:info,success,warning,alert'],
            'sendNow' => ['nullable', 'boolean'],
        ]);

        $user = $request->user();

        $id = DB::table('notifications')->insertGetId([
            'title' => trim((string) $payload['title']),
            'body' => trim((string) $payload['body']),
            'type' => $this->nullableString($payload['type'] ?? null, 20),
            'created_by_id' => $user?->id,
            'sent_at' => ($payload['sendNow'] ?? false) ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        if (($payload['sendNow'] ?? false) === true) {
            $this->dispatchPushForNotification((int) $id);
        }

        return response()->json(['id' => (string) $id], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $this->assertAdmin($request);
        $this->assertNotificationEditable($id);
        $row = DB::table('notifications')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['message' => 'Notification not found.'], 404);
        }

        $payload = $request->validate([
            'title' => ['sometimes', 'string', 'max:180'],
            'body' => ['sometimes', 'string'],
            'type' => ['nullable', 'in:info,success,warning,alert'],
        ]);

        $updates = ['updated_at' => now()];
        if (array_key_exists('title', $payload)) {
            $updates['title'] = trim((string) $payload['title']);
        }
        if (array_key_exists('body', $payload)) {
            $updates['body'] = trim((string) $payload['body']);
        }
        if (array_key_exists('type', $payload)) {
            $updates['type'] = $this->nullableString($payload['type'], 20);
        }

        DB::table('notifications')->where('id', $id)->update($updates);
        return response()->json(['id' => (string) $id]);
    }

    public function send(Request $request, int $id): JsonResponse
    {
        $this->assertAdmin($request);
        $updated = DB::table('notifications')
            ->where('id', $id)
            ->whereNull('sent_at')
            ->update(['sent_at' => now(), 'updated_at' => now()]);

        if ($updated === 0) {
            $exists = DB::table('notifications')->where('id', $id)->exists();
            if (!$exists) {
                return response()->json(['message' => 'Notification not found.'], 404);
            }
        }

        $this->dispatchPushForNotification($id);

        return response()->json(['id' => (string) $id]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $this->assertAdmin($request);
        $this->assertNotificationEditable($id);

        $files = DB::table('notification_files')
            ->where('notification_id', $id)
            ->get(['storage_path']);

        $disk = config('notifications.disk', 'local');
        foreach ($files as $file) {
            $path = trim((string) ($file->storage_path ?? ''));
            if ($path !== '') {
                Storage::disk($disk)->delete($path);
            }
        }

        DB::table('notification_files')->where('notification_id', $id)->delete();
        DB::table('notifications')->where('id', $id)->delete();

        return response()->json(['deleted' => true]);
    }

    public function uploadAttachment(Request $request, int $id, UploadQuotaService $uploadQuota): JsonResponse
    {
        $this->assertAdmin($request);
        $this->assertNotificationEditable($id);

        $payload = $request->validate([
            'file' => ['required', 'file'],
        ]);

        $file = $payload['file'];
        $uploadQuota->assertCanStore((int) ($file->getSize() ?: 0));
        $disk = (string) config('notifications.disk', 'local');
        $prefix = trim((string) config('notifications.prefix', 'notifications'), '/');
        $prefix = $prefix !== '' ? $prefix : 'notifications';
        $filename = $this->normalizeStoredFilename($file, 'attachment');
        $storagePath = $this->storeNotificationAttachmentWithIncrementingName($file, $prefix, $filename, $disk);

        $attachmentId = DB::table('notification_files')->insertGetId([
            'notification_id' => $id,
            'storage_path' => $storagePath,
            'mime_type' => $file->getMimeType() ?? 'application/octet-stream',
            'size_bytes' => $file->getSize() ?: 0,
            'uploaded_by_id' => $request->user()?->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $attachmentRow = DB::table('notification_files')->where('id', $attachmentId)->first();

        return response()->json([
            'attachment' => $attachmentRow ? $this->mapAttachmentRow($attachmentRow) : null,
        ], 201);
    }

    public function deleteAttachment(Request $request, int $id, int $fileId): JsonResponse
    {
        $this->assertAdmin($request);
        $this->assertNotificationEditable($id);

        $row = DB::table('notification_files')
            ->where('id', $fileId)
            ->where('notification_id', $id)
            ->first();

        if (!$row) {
            return response()->json(['message' => 'Attachment not found.'], 404);
        }

        $disk = config('notifications.disk', 'local');
        $path = trim((string) ($row->storage_path ?? ''));
        if ($path !== '') {
            Storage::disk($disk)->delete($path);
        }

        DB::table('notification_files')->where('id', $fileId)->delete();

        return response()->json(['deleted' => true]);
    }

    public function downloadAttachment(Request $request, int $fileId)
    {
        $row = DB::table('notification_files')
            ->join('notifications', 'notifications.id', '=', 'notification_files.notification_id')
            ->select([
                'notification_files.storage_path',
                'notifications.sent_at',
            ])
            ->where('notification_files.id', $fileId)
            ->first();

        if (!$row) {
            abort(404, 'Attachment not found.');
        }

        if (!$row->sent_at && !$this->isAdmin($request)) {
            abort(response()->json(['message' => 'Forbidden.'], 403));
        }

        $disk = config('notifications.disk', 'local');
        $path = trim((string) ($row->storage_path ?? ''));
        if ($path === '' || !Storage::disk($disk)->exists($path)) {
            abort(404, 'Attachment not found in storage.');
        }

        return Storage::disk($disk)->download($path, $this->filenameFromStoragePath($path));
    }

    public function getLastRead(Request $request, int $userId): JsonResponse
    {
        $this->assertSelfOrAdmin($request, $userId);
        $row = DB::table('user_notification_reads')->where('user_id', $userId)->first();

        return response()->json([
            'lastReadAt' => $row?->last_read_at,
        ]);
    }

    public function markRead(Request $request, int $userId): JsonResponse
    {
        $this->assertSelfOrAdmin($request, $userId);

        $payload = $request->validate([
            'notificationId' => ['nullable', 'integer', 'min:1'],
        ]);

        $targetReadAt = Carbon::now();

        $notificationId = isset($payload['notificationId']) ? (int) $payload['notificationId'] : 0;
        if ($notificationId > 0) {
            $sentAt = DB::table('notifications')
                ->where('id', $notificationId)
                ->whereNotNull('sent_at')
                ->value('sent_at');

            if (!$sentAt) {
                return response()->json(['message' => 'Notification not found.'], 404);
            }

            $targetReadAt = Carbon::parse((string) $sentAt);
        }

        $currentLastReadAt = DB::table('user_notification_reads')
            ->where('user_id', $userId)
            ->value('last_read_at');

        if ($currentLastReadAt) {
            $currentRead = Carbon::parse((string) $currentLastReadAt);
            if ($currentRead->gt($targetReadAt)) {
                $targetReadAt = $currentRead;
            }
        }

        DB::table('user_notification_reads')->updateOrInsert(
            ['user_id' => $userId],
            [
                'last_read_at' => $targetReadAt,
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );

        return response()->json(['ok' => true]);
    }

    public function unreadCount(Request $request, int $userId): JsonResponse
    {
        $this->assertSelfOrAdmin($request, $userId);
        $row = DB::table('user_notification_reads')->where('user_id', $userId)->first();
        $query = DB::table('notifications')->whereNotNull('sent_at');
        if ($row?->last_read_at) {
            $query->where('sent_at', '>', $row->last_read_at);
        }
        return response()->json(['count' => $query->count()]);
    }

    public function getPushPublicKey(Request $request): JsonResponse
    {
        $request->user();
        $publicKey = trim((string) config('services.webpush.public_key', ''));
        return response()->json([
            'publicKey' => $publicKey,
            'configured' => $publicKey !== '',
        ]);
    }

    public function upsertPushSubscription(Request $request): JsonResponse
    {
        $user = $request->user();

        $payload = $request->validate([
            'endpoint' => ['required', 'string', 'max:4000'],
            'keys' => ['required', 'array'],
            'keys.p256dh' => ['required', 'string', 'max:1000'],
            'keys.auth' => ['required', 'string', 'max:1000'],
            'contentEncoding' => ['nullable', 'string', 'max:32'],
        ]);

        $endpoint = trim((string) $payload['endpoint']);
        if ($endpoint === '') {
            return response()->json(['message' => 'Invalid endpoint.'], 422);
        }

        $endpointHash = hash('sha256', $endpoint);
        DB::table('push_subscriptions')->updateOrInsert(
            ['endpoint_hash' => $endpointHash],
            [
                'user_id' => (int) $user->id,
                'endpoint' => $endpoint,
                'public_key' => trim((string) ($payload['keys']['p256dh'] ?? '')),
                'auth_token' => trim((string) ($payload['keys']['auth'] ?? '')),
                'content_encoding' => $this->nullableString($payload['contentEncoding'] ?? null, 32),
                'user_agent' => $this->nullableString($request->userAgent(), 500),
                'last_seen_at' => now(),
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );

        return response()->json(['ok' => true]);
    }

    public function deletePushSubscription(Request $request): JsonResponse
    {
        $user = $request->user();
        $payload = $request->validate([
            'endpoint' => ['required', 'string', 'max:4000'],
        ]);

        $endpoint = trim((string) $payload['endpoint']);
        if ($endpoint === '') {
            return response()->json(['ok' => true]);
        }

        DB::table('push_subscriptions')
            ->where('user_id', (int) $user->id)
            ->where('endpoint_hash', hash('sha256', $endpoint))
            ->delete();

        return response()->json(['ok' => true]);
    }

    private function mapRow(object $row, array $attachmentMap = []): array
    {
        $notificationId = (int) $row->id;

        return [
            'id' => (string) $row->id,
            'title' => (string) $row->title,
            'body' => (string) $row->body,
            'type' => $row->type ? (string) $row->type : null,
            'attachments' => $attachmentMap[$notificationId] ?? [],
            'createdAt' => $row->created_at,
            'createdBy' => $row->created_by_id ? (string) $row->created_by_id : '',
            'createdByName' => $row->creator_name ? (string) $row->creator_name : '',
            'sentAt' => $row->sent_at,
        ];
    }

    private function mapAttachmentRow(object $row): array
    {
        $path = trim((string) ($row->storage_path ?? ''));

        return [
            'id' => (int) $row->id,
            'name' => $this->filenameFromStoragePath($path),
            'mimeType' => $row->mime_type ? (string) $row->mime_type : 'application/octet-stream',
            'sizeBytes' => (int) ($row->size_bytes ?? 0),
            'downloadUrl' => '/api/notifications/attachments/' . (int) $row->id,
            'createdAt' => $row->created_at ?? null,
        ];
    }

    private function attachmentMapForNotificationIds(array $notificationIds): array
    {
        $ids = array_values(array_unique(array_filter(
            array_map(static fn ($id): int => (int) $id, $notificationIds),
            static fn (int $id): bool => $id > 0
        )));

        if (empty($ids)) {
            return [];
        }

        $rows = DB::table('notification_files')
            ->whereIn('notification_id', $ids)
            ->orderBy('id')
            ->get();

        $map = [];
        foreach ($rows as $row) {
            $notificationId = (int) $row->notification_id;
            if (!array_key_exists($notificationId, $map)) {
                $map[$notificationId] = [];
            }
            $map[$notificationId][] = $this->mapAttachmentRow($row);
        }

        return $map;
    }

    private function isAdmin(Request $request): bool
    {
        $access = strtolower((string) ($request->user()?->access_level ?? ''));
        return $access === 'admin';
    }

    private function assertAdmin(Request $request): void
    {
        if (!$this->isAdmin($request)) {
            abort(response()->json(['message' => 'Admin access required.'], 403));
        }
    }

    private function assertSelfOrAdmin(Request $request, int $userId): void
    {
        $isAdmin = $this->isAdmin($request);
        $isSelf = (int) ($request->user()?->id ?? 0) === $userId;
        if (!$isAdmin && !$isSelf) {
            abort(response()->json(['message' => 'Forbidden.'], 403));
        }
    }

    private function assertNotificationEditable(int $notificationId): void
    {
        $row = DB::table('notifications')->where('id', $notificationId)->first();

        if (!$row) {
            abort(response()->json(['message' => 'Notification not found.'], 404));
        }

        if ($row->sent_at) {
            abort(response()->json([
                'message' => 'Sent notifications cannot be modified.',
            ], 409));
        }
    }

    private function normalizeStoredFilename(UploadedFile $file, string $fallback): string
    {
        $candidate = trim((string) $file->getClientOriginalName());
        if ($candidate === '') {
            $candidate = $fallback;
        }

        $candidate = html_entity_decode($candidate, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $candidate = (string) preg_replace('/[\/\\\\]+/', '-', $candidate);
        $candidate = (string) preg_replace('/[^A-Za-z0-9._ -]+/', '_', $candidate);
        $candidate = trim($candidate, " .\t\n\r\0\x0B");

        if ($candidate === '') {
            $candidate = $fallback;
        }

        $extension = strtolower((string) pathinfo($candidate, PATHINFO_EXTENSION));
        if ($extension === '') {
            $guessed = strtolower(trim((string) $file->getClientOriginalExtension()));
            if ($guessed !== '') {
                $candidate .= '.' . $guessed;
            }
        }

        return $candidate;
    }

    private function storeNotificationAttachmentWithIncrementingName(
        UploadedFile $file,
        string $prefix,
        string $filename,
        string $disk
    ): string {
        $storage = Storage::disk($disk);
        $baseName = (string) pathinfo($filename, PATHINFO_FILENAME);
        $extension = (string) pathinfo($filename, PATHINFO_EXTENSION);

        for ($attempt = 1; $attempt <= 1000; $attempt++) {
            $candidateName = $attempt === 1
                ? $filename
                : $this->appendNumericSuffixToFilename($baseName, $extension, $attempt);
            $candidatePath = $prefix . '/' . $candidateName;

            $record = DB::table('notification_files')->where('storage_path', $candidatePath)->first();
            $fileExists = $storage->exists($candidatePath);

            if ($record !== null && !$fileExists) {
                DB::table('notification_files')->where('storage_path', $candidatePath)->delete();
                $record = null;
            }

            if ($record === null && !$fileExists) {
                $storedPath = $file->storeAs($prefix, $candidateName, ['disk' => $disk]);
                if ($storedPath === false || $storedPath === '') {
                    throw new \RuntimeException('Unable to store notification attachment.');
                }

                return $storedPath;
            }
        }

        $fallbackName = Str::uuid()->toString() . '-' . $filename;
        $storedPath = $file->storeAs($prefix, $fallbackName, ['disk' => $disk]);
        if ($storedPath === false || $storedPath === '') {
            throw new \RuntimeException('Unable to store notification attachment.');
        }

        return $storedPath;
    }

    private function appendNumericSuffixToFilename(string $baseName, string $extension, int $attempt): string
    {
        $suffix = ' (' . $attempt . ')';
        if ($extension === '') {
            return $baseName . $suffix;
        }

        return $baseName . $suffix . '.' . $extension;
    }

    private function filenameFromStoragePath(string $path): string
    {
        $name = trim((string) pathinfo($path, PATHINFO_BASENAME));
        return $name !== '' ? $name : 'file';
    }

    private function nullableString(mixed $value, int $max): ?string
    {
        $text = trim((string) ($value ?? ''));
        if ($text === '') {
            return null;
        }
        return substr($text, 0, $max);
    }

    private function dispatchPushForNotification(int $notificationId): void
    {
        try {
            $row = DB::table('notifications')->where('id', $notificationId)->first();
            if (!$row || !$row->sent_at) {
                return;
            }

            $subscriptions = DB::table('push_subscriptions')
                ->select(['endpoint', 'public_key', 'auth_token', 'content_encoding'])
                ->get();

            $targetUrl = '/notifications/' . $notificationId;

            $result = $this->webPushService->sendToMany(
                $subscriptions,
                (string) $row->title,
                (string) $row->body,
                $targetUrl,
                $notificationId
            );

            $expiredEndpoints = array_values(array_filter(
                $result['expiredEndpoints'] ?? [],
                static fn ($value): bool => is_string($value) && $value !== ''
            ));
            if (!empty($expiredEndpoints)) {
                $expiredHashes = array_map(
                    static fn (string $endpoint): string => hash('sha256', $endpoint),
                    $expiredEndpoints
                );
                DB::table('push_subscriptions')->whereIn('endpoint_hash', $expiredHashes)->delete();
            }
        } catch (Throwable $e) {
            Log::error('Failed to dispatch push notification', [
                'notification_id' => $notificationId,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
