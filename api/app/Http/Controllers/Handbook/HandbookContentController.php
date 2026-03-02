<?php

namespace App\Http\Controllers\Handbook;

use App\Http\Controllers\Controller;
use App\Models\HandbookCategory;
use App\Models\HandbookFile;
use App\Services\AdminUndoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class HandbookContentController extends Controller
{
    private const DOC_NAME = 'handbook';

    public function show(): JsonResponse
    {
        $categories = HandbookCategory::query()
            ->where('is_deleted', false)
            ->with('updater:id,nickname,full_name,email')
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        $payload = $categories->map(function (HandbookCategory $category): array {
            return [
                'id' => (int) $category->id,
                'category' => $category->category,
                'content' => $category->content ?? '',
                'imageUrl' => $category->image_url ?? '',
                'imagePath' => $category->image_path ?? '',
                'updatedBy' => $category->updater?->nickname
                    ?: $category->updater?->full_name
                    ?: $category->updater?->email,
                'updatedAt' => $category->updated_at?->toISOString(),
            ];
        })->values()->all();

        $latestUpdate = $categories->max('updated_at');

        return response()->json([
            'name' => self::DOC_NAME,
            'payload' => $payload,
            'updatedAt' => $latestUpdate?->toISOString(),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'payload' => ['required', 'array'],
            'payload.*.id' => ['nullable', 'integer', 'min:1'],
            'payload.*.category' => ['nullable', 'string', 'max:120'],
            'payload.*.content' => ['nullable', 'string'],
            'payload.*.imageUrl' => ['nullable', 'string', 'max:500'],
            'payload.*.imagePath' => ['nullable', 'string', 'max:500'],
        ]);

        $actorId = $request->user()?->id;
        $now = now();
        $snapshotSummary = $this->buildHandbookSnapshotSummary($payload['payload']);
        $activeCategoryIds = DB::table('handbook_categories')
            ->where('is_deleted', false)
            ->pluck('id')
            ->map(static fn ($value): int => (int) $value)
            ->all();
        $existingIds = DB::table('handbook_categories')
            ->pluck('id')
            ->map(static fn ($value): int => (int) $value)
            ->flip()
            ->all();

        $existingRows = [];
        $newRows = [];
        $seenExistingIds = [];
        foreach ($payload['payload'] as $index => $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $resolvedId = null;
            $rawId = $entry['id'] ?? null;
            if (is_numeric($rawId)) {
                $candidateId = (int) $rawId;
                if (
                    $candidateId > 0
                    && isset($existingIds[$candidateId])
                    && !isset($seenExistingIds[$candidateId])
                ) {
                    $resolvedId = $candidateId;
                    $seenExistingIds[$candidateId] = true;
                }
            }

            $category = trim((string) ($entry['category'] ?? ''));
            if ($category === '') {
                $category = 'Category ' . ($index + 1);
            }

            $row = [
                'category' => substr($category, 0, 120),
                'position' => $index,
                'content' => (string) ($entry['content'] ?? ''),
                'image_url' => $this->nullableString($entry['imageUrl'] ?? null),
                'image_path' => $this->nullableString($entry['imagePath'] ?? null),
                'is_deleted' => false,
                'updated_by' => $actorId,
                'updated_at' => $now,
            ];

            if ($resolvedId !== null) {
                $existingRows[] = [
                    'id' => $resolvedId,
                    ...$row,
                    'created_at' => $now,
                ];
                continue;
            }

            $newRows[] = [
                ...$row,
                'created_at' => $now,
            ];
        }

        DB::transaction(function () use (
            $existingRows,
            $newRows,
            $actorId,
            $now,
            $activeCategoryIds,
            $snapshotSummary
        ): void {
            app(AdminUndoService::class)->recordHandbookSnapshot($actorId, $snapshotSummary);

            if ($existingRows !== []) {
                DB::table('handbook_categories')->upsert(
                    $existingRows,
                    ['id'],
                    ['category', 'position', 'content', 'image_url', 'image_path', 'is_deleted', 'updated_by', 'updated_at']
                );
            }

            foreach ($newRows as $row) {
                DB::table('handbook_categories')->insert($row);
            }

            $keptExistingIds = array_values(array_map(
                static fn (array $row): int => (int) $row['id'],
                $existingRows
            ));
            $staleIds = array_values(array_diff($activeCategoryIds, $keptExistingIds));
            if ($staleIds !== []) {
                DB::table('handbook_categories')
                    ->whereIn('id', $staleIds)
                    ->update([
                        'is_deleted' => true,
                        'updated_by' => $actorId,
                        'updated_at' => $now,
                    ]);
            }
        });

        $this->cleanupUnusedHandbookFiles();

        return response()->json([
            'success' => true,
            'updatedAt' => ($existingRows === [] && $newRows === []) ? null : $now->toISOString(),
        ]);
    }

    private function nullableString(mixed $value): ?string
    {
        $text = trim((string) $value);
        return $text === '' ? null : $text;
    }

    private function cleanupUnusedHandbookFiles(): void
    {
        [$referencedFileIds, $referencedPaths] = $this->collectReferencedHandbookFiles();
        $disk = (string) config('handbook.disk', 'local');

        HandbookFile::query()
            ->orderBy('id')
            ->get(['id', 'path'])
            ->each(function (HandbookFile $file) use ($referencedFileIds, $referencedPaths, $disk): void {
                $fileId = (int) $file->id;
                $path = trim((string) $file->path);

                if (
                    ($fileId > 0 && isset($referencedFileIds[$fileId]))
                    || ($path !== '' && isset($referencedPaths[$path]))
                ) {
                    return;
                }

                try {
                    if ($path !== '') {
                        Storage::disk($disk)->delete($path);
                    }

                    $file->delete();
                } catch (\Throwable $exception) {
                    report($exception);
                }
            });
    }

    private function collectReferencedHandbookFiles(): array
    {
        $referencedFileIds = [];
        $referencedPaths = [];

        $rows = DB::table('handbook_categories')
            ->where('is_deleted', false)
            ->get(['content', 'image_url', 'image_path']);

        foreach ($rows as $row) {
            foreach ($this->extractHandbookFileIds((string) ($row->content ?? '')) as $id) {
                $referencedFileIds[$id] = true;
            }

            foreach ($this->extractHandbookFileIds((string) ($row->image_url ?? '')) as $id) {
                $referencedFileIds[$id] = true;
            }

            $path = trim((string) ($row->image_path ?? ''));
            if ($path !== '') {
                $referencedPaths[$path] = true;
            }
        }

        return [$referencedFileIds, $referencedPaths];
    }

    private function extractHandbookFileIds(string $content): array
    {
        if ($content === '') {
            return [];
        }

        $matchCount = preg_match_all(
            '/\/api\/handbook\/file\/(\d+)(?=[^0-9]|$)/',
            $content,
            $matches
        );

        if (!$matchCount || !is_array($matches[1] ?? null)) {
            return [];
        }

        $ids = [];
        foreach ($matches[1] as $value) {
            $id = (int) $value;
            if ($id > 0) {
                $ids[$id] = true;
            }
        }

        return array_keys($ids);
    }

    private function buildHandbookSnapshotSummary(array $entries): string
    {
        $beforeRows = DB::table('handbook_categories')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'category', 'content', 'image_url', 'image_path']);

        $beforeById = [];
        foreach ($beforeRows as $row) {
            $id = (int) ($row->id ?? 0);
            if ($id <= 0) {
                continue;
            }

            $beforeById[$id] = [
                'id' => $id,
                'category' => trim((string) ($row->category ?? '')),
                'content' => (string) ($row->content ?? ''),
                'imageUrl' => trim((string) ($row->image_url ?? '')),
                'imagePath' => trim((string) ($row->image_path ?? '')),
            ];
        }

        $incomingById = [];
        $newCategories = [];
        foreach (array_values($entries) as $index => $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $category = trim((string) ($entry['category'] ?? ''));
            if ($category === '') {
                $category = 'Category ' . ($index + 1);
            }

            $candidateId = is_numeric($entry['id'] ?? null) ? (int) $entry['id'] : 0;
            $normalized = [
                'id' => $candidateId,
                'category' => $category,
                'content' => (string) ($entry['content'] ?? ''),
                'imageUrl' => trim((string) ($entry['imageUrl'] ?? '')),
                'imagePath' => trim((string) ($entry['imagePath'] ?? '')),
            ];

            if ($candidateId > 0 && isset($beforeById[$candidateId]) && !isset($incomingById[$candidateId])) {
                $incomingById[$candidateId] = $normalized;
                continue;
            }

            $newCategories[] = $normalized;
        }

        if (count($newCategories) === 1) {
            return sprintf('after adding %s', $newCategories[0]['category']);
        }

        $deletedIds = array_values(array_diff(array_keys($beforeById), array_keys($incomingById)));
        if (count($deletedIds) === 1) {
            $deleted = $beforeById[$deletedIds[0]] ?? null;
            if (is_array($deleted)) {
                return sprintf('after deleting %s', $deleted['category']);
            }
        }

        foreach ($incomingById as $categoryId => $entry) {
            $before = $beforeById[$categoryId] ?? null;
            if (!is_array($before)) {
                continue;
            }

            if (
                $before['category'] !== $entry['category']
                || $before['content'] !== $entry['content']
                || $before['imageUrl'] !== $entry['imageUrl']
                || $before['imagePath'] !== $entry['imagePath']
            ) {
                return sprintf('after editing %s', $entry['category']);
            }
        }

        if (
            count($beforeById) === count($incomingById)
            && array_values(array_diff(array_keys($beforeById), array_keys($incomingById))) === []
            && array_keys($beforeById) !== array_keys($incomingById)
        ) {
            return 'after reordering categories';
        }

        return 'after editing handbook';
    }
}
