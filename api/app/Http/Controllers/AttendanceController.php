<?php

namespace App\Http\Controllers;

use App\Models\AttendanceMeeting;
use App\Models\AttendanceRecord;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class AttendanceController extends Controller
{
    public function adminIndex(Request $request): JsonResponse
    {
        $this->assertAdmin($request);

        $meetings = AttendanceMeeting::query()
            ->withCount(['expectedUsers', 'records'])
            ->orderByDesc('starts_at')
            ->limit(100)
            ->get()
            ->map(fn (AttendanceMeeting $meeting): array => $this->mapMeeting($meeting));

        return response()->json(['meetings' => $meetings]);
    }

    public function adminShow(Request $request, int $id): JsonResponse
    {
        $this->assertAdmin($request);

        $meeting = AttendanceMeeting::query()
            ->with(['expectedUsers.agency:id,code,name'])
            ->findOrFail($id);

        $records = AttendanceRecord::query()
            ->with(['user.agency:id,code,name', 'marker:id,nickname,full_name,email'])
            ->where('meeting_id', $meeting->id)
            ->get()
            ->keyBy('user_id');

        $expected = $meeting->expectedUsers;
        if ($expected->isEmpty()) {
            $expected = User::query()
                ->with('agency:id,code,name')
                ->where('is_active', true)
                ->orderBy('agency_id')
                ->orderBy('fsc_code')
                ->get();
        }

        $attendance = $expected
            ->map(function (User $user) use ($records): array {
                $record = $records->get($user->id);
                return $this->mapAttendanceUser($user, $record);
            })
            ->sortBy([
                ['agencyCode', 'asc'],
                ['fscCode', 'asc'],
            ])
            ->values();

        return response()->json([
            'meeting' => $this->mapMeeting($meeting),
            'attendance' => $attendance,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->assertAdmin($request);

        $payload = $request->validate([
            'title' => ['required', 'string', 'max:180'],
            'description' => ['nullable', 'string'],
            'startsAt' => ['required', 'date'],
            'endsAt' => ['nullable', 'date', 'after_or_equal:startsAt'],
            'location' => ['nullable', 'string', 'max:180'],
            'attendeeMode' => ['nullable', Rule::in(['all', 'selected'])],
            'attendeeUserIds' => ['nullable', 'array'],
            'attendeeUserIds.*' => ['integer', 'exists:users,id'],
        ]);

        $startsAt = Carbon::parse((string) $payload['startsAt']);
        $endsAt = isset($payload['endsAt']) && $payload['endsAt']
            ? Carbon::parse((string) $payload['endsAt'])
            : $startsAt->copy()->addMinutes(15);

        $meeting = DB::transaction(function () use ($payload, $request, $startsAt, $endsAt): AttendanceMeeting {
            $meeting = AttendanceMeeting::query()->create([
                'title' => trim((string) $payload['title']),
                'description' => trim((string) ($payload['description'] ?? '')) ?: null,
                'starts_at' => $startsAt,
                'ends_at' => $endsAt,
                'location' => trim((string) ($payload['location'] ?? '')) ?: null,
                'check_in_token' => Str::random(48),
                'created_by_id' => $request->user()?->id,
            ]);

            if (($payload['attendeeMode'] ?? 'all') === 'selected') {
                $ids = collect($payload['attendeeUserIds'] ?? [])
                    ->map(static fn ($value): int => (int) $value)
                    ->filter()
                    ->unique()
                    ->values()
                    ->all();
                $meeting->expectedUsers()->sync($ids);
            }

            return $meeting;
        });

        return response()->json(['meeting' => $this->mapMeeting($meeting)], 201);
    }

    public function checkIn(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'token' => ['required', 'string', 'max:128'],
        ]);

        $meeting = AttendanceMeeting::query()
            ->where('check_in_token', trim((string) $payload['token']))
            ->first();
        if (!$meeting) {
            return response()->json(['message' => 'Invalid attendance QR code.'], 404);
        }

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($meeting->ends_at && now()->greaterThan($meeting->ends_at)) {
            return response()->json(['message' => 'This meeting check-in has closed.'], 422);
        }

        if ($meeting->expectedUsers()->exists() && !$meeting->expectedUsers()->whereKey($user->id)->exists()) {
            return response()->json(['message' => 'You are not in the expected attendee list for this meeting.'], 403);
        }

        $checkedInAt = now();
        $record = AttendanceRecord::query()->firstOrCreate(
            [
                'meeting_id' => $meeting->id,
                'user_id' => $user->id,
            ],
            [
                'status' => $this->resolveStatus($meeting, $checkedInAt),
                'checked_in_at' => $checkedInAt,
            ]
        );

        return response()->json([
            'meeting' => $this->mapMeeting($meeting),
            'record' => $this->mapRecord($record->fresh()),
            'duplicate' => !$record->wasRecentlyCreated,
        ]);
    }

    public function myHistory(Request $request): JsonResponse
    {
        $user = $request->user();
        $records = AttendanceRecord::query()
            ->with('meeting')
            ->where('user_id', $user?->id)
            ->orderByDesc('checked_in_at')
            ->orderByDesc('id')
            ->limit(100)
            ->get()
            ->map(fn (AttendanceRecord $record): array => [
                ...$this->mapRecord($record),
                'meeting' => $this->mapMeeting($record->meeting),
            ]);

        return response()->json(['records' => $records]);
    }

    public function mark(Request $request, int $meetingId): JsonResponse
    {
        $this->assertAdmin($request);

        $payload = $request->validate([
            'userId' => ['required', 'integer', 'exists:users,id'],
            'status' => ['required', Rule::in(['present', 'late', 'absent', 'excused'])],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $meeting = AttendanceMeeting::query()->findOrFail($meetingId);
        $userId = (int) $payload['userId'];
        $status = (string) $payload['status'];

        $record = AttendanceRecord::query()->updateOrCreate(
            [
                'meeting_id' => $meeting->id,
                'user_id' => $userId,
            ],
            [
                'status' => $status,
                'checked_in_at' => in_array($status, ['present', 'late'], true) ? now() : null,
                'marked_by_id' => $request->user()?->id,
                'note' => trim((string) ($payload['note'] ?? '')) ?: null,
            ]
        );

        return response()->json(['record' => $this->mapRecord($record)]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $this->assertAdmin($request);

        AttendanceMeeting::query()->findOrFail($id)->delete();

        return response()->json(['deleted' => true]);
    }

    private function resolveStatus(AttendanceMeeting $meeting, Carbon $checkedInAt): string
    {
        return $checkedInAt->greaterThan($meeting->starts_at->copy()->addMinutes(15))
            ? 'late'
            : 'present';
    }

    private function mapMeeting(?AttendanceMeeting $meeting): array
    {
        if (!$meeting) {
            return [];
        }

        return [
            'id' => (string) $meeting->id,
            'title' => $meeting->title,
            'description' => $meeting->description ?? '',
            'startsAt' => $meeting->starts_at?->toIso8601String(),
            'endsAt' => $meeting->ends_at?->toIso8601String(),
            'location' => $meeting->location ?? '',
            'checkInToken' => $meeting->check_in_token,
            'expectedCount' => $meeting->expected_users_count ?? null,
            'presentCount' => $meeting->records_count ?? null,
        ];
    }

    private function mapAttendanceUser(User $user, ?AttendanceRecord $record): array
    {
        return [
            'userId' => (string) $user->id,
            'nickname' => $user->nickname ?? '',
            'fullName' => $user->full_name ?? '',
            'email' => $user->email ?? '',
            'fscCode' => $user->fsc_code ?? '',
            'agencyCode' => $user->agency?->code ?? '',
            'status' => $record?->status ?? 'absent',
            'checkedInAt' => $record?->checked_in_at?->toIso8601String(),
            'note' => $record?->note ?? '',
            'markedBy' => $record?->marker
                ? ($record->marker->full_name ?: $record->marker->nickname ?: $record->marker->email)
                : '',
        ];
    }

    private function mapRecord(?AttendanceRecord $record): array
    {
        if (!$record) {
            return [];
        }

        return [
            'id' => (string) $record->id,
            'meetingId' => (string) $record->meeting_id,
            'userId' => (string) $record->user_id,
            'status' => $record->status,
            'checkedInAt' => $record->checked_in_at?->toIso8601String(),
            'note' => $record->note ?? '',
        ];
    }

    private function assertAdmin(Request $request): void
    {
        $access = strtolower(trim((string) ($request->user()?->access_level ?? '')));
        if ($access !== 'admin') {
            abort(response()->json(['message' => 'Admin access required.'], 403));
        }
    }
}
