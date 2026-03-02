<?php

namespace App\Http\Controllers;

use App\Services\AdminUndoService;
use App\Services\ReportTemplateStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

class ReportsController extends Controller
{
    private const BACKUP_TTL_DAYS = 90;
    private const LOGO_DISK = 'local';
    private const LOGO_FILENAME = 'report_logo';
    private const LOGO_MAX_KB = 5120;
    private const ALLOWED_LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
    public function __construct(
        private readonly ReportTemplateStore $reportTemplateStore,
        private readonly AdminUndoService $adminUndoService
    ) {
    }

    public function show(): JsonResponse
    {
        return response()->json([
            'reports' => $this->reportTemplateStore->list(),
        ]);
    }

    public function showLogo()
    {
        $path = $this->currentLogoPath();
        if ($path === null) {
            return response()->json([
                'message' => 'Report logo not found.',
            ], 404);
        }

        $storage = Storage::disk(self::LOGO_DISK);
        if (!$storage->exists($path)) {
            return response()->json([
                'message' => 'Report logo not found.',
            ], 404);
        }

        $headers = [];
        $mimeType = $storage->mimeType($path);
        if (is_string($mimeType) && $mimeType !== '') {
            $headers['Content-Type'] = $mimeType;
        }

        return response()->file($storage->path($path), $headers);
    }

    public function update(Request $request): JsonResponse
    {
        $actorId = $request->user()?->id;
        $payload = $request->validate([
            'reports' => ['present', 'array'],
        ]);

        $reports = $this->reportTemplateStore->normalize(
            is_array($payload['reports'] ?? null) ? $payload['reports'] : []
        );
        $now = now();
        $savedReports = DB::transaction(function () use ($actorId, $now, $reports): array {
            $existingReports = $this->reportTemplateStore->list();
            $snapshotSummary = $this->buildReportSnapshotSummary($existingReports, $reports);

            $this->adminUndoService->recordReportsSnapshot($actorId, $snapshotSummary);

            if ($existingReports !== []) {
                DB::table('report_backups')->insert([
                    'data' => json_encode($existingReports, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]',
                    'created_by' => $actorId,
                    'expires_at' => $now->copy()->addDays(self::BACKUP_TTL_DAYS),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            return $this->reportTemplateStore->replace($reports, $actorId);
        });

        return response()->json([
            'saved' => true,
            'reports' => $savedReports,
        ]);
    }

    public function uploadLogo(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'file' => [
                'required',
                'file',
                'image',
                'mimes:' . implode(',', self::ALLOWED_LOGO_EXTENSIONS),
                'max:' . self::LOGO_MAX_KB,
            ],
        ]);

        /** @var UploadedFile $file */
        $file = $payload['file'];
        $this->deleteLogoFiles();

        $extension = $this->logoExtension($file);
        $filename = self::LOGO_FILENAME . '.' . $extension;
        $storedPath = $file->storeAs('', $filename, ['disk' => self::LOGO_DISK]);

        if (!is_string($storedPath) || $storedPath === '') {
            throw new \RuntimeException('Unable to store report logo.');
        }

        return response()->json([
            'saved' => true,
            'path' => $storedPath,
        ]);
    }

    public function deleteLogo(): JsonResponse
    {
        $this->deleteLogoFiles();

        return response()->json([
            'deleted' => true,
        ]);
    }

    public function backups(): JsonResponse
    {
        $rows = DB::table('report_backups as b')
            ->leftJoin('users as u', 'u.id', '=', 'b.created_by')
            ->where(function ($query): void {
                $query->whereNull('b.expires_at')->orWhere('b.expires_at', '>=', now());
            })
            ->orderByDesc('b.created_at')
            ->limit(50)
            ->get([
                'b.id',
                'b.data',
                'b.created_at',
                'b.expires_at',
                'u.nickname as created_by_nickname',
                'u.full_name as created_by_full_name',
            ]);

        $backups = $rows->map(function ($row): array {
            return [
                'id' => (string) $row->id,
                'data' => $this->decodeReports($row->data ?? null),
                'createdAt' => $this->toIsoOrNull($row->created_at),
                'expiresAt' => $this->toIsoOrNull($row->expires_at),
                'updatedBy' => $this->firstNonEmpty([
                    (string) ($row->created_by_nickname ?? ''),
                    (string) ($row->created_by_full_name ?? ''),
                ]),
            ];
        })->values();

        return response()->json(['backups' => $backups]);
    }

    public function deleteBackup(int $id): JsonResponse
    {
        DB::table('report_backups')->where('id', $id)->delete();
        return response()->json(['deleted' => true]);
    }

    private function decodeReports(mixed $raw): array
    {
        if (is_array($raw)) {
            return $this->reportTemplateStore->normalize($raw);
        }

        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                return $this->reportTemplateStore->normalize($decoded);
            }
        }

