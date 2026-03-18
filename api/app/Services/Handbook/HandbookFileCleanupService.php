<?php

namespace App\Services\Handbook;

use App\Models\HandbookFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class HandbookFileCleanupService
{
    public function cleanupUnusedFiles(): void
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
}
