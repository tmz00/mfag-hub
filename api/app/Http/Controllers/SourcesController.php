<?php

namespace App\Http\Controllers;

use App\Services\AdminUndoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SourcesController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $includeDeletedItems = $request->boolean('includeDeletedItems');

        $sources = DB::table('sources')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'label', 'description']);

        $itemsQuery = DB::table('source_items')
            ->orderBy('position')
            ->orderBy('id');

        if (!$includeDeletedItems) {
            $itemsQuery->where('is_deleted', false);
        }

        $items = $itemsQuery->get(['id', 'source_id', 'label', 'is_deleted']);

        $payload = $sources->map(function ($source) use ($items): array {
            $sourceId = (string) $source->id;
            return [
                'id' => $sourceId,
                'label' => (string) $source->label,
                'description' => (string) ($source->description ?? ''),
                'children' => $items
                    ->where('source_id', $sourceId)
                    ->values()
                    ->map(static fn ($item): array => [
                        'id' => (string) $item->id,
                        'label' => (string) $item->label,
                        'isDeleted' => (bool) $item->is_deleted,
                    ]),
            ];
        })->values();

        return response()->json(['sources' => $payload]);
    }

    public function replace(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'sources' => ['required', 'array'],
        ]);

        $sources = is_array($payload['sources'] ?? null) ? $payload['sources'] : [];
        $normalized = $this->normalizeSources($sources);
        $actor = $request->user();
        $actorId = $actor?->id;
        $now = now();
        $snapshotSummary = $this->buildSourcesSnapshotSummary($normalized);

        DB::transaction(function () use ($normalized, $now, $actorId, $snapshotSummary): void {
            app(AdminUndoService::class)->recordSourcesSnapshot($actorId, $snapshotSummary);

            $incomingSourceIds = [];
            $incomingItemIds = [];
            $sourceRows = [];
            $existingItemRows = [];
            $newItemRows = [];

            foreach ($normalized as $source) {
                $sourceId = $source['id'];
                $incomingSourceIds[] = $sourceId;
                $incomingItemIds[$sourceId] = [];

                $sourceRows[] = [
                    'id' => $sourceId,
                    'label' => $source['label'],
                    'description' => $source['description'],
                    'position' => $source['position'],
                    'is_deleted' => false,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }

            $existingSourceIds = DB::table('sources')
                ->where('is_deleted', false)
                ->pluck('id')
                ->map(static fn ($id): string => (string) $id)
                ->all();
            $staleSourceIds = array_values(array_diff($existingSourceIds, $incomingSourceIds));

            $existingItems = DB::table('source_items')
                ->where('is_deleted', false)
                ->get(['id', 'source_id', 'label']);

            $existingItemIdToSource = [];
            $existingItemIdsBySource = [];
            $existingItemIdsBySourceLabel = [];
            foreach ($existingItems as $existingItem) {
                $existingId = (int) $existingItem->id;
                $existingSourceId = (string) $existingItem->source_id;
                $existingItemIdToSource[$existingId] = $existingSourceId;
                if (!isset($existingItemIdsBySource[$existingSourceId])) {
                    $existingItemIdsBySource[$existingSourceId] = [];
                }
                $existingItemIdsBySource[$existingSourceId][$existingId] = true;

                $labelKey = $this->normalizeLookupKey((string) ($existingItem->label ?? ''));
                if ($labelKey !== '' && !isset($existingItemIdsBySourceLabel[$existingSourceId][$labelKey])) {
                    $existingItemIdsBySourceLabel[$existingSourceId][$labelKey] = $existingId;
                }
            }

            foreach ($normalized as $source) {
                $sourceId = $source['id'];
                foreach ($source['children'] as $child) {
                    $childIdRaw = $child['id'];
                    $childLabel = $child['label'];
                    $resolvedExistingId = null;

                    if (is_string($childIdRaw) && ctype_digit($childIdRaw)) {
                        $candidateId = (int) $childIdRaw;
                        if (
                            $candidateId > 0
                            && isset($existingItemIdToSource[$candidateId])
                            && $existingItemIdToSource[$candidateId] === $sourceId
                        ) {
                            $resolvedExistingId = $candidateId;
                        }
                    }

                    if ($resolvedExistingId === null) {
                        $labelKey = $this->normalizeLookupKey($childLabel);
                        $matchedByLabel = $existingItemIdsBySourceLabel[$sourceId][$labelKey] ?? null;
                        if (
                            $matchedByLabel !== null
                            && !isset($incomingItemIds[$sourceId][$matchedByLabel])
                        ) {
                            $resolvedExistingId = (int) $matchedByLabel;
                        }
                    }

                    if ($resolvedExistingId !== null) {
                        $incomingItemIds[$sourceId][$resolvedExistingId] = true;
                        $existingItemRows[] = [
                            'id' => $resolvedExistingId,
                            'source_id' => $sourceId,
                            'label' => $childLabel,
                            'position' => $child['position'],
                            'is_deleted' => false,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ];
                    } else {
                        $newItemRows[] = [
                            'source_id' => $sourceId,
                            'label' => $childLabel,
                            'position' => $child['position'],
                            'is_deleted' => false,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ];
                    }
                }
            }

            if (count($sourceRows) > 0) {
                DB::table('sources')->upsert(
                    $sourceRows,
                    ['id'],
                    ['label', 'description', 'position', 'is_deleted', 'updated_at'],
                );
            }

            if (count($existingItemRows) > 0) {
                DB::table('source_items')->upsert(
                    $existingItemRows,
                    ['id'],
                    ['source_id', 'label', 'position', 'is_deleted', 'updated_at'],
                );
            }

            if (count($newItemRows) > 0) {
                DB::table('source_items')->insert($newItemRows);
            }

            $staleItemIds = [];
            foreach ($existingItemIdsBySource as $sourceId => $idsBySource) {
                $sourceWasRemoved = in_array($sourceId, $staleSourceIds, true);
                foreach (array_keys($idsBySource) as $existingItemId) {
                    if (
                        $sourceWasRemoved
                        || !isset($incomingItemIds[$sourceId][$existingItemId])
                    ) {
                        $staleItemIds[] = (int) $existingItemId;
                    }
                }
            }

            if (count($staleItemIds) > 0) {
                DB::table('source_items')
                    ->whereIn('id', $staleItemIds)
                    ->update([
                        'is_deleted' => true,
                        'updated_at' => $now,
                    ]);
            }

            if (count($staleSourceIds) > 0) {
                DB::table('sources')
                    ->whereIn('id', $staleSourceIds)
                    ->update([
                        'is_deleted' => true,
                        'updated_at' => $now,
                    ]);
            }
        });

        return response()->json(['saved' => true]);
    }

    private function buildSourcesSnapshotSummary(array $normalized): string
    {
        $beforeSources = DB::table('sources')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'label', 'description']);
        $beforeItems = DB::table('source_items')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['source_id', 'label']);

        $beforeById = [];
        foreach ($beforeSources as $source) {
            $sourceId = trim((string) ($source->id ?? ''));
            if ($sourceId === '') {
                continue;
            }

            $beforeById[$sourceId] = [
                'id' => $sourceId,
                'label' => trim((string) ($source->label ?? '')),
                'description' => trim((string) ($source->description ?? '')),
                'children' => $beforeItems
                    ->where('source_id', $sourceId)
                    ->values()
                    ->map(static fn ($item): string => trim((string) ($item->label ?? '')))
                    ->all(),
            ];
        }

        $incomingById = [];
        foreach ($normalized as $source) {
            $sourceId = trim((string) ($source['id'] ?? ''));
            if ($sourceId === '') {
                continue;
            }

            $incomingById[$sourceId] = [
                'id' => $sourceId,
                'label' => trim((string) ($source['label'] ?? '')),
                'description' => trim((string) ($source['description'] ?? '')),
                'children' => array_values(array_map(
                    static fn ($child): string => trim((string) ($child['label'] ?? '')),
                    is_array($source['children'] ?? null) ? $source['children'] : []
                )),
            ];
        }

        $addedIds = array_values(array_diff(array_keys($incomingById), array_keys($beforeById)));
        if (count($addedIds) === 1) {
            $source = $incomingById[$addedIds[0]] ?? null;
            if (is_array($source)) {
                return sprintf('after adding %s', $source['label']);
            }
        }

        $deletedIds = array_values(array_diff(array_keys($beforeById), array_keys($incomingById)));
        if (count($deletedIds) === 1) {
            $source = $beforeById[$deletedIds[0]] ?? null;
            if (is_array($source)) {
                return sprintf('after deleting %s', $source['label']);
            }
        }

        foreach ($incomingById as $sourceId => $source) {
            $before = $beforeById[$sourceId] ?? null;
            if (!is_array($before)) {
                continue;
            }

            if (
                $before['label'] !== $source['label']
                || $before['description'] !== $source['description']
                || $before['children'] !== $source['children']
            ) {
                return sprintf('after editing %s', $source['label']);
            }
        }

        if (
            count($beforeById) === count($incomingById)
            && array_values(array_diff(array_keys($beforeById), array_keys($incomingById))) === []
            && array_keys($beforeById) !== array_keys($incomingById)
        ) {
            return 'after reordering sources';
        }

        return 'after editing sources';
    }

    private function normalizeSources(array $sources): array
    {
        $normalized = [];
        $seenSourceIds = [];

        foreach (array_values($sources) as $source) {
            if (!is_array($source)) {
                continue;
            }

            $sourceId = substr(trim((string) ($source['id'] ?? '')), 0, 100);
            $label = substr(trim((string) ($source['label'] ?? '')), 0, 150);
            if ($sourceId === '' || $label === '') {
                continue;
            }
            if (isset($seenSourceIds[$sourceId])) {
                continue;
            }
            $seenSourceIds[$sourceId] = true;

            $children = is_array($source['children'] ?? null) ? $source['children'] : [];
            $normalizedChildren = [];
            $seenChildIds = [];

            foreach (array_values($children) as $child) {
                if (!is_array($child)) {
                    continue;
                }

                $childId = trim((string) ($child['id'] ?? ''));
                $childLabel = substr(trim((string) ($child['label'] ?? '')), 0, 150);
                if ($childLabel === '') {
                    continue;
                }

                $childLookupKey = $childId !== ''
                    ? 'id:' . $childId
                    : 'label:' . $this->normalizeLookupKey($childLabel);
                if (isset($seenChildIds[$childLookupKey])) {
                    continue;
                }
                $seenChildIds[$childLookupKey] = true;

                $normalizedChildren[] = [
                    'id' => $childId !== '' ? substr($childId, 0, 100) : null,
                    'label' => $childLabel,
                    'position' => count($normalizedChildren),
                ];
            }

            $normalized[] = [
                'id' => $sourceId,
                'label' => $label,
                'description' => $this->nullableString($source['description'] ?? null),
                'children' => $normalizedChildren,
                'position' => count($normalized),
            ];
        }

        return $normalized;
    }

    private function nullableString(mixed $value): ?string
    {
        $text = trim((string) ($value ?? ''));
        if ($text === '') {
            return null;
        }
        return $text;
    }

    private function normalizeLookupKey(string $text): string
    {
        $normalized = trim((string) preg_replace('/\s+/', ' ', $text));
        if ($normalized === '') {
            return '';
        }

        return strtolower($normalized);
    }
}
