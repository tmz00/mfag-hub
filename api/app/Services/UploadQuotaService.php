<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class UploadQuotaService
{
    private const DEFAULT_MAX_TOTAL_BYTES = 8_589_934_592; // 8 GB

    public function assertCanStore(int $incomingBytes, string $field = 'file'): void
    {
        $incomingBytes = max(0, $incomingBytes);
        $currentBytes = $this->currentUsageBytes();
        $maxBytes = $this->maxTotalBytes();

        if ($currentBytes + $incomingBytes <= $maxBytes) {
            return;
        }

        throw ValidationException::withMessages([
            $field => [
                sprintf(
                    'Uploading this file would exceed the shared server upload limit of %s.',
                    $this->formatBytes($maxBytes)
                ),
            ],
        ]);
    }

    public function currentUsageBytes(): int
    {
        $handbookBytes = (int) DB::table('handbook_files')->sum('size_bytes');
        $notificationBytes = (int) DB::table('notification_files')->sum('size_bytes');

        return max(0, $handbookBytes) + max(0, $notificationBytes);
    }

    public function maxTotalBytes(): int
    {
        return max(1_024, (int) config('uploads.max_total_bytes', self::DEFAULT_MAX_TOTAL_BYTES));
    }

    private function formatBytes(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }

        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $value = (float) $bytes;
        $unitIndex = 0;

        while ($value >= 1024 && $unitIndex < count($units) - 1) {
            $value /= 1024;
            $unitIndex++;
        }

        $precision = ($value >= 10 || $unitIndex === 0) ? 0 : 1;

        return number_format($value, $precision) . ' ' . $units[$unitIndex];
    }
}