        return [];
    }

    private function toIsoOrNull(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse((string) $value)->toIso8601String();
        } catch (Throwable) {
            return null;
        }
    }

    private function firstNonEmpty(array $values): ?string
    {
        foreach ($values as $value) {
            $text = trim((string) $value);
            if ($text !== '') {
                return $text;
            }
        }

        return null;
    }

    private function currentLogoPath(): ?string
    {
        $prefix = self::LOGO_FILENAME . '.';
        foreach (Storage::disk(self::LOGO_DISK)->files('') as $path) {
            if (str_starts_with(trim((string) $path), $prefix)) {
                return trim((string) $path);
            }
        }

        return null;
    }

    private function deleteLogoFiles(): void
    {
        $prefix = self::LOGO_FILENAME . '.';
        $toDelete = array_values(array_filter(
            Storage::disk(self::LOGO_DISK)->files(''),
            fn($path) => str_starts_with(trim((string) $path), $prefix),
        ));
        if ($toDelete !== []) {
            Storage::disk(self::LOGO_DISK)->delete($toDelete);
        }
    }

    private function logoExtension(UploadedFile $file): string
    {
        $candidates = [
            strtolower(trim((string) $file->getClientOriginalExtension())),
            strtolower(trim((string) $file->extension())),
        ];

        foreach ($candidates as $candidate) {
            if (in_array($candidate, self::ALLOWED_LOGO_EXTENSIONS, true)) {
                return $candidate;
            }
        }

        return 'png';
    }

    private function buildReportSnapshotSummary(array $existingReports, array $nextReports): string
    {
        $existingById = $this->mapReportsById($existingReports);
        $nextById = $this->mapReportsById($nextReports);
        $added = [];
        $updated = [];
        $removed = [];

        foreach ($nextById as $reportId => $report) {
            if (!array_key_exists($reportId, $existingById)) {
                $added[] = $report;
                continue;
            }

            if (json_encode($existingById[$reportId]) !== json_encode($report)) {
                $updated[] = $report;
            }
        }

        foreach ($existingById as $reportId => $report) {
            if (!array_key_exists($reportId, $nextById)) {
                $removed[] = $report;
            }
        }

        if (count($added) === 1 && $updated === [] && $removed === []) {
            return 'after adding ' . $this->reportTitleForSummary($added[0]);
        }

        if (count($updated) === 1 && $added === [] && $removed === []) {
            return 'after editing ' . $this->reportTitleForSummary($updated[0]);
        }

        if (count($removed) === 1 && $added === [] && $updated === []) {
            return 'after deleting ' . $this->reportTitleForSummary($removed[0]);
        }

        if ($added === [] && $updated === [] && $removed === []) {
            if (array_keys($existingById) !== array_keys($nextById)) {
                return 'after reordering report templates';
            }

            return 'after editing report templates';
        }

        if ($nextById === []) {
            return 'after deleting all report templates';
        }

        return 'after editing report templates';
    }

    private function mapReportsById(array $reports): array
    {
        $mapped = [];
        foreach (array_values($reports) as $index => $report) {
            if (!is_array($report)) {
                continue;
            }

            $reportId = trim((string) ($report['id'] ?? ''));
            $key = $reportId !== '' ? $reportId : 'report-' . $index;
            $mapped[$key] = $report;
        }

        return $mapped;
    }

    private function reportTitleForSummary(array $report): string
    {
        $title = trim((string) ($report['title'] ?? ''));
        if ($title === '') {
            return 'Untitled';
        }

        if (strlen($title) <= 60) {
            return $title;
        }

        return rtrim(substr($title, 0, 57)) . '...';
    }
}
