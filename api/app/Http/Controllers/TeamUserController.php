<?php

namespace App\Http\Controllers;

use App\Models\Agency;
use App\Models\User;
use App\Services\AdminUndoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class TeamUserController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $this->assertAdmin($request);

        $payload = $request->validate([
            'email' => ['required', 'email:rfc', 'max:255', 'unique:users,email'],
            'fscCode' => ['required', 'digits:5', 'unique:users,fsc_code'],
            'agencyCode' => ['required', 'string', 'max:50'],
            'accessLevel' => ['nullable', Rule::in(['admin', 'editor', 'standard', ''])],
            'nickname' => ['nullable', 'string', 'max:100'],
            'fullName' => ['nullable', 'string', 'max:150'],
        ]);

        $agency = $this->resolveAgency($payload['agencyCode']);
        $access = $this->normalizeAccessLevel((string) ($payload['accessLevel'] ?? 'standard'));
        $nickname = $this->normalizeNickname((string) ($payload['nickname'] ?? ''));
        $this->assertActiveNicknameAvailable($nickname);
        $actorId = $request->user()?->id;
        $user = DB::transaction(function () use ($payload, $agency, $access, $nickname, $actorId): User {
            $undoService = app(AdminUndoService::class);
            $snapshotPayload = $undoService->captureTeamSnapshotPayload();

            $user = User::query()->create([
                'email' => strtolower(trim($payload['email'])),
                'fsc_code' => (string) $payload['fscCode'],
                'agency_id' => $agency->id,
                'access_level' => $access,
                'nickname' => $nickname !== '' ? $nickname : null,
                'full_name' => trim((string) ($payload['fullName'] ?? '')),
                'is_active' => true,
            ]);

            $undoService->recordTeamSnapshotPayload(
                $snapshotPayload,
                $actorId,
                $this->buildCreateUserSnapshotSummary($user)
            );

            return $user;
        });

        return response()->json(['uid' => (string) $user->id], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $actor = $request->user();
        $target = User::query()->findOrFail($id);

        $access = $this->normalizeAccessLevel((string) ($actor?->access_level ?? ''));
        $isAdmin = $access === 'admin';
        $isSelf = (int) $actor?->id === (int) $target->id;
        if (!$isAdmin && !$isSelf) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $payload = $request->validate([
            'email' => ['required', 'email:rfc', 'max:255', Rule::unique('users', 'email')->ignore($target->id)],
            'fscCode' => ['required', 'digits:5', Rule::unique('users', 'fsc_code')->ignore($target->id)],
            'agencyCode' => ['required', 'string', 'max:50'],
            'accessLevel' => ['nullable', Rule::in(['admin', 'editor', 'standard', ''])],
            'nickname' => ['nullable', 'string', 'max:100'],
            'fullName' => ['nullable', 'string', 'max:150'],
            'birthDate' => ['nullable', 'date_format:Y-m-d'],
            'contractDate' => ['nullable', 'date_format:Y-m-d'],
        ]);

        if (!$isAdmin) {
            $payload['accessLevel'] = $target->access_level;
            $payload['fscCode'] = $target->fsc_code;
        }

        $agency = $this->resolveAgency($payload['agencyCode']);
        $nickname = $this->normalizeNickname((string) ($payload['nickname'] ?? ''));
        $this->assertActiveNicknameAvailable($nickname, (int) $target->id);
        $snapshotSummary = $this->buildUpdateUserSnapshotSummary($target, $payload);

        DB::transaction(function () use ($target, $payload, $agency, $nickname, $actor, $snapshotSummary): void {
            app(AdminUndoService::class)->recordTeamSnapshot($actor?->id, $snapshotSummary);

            $target->update([
                'email' => strtolower(trim($payload['email'])),
                'fsc_code' => (string) $payload['fscCode'],
                'agency_id' => $agency->id,
                'access_level' => $this->normalizeAccessLevel(
                    (string) ($payload['accessLevel'] ?? $target->access_level),
                    (string) $target->access_level,
                ),
                'nickname' => $nickname !== '' ? $nickname : null,
                'full_name' => trim((string) ($payload['fullName'] ?? '')),
                'birth_date' => ($payload['birthDate'] ?? null) ?: null,
                'contract_date' => ($payload['contractDate'] ?? null) ?: null,
            ]);
        });

        return response()->json(['uid' => (string) $target->id]);
    }

    public function bulkUpdateAgency(Request $request): JsonResponse
    {
        $this->assertAdmin($request);

        $payload = $request->validate([
            'updates' => ['required', 'array', 'min:1'],
            'updates.*.uid' => ['required'],
            'updates.*.agencyCode' => ['required', 'string', 'max:50'],
        ]);

        $updated = 0;
        $actor = $request->user();
        $snapshotSummary = $this->buildBulkAgencySnapshotSummary($payload['updates']);
        DB::transaction(function () use ($payload, &$updated, $actor, $snapshotSummary): void {
            app(AdminUndoService::class)->recordTeamSnapshot($actor?->id, $snapshotSummary);

            foreach ($payload['updates'] as $entry) {
                $user = User::query()->find((int) $entry['uid']);
                if (!$user) {
                    continue;
                }
                $agency = $this->resolveAgency((string) $entry['agencyCode']);
                $user->update([
                    'agency_id' => $agency->id,
                ]);
                $updated++;
            }
        });

        return response()->json(['updated' => $updated]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $this->assertAdmin($request);

        $target = User::query()->findOrFail($id);
        if ((int) $request->user()?->id === (int) $target->id) {
            return response()->json(['message' => 'Admin cannot delete own account.'], 422);
        }

        $actor = $request->user();
        $snapshotSummary = $this->buildDeleteUserSnapshotSummary($target);
        DB::transaction(function () use ($target, $actor, $snapshotSummary): void {
            app(AdminUndoService::class)->recordTeamSnapshot($actor?->id, $snapshotSummary);

            $target->tokens()->delete();
            if ($target->is_active) {
                $target->update([
                    'is_active' => false,
                ]);
            }
        });

        return response()->json(['uid' => (string) $id]);
    }

    private function assertAdmin(Request $request): void
    {
        $access = $this->normalizeAccessLevel((string) ($request->user()?->access_level ?? ''));
        if ($access !== 'admin') {
            abort(response()->json(['message' => 'Admin access required.'], 403));
        }
    }

    private function resolveAgency(string $code): Agency
    {
        $trimmed = trim($code);
        return Agency::query()->firstOrCreate(
            ['code' => $trimmed],
            ['name' => $trimmed, 'position' => 0]
        );
    }

    private function normalizeAccessLevel(string $incoming, string $fallback = 'standard'): string
    {
        $value = strtolower(trim($incoming));
        if ($value === '') {
            $value = strtolower(trim($fallback)) ?: 'standard';
        }

        return match ($value) {
            'superadmin', 'director', 'admin' => 'admin',
            'editor' => 'editor',
            'standard' => 'standard',
            default => 'standard',
        };
    }

    private function normalizeNickname(string $incoming): string
    {
        return trim($incoming);
    }

    private function assertActiveNicknameAvailable(string $nickname, ?int $ignoreUserId = null): void
    {
        if ($nickname === '') {
            return;
        }

        $query = User::query()
            ->where('is_active', true)
            ->whereRaw('LOWER(TRIM(`nickname`)) = ?', [strtolower($nickname)]);

        if ($ignoreUserId !== null) {
            $query->where('id', '<>', $ignoreUserId);
        }

        if ($query->exists()) {
            throw ValidationException::withMessages([
                'nickname' => 'Nickname is already used by an active user.',
            ]);
        }
    }

    private function buildCreateUserSnapshotSummary(User $user): string
    {
        return $this->buildTeamMemberSnapshotSummary(
            'adding',
            (int) $user->id,
            $this->teamMemberSummaryLabel(
                (string) ($user->nickname ?? ''),
                strtolower(trim((string) ($user->email ?? '')))
            )
        );
    }

    private function buildUpdateUserSnapshotSummary(User $target, array $payload): string
    {
        return $this->buildTeamMemberSnapshotSummary(
            'editing',
            (int) $target->id,
            $this->teamMemberSummaryLabel(
                (string) ($payload['nickname'] ?? $target->nickname ?? ''),
                strtolower(trim((string) ($payload['email'] ?? $target->email ?? '')))
            )
        );
    }

    private function buildBulkAgencySnapshotSummary(array $updates): string
    {
        if (count($updates) === 1 && is_array($updates[0] ?? null)) {
            $entry = $updates[0];
            $user = User::query()->find((int) ($entry['uid'] ?? 0));
            if ($user) {
                return $this->buildTeamMemberSnapshotSummary(
                    'editing',
                    (int) $user->id,
                    $this->teamMemberSummaryLabel(
                        (string) ($user->nickname ?? ''),
                        (string) ($user->email ?? '')
                    )
                );
            }
        }

        return 'after editing team member agencies';
    }

    private function buildDeleteUserSnapshotSummary(User $target): string
    {
        return $this->buildTeamMemberSnapshotSummary(
            'deleting',
            (int) $target->id,
            $this->teamMemberSummaryLabel(
                (string) ($target->nickname ?? ''),
                (string) ($target->email ?? '')
            )
        );
    }

    private function buildTeamMemberSnapshotSummary(string $action, int $userId, string $label): string
    {
        $resolvedLabel = trim($label);
        if ($resolvedLabel === '') {
            $resolvedLabel = 'Unknown User';
        }

        return sprintf('after %s %s (ID#%d)', $action, $resolvedLabel, $userId);
    }

    private function teamMemberSummaryLabel(string $nickname, string $email): string
    {
        $nickname = trim($nickname);
        if ($nickname !== '') {
            return $email !== '' ? $nickname . ' / ' . trim($email) : $nickname;
        }

        return trim($email);
    }
}
