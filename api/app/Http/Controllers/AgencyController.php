<?php

namespace App\Http\Controllers;

use App\Models\Agency;
use App\Services\AdminUndoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AgencyController extends Controller
{
    public function upsertMany(Request $request): JsonResponse
    {
        $this->assertAdmin($request);

        $payload = $request->validate([
            'agencies' => ['required', 'array'],
            'agencies.*.code' => ['required', 'string', 'max:50'],
            'agencies.*.name' => ['required', 'string', 'max:150'],
            'agencies.*.position' => ['nullable', 'integer', 'min:0'],
            'agencies.*.isDeleted' => ['nullable', 'boolean'],
            'agencies.*.isActive' => ['nullable', 'boolean'],
        ]);

        $updated = 0;
        $actor = $request->user();
        $snapshotSummary = $this->buildAgencyUpsertSnapshotSummary($payload['agencies']);
        DB::transaction(function () use ($payload, &$updated, $actor, $snapshotSummary): void {
            app(AdminUndoService::class)->recordTeamSnapshot($actor?->id, $snapshotSummary);

            foreach ($payload['agencies'] as $agency) {
                $code = trim((string) $agency['code']);
                $name = trim((string) $agency['name']);
                if ($code === '' || $name === '') {
                    continue;
                }
                $values = [
                    'name' => $name,
                    'position' => isset($agency['position']) ? (int) $agency['position'] : 0,
                ];
                if (array_key_exists('isDeleted', $agency)) {
                    $values['is_delete'] = (bool) $agency['isDeleted'];
                } elseif (array_key_exists('isActive', $agency)) {
                    $values['is_delete'] = !(bool) $agency['isActive'];
                }
                $record = Agency::query()->updateOrCreate(
                    ['code' => $code],
                    $values
                );
                $record->refresh();
                $updated++;
            }
        });

        return response()->json([
            'updated' => $updated,
        ]);
    }

    public function destroy(Request $request, string $code): JsonResponse
    {
        $this->assertAdmin($request);

        $code = trim($code);
        $agency = Agency::query()->where('code', $code)->firstOrFail();
        $actor = $request->user();
        $snapshotSummary = sprintf(
            'after deleting agency %s (%s)',
            trim((string) ($agency->name ?? $agency->code)),
            $agency->code
        );

        DB::transaction(function () use ($agency, $actor, $snapshotSummary): void {
            app(AdminUndoService::class)->recordTeamSnapshot($actor?->id, $snapshotSummary);

            if (!((bool) ($agency->is_delete ?? false))) {
                $agency->update([
                    'is_delete' => true,
                ]);
            }
        });

        return response()->json(['deleted' => true]);
    }

    private function assertAdmin(Request $request): void
    {
        $access = strtolower(trim((string) ($request->user()?->access_level ?? '')));
        if ($access !== 'admin') {
            abort(response()->json(['message' => 'Admin access required.'], 403));
        }
    }

    private function buildAgencyUpsertSnapshotSummary(array $agencies): string
    {
        if (count($agencies) === 1 && is_array($agencies[0] ?? null)) {
            $entry = $agencies[0];
            $code = trim((string) ($entry['code'] ?? ''));
            $name = trim((string) ($entry['name'] ?? ''));
            $existing = $code !== '' ? Agency::query()->where('code', $code)->first() : null;

            if ($existing) {
                return sprintf(
                    'after editing agency %s (%s)',
                    $name !== '' ? $name : $code,
                    $code
                );
            }

            return sprintf(
                'after adding agency %s (%s)',
                $name !== '' ? $name : $code,
                $code
            );
        }

        return 'after reordering agencies';
    }
}
