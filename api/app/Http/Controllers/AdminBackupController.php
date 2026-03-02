<?php

namespace App\Http\Controllers;

use App\Services\AdminUndoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use RuntimeException;

class AdminBackupController extends Controller
{
    public function __construct(private readonly AdminUndoService $snapshotService)
    {
    }

    public function snapshots(Request $request): JsonResponse
    {
        $this->assertPrivileged($request);

        return response()->json([
            'snapshots' => $this->snapshotService->listSnapshotsForViewer($request->user()),
        ]);
    }

    public function restoreSnapshot(Request $request, string $snapshotId): JsonResponse
    {
        $this->assertPrivileged($request);

        $id = (int) $snapshotId;
        if ($id <= 0) {
            return response()->json(['message' => 'Invalid snapshot.'], 422);
        }

        $this->snapshotService->restoreSnapshot($id, $request->user());

        return response()->json(['restored' => true]);
    }

    public function exportDatabaseBackup(Request $request)
    {
        $this->assertAdmin($request);

        $timestamp = now()->utc()->format('Ymd\THis\Z');
        $dumpPath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'mfag-database-' . Str::uuid()->toString() . '.sql.gz';

        try {
            $this->runShellScript([
                'bash',
                base_path('scripts/export-database.sh'),
                '--output',
                $dumpPath,
            ], 'Database export failed.');
        } catch (\Throwable $e) {
            @unlink($dumpPath);
            return response()->json(['message' => $e->getMessage()], 500);
        }

        if (!is_file($dumpPath)) {
            @unlink($dumpPath);
            return response()->json(['message' => 'Database export file was not created.'], 500);
        }

        $downloadName = 'mfag-database-' . $timestamp . '.sql.gz';

        return response()->download($dumpPath, $downloadName)->deleteFileAfterSend(true);
    }

    public function importDatabaseBackup(Request $request): JsonResponse
    {
        $this->assertAdmin($request);

        $payload = $request->validate([
            'file' => ['required', 'file'],
        ]);

        /** @var UploadedFile $file */
        $file = $payload['file'];
        $uploadedPath = $this->moveUploadedFileToTemp($file, 'mfag-database-import');

        try {
            $this->runShellScript([
                'bash',
                base_path('scripts/import-database.sh'),
                $uploadedPath,
                '--yes',
            ], 'Database import failed.');
        } catch (\Throwable $e) {
            @unlink($uploadedPath);
            return response()->json(['message' => $e->getMessage()], 500);
        }

        @unlink($uploadedPath);

        return response()->json(['restored' => true]);
    }

    public function exportUploadedFilesBackup(Request $request)
    {
        $this->assertPrivileged($request);

        $timestamp = now()->utc()->format('Ymd\THis\Z');
        $archivePath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'mfag-uploaded-files-' . Str::uuid()->toString() . '.tar.gz';

        try {
            $this->runShellScript([
                'bash',
                base_path('scripts/export-uploaded-files.sh'),
                '--output',
                $archivePath,
            ], 'Uploaded files export failed.');
        } catch (\Throwable $e) {
            @unlink($archivePath);
            return response()->json(['message' => $e->getMessage()], 500);
        }

        if (!is_file($archivePath)) {
            @unlink($archivePath);
            return response()->json(['message' => 'Uploaded files archive was not created.'], 500);
        }

        $downloadName = 'mfag-uploaded-files-' . $timestamp . '.tar.gz';

        return response()->download($archivePath, $downloadName)->deleteFileAfterSend(true);
    }

    public function importUploadedFilesBackup(Request $request): JsonResponse
    {
        $this->assertPrivileged($request);

        $payload = $request->validate([
            'file' => ['required', 'file'],
        ]);

        /** @var UploadedFile $file */
        $file = $payload['file'];
        $uploadedPath = $this->moveUploadedFileToTemp($file, 'mfag-uploaded-files-import');

        try {
            $this->runShellScript([
                'bash',
                base_path('scripts/import-uploaded-files.sh'),
                $uploadedPath,
                '--yes',
            ], 'Uploaded files import failed.');
        } catch (\Throwable $e) {
            @unlink($uploadedPath);
            return response()->json(['message' => $e->getMessage()], 500);
        }

        @unlink($uploadedPath);

        return response()->json(['restored' => true]);
    }

    private function assertPrivileged(Request $request): void
    {
        $access = strtolower(trim((string) ($request->user()?->access_level ?? '')));
        if (!in_array($access, ['admin', 'editor'], true)) {
            abort(response()->json(['message' => 'Admin or editor access required.'], 403));
        }
    }

    private function assertAdmin(Request $request): void
    {
        $access = strtolower(trim((string) ($request->user()?->access_level ?? '')));
        if ($access !== 'admin') {
            abort(response()->json(['message' => 'Admin access required.'], 403));
        }
    }

    private function moveUploadedFileToTemp(UploadedFile $file, string $prefix): string
    {
        $name = $prefix . '-' . Str::uuid()->toString();
        $extension = trim((string) $file->getClientOriginalExtension());
        if ($extension !== '') {
            $name .= '.' . $extension;
        }

        $file->move(sys_get_temp_dir(), $name);

        return sys_get_temp_dir() . DIRECTORY_SEPARATOR . $name;
    }

    private function runShellScript(array $command, string $fallbackMessage): void
    {
        $result = Process::path(base_path())
            ->forever()
            ->env([
                'PHP_BIN' => PHP_BINARY,
            ])
            ->run($command);

        if (!$result->successful()) {
            throw new RuntimeException(
                trim((string) ($result->errorOutput() ?: $result->output())) ?: $fallbackMessage
            );
        }
    }
}
