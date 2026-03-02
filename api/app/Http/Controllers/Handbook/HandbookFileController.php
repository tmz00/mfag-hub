<?php

namespace App\Http\Controllers\Handbook;

use App\Http\Controllers\Controller;
use App\Models\HandbookFile;
use App\Services\UploadQuotaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class HandbookFileController extends Controller
{
    public function index(): JsonResponse
    {
        $files = HandbookFile::query()
            ->orderByDesc('id')
            ->limit(1000)
            ->get(['id', 'path', 'mime_type', 'size_bytes', 'created_at'])
            ->map(fn (HandbookFile $file): array => [
                'id' => (int) $file->id,
                'path' => (string) $file->path,
                'name' => $this->filenameFromPath((string) $file->path),
                'mimeType' => (string) $file->mime_type,
                'sizeBytes' => (int) $file->size_bytes,
                'createdAt' => $file->created_at,
            ])
            ->values();

        return response()->json(['files' => $files]);
    }

    public function store(Request $request, UploadQuotaService $uploadQuota): JsonResponse
    {
        $payload = $request->validate([
            'file' => ['required', 'file'],
        ]);

        $file = $payload['file'];
        $uploadQuota->assertCanStore((int) ($file->getSize() ?: 0));
        $disk = (string) config('handbook.disk', 'local');
        $prefix = trim((string) config('handbook.prefix', 'handbook'), '/');
        $prefix = $prefix !== '' ? $prefix : 'handbook';
        $storedName = $this->normalizeStoredFilename($file);
        $path = $this->storeFileWithIncrementingName($file, $prefix, $storedName, $disk);

        $record = HandbookFile::query()->create([
            'path' => $path,
            'mime_type' => $file->getMimeType() ?? 'application/octet-stream',
            'size_bytes' => $file->getSize() ?: 0,
            'uploaded_by' => $request->user()->id,
        ]);

        return response()->json([
            'id' => $record->id,
            'path' => $record->path,
            'name' => $this->filenameFromPath((string) $record->path),
            'sizeBytes' => $record->size_bytes,
            'mimeType' => $record->mime_type,
        ], 201);
    }

    public function show(Request $request, int $id)
    {
        $record = HandbookFile::query()->findOrFail($id);
        $disk = config('handbook.disk', 'local');

        if (!Storage::disk($disk)->exists($record->path)) {
            abort(404, 'File not found in storage.');
        }

        return Storage::disk($disk)->download($record->path, $this->filenameFromPath((string) $record->path));
    }

    public function destroy(int $id): JsonResponse
    {
        $record = HandbookFile::query()->findOrFail($id);
        $disk = config('handbook.disk', 'local');

        Storage::disk($disk)->delete($record->path);
        $record->delete();

        return response()->json(['deleted' => true]);
    }

    public function destroyByPath(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'path' => ['required', 'string', 'max:500'],
        ]);

        $path = trim((string) $payload['path']);
        $record = HandbookFile::query()->where('path', $path)->first();
        if (!$record) {
            return response()->json(['deleted' => true]);
        }

        $disk = config('handbook.disk', 'local');
        Storage::disk($disk)->delete($record->path);
        $record->delete();

        return response()->json(['deleted' => true]);
    }

    private function normalizeStoredFilename(UploadedFile $file): string
    {
        $candidate = (string) $file->getClientOriginalName();
        if ($candidate === '') {
            $candidate = 'file';
        }

        $candidate = html_entity_decode($candidate, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $candidate = str_replace('\\', '/', $candidate);
        $candidate = basename($candidate);
        $candidate = (string) preg_replace('/[\x00-\x1F\x7F]+/u', '', $candidate);
        $candidate = trim($candidate);

        if ($candidate === '' || $candidate === '.' || $candidate === '..') {
            $candidate = 'file';
        }

        $extension = (string) pathinfo($candidate, PATHINFO_EXTENSION);
        if ($extension === '') {
            $guessed = trim((string) $file->getClientOriginalExtension());
            if ($guessed !== '') {
                $candidate .= '.' . $guessed;
            }
        }

        return $candidate;
    }

    private function storeFileWithIncrementingName(
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

            $record = HandbookFile::query()->where('path', $candidatePath)->first();
            $fileExists = $storage->exists($candidatePath);

            if ($record !== null && !$fileExists) {
                $record->delete();
                $record = null;
            }

            if ($record === null && !$fileExists) {
                $storedPath = $file->storeAs($prefix, $candidateName, ['disk' => $disk]);
                if ($storedPath === false || $storedPath === '') {
                    throw new \RuntimeException('Unable to store handbook file.');
                }

                return $storedPath;
            }
        }

        $fallbackName = Str::uuid()->toString() . '-' . $filename;
        $storedPath = $file->storeAs($prefix, $fallbackName, ['disk' => $disk]);
        if ($storedPath === false || $storedPath === '') {
            throw new \RuntimeException('Unable to store handbook file.');
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

    private function filenameFromPath(string $path): string
    {
        $name = trim((string) pathinfo($path, PATHINFO_BASENAME));
        return $name !== '' ? $name : 'file';
    }
}
