<?php

namespace Database\Seeders;

use App\Models\HandbookCategory;
use App\Models\HandbookFile;
use App\Models\User;
use GuzzleHttp\Cookie\CookieJar;
use Illuminate\Database\Seeder;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class LegacyImportHandbookSeeder extends Seeder
{
    private const HANDBOOK_SEED_RELATIVE_PATH = 'database/seeders/legacy-data/handbook.csv';
    private const HANDBOOK_FILE_ROUTE_PREFIX = '/api/handbook/file/';
    private const GOOGLE_DRIVE_HOST = 'drive.google.com';
    private const GOOGLE_DRIVE_DOWNLOAD_BASE = 'https://drive.google.com/uc?export=download';

    private ?int $seedUploaderId = null;
    private bool $skipRemainingGoogleDriveDownloads = false;
    private bool $missingUploaderWarningShown = false;

    /**
     * @var array<string, string>
     */
    private array $localizedUrlByDriveFileId = [];

    public function run(): void
    {
        $this->seedUploaderId = $this->resolveSeedUploaderId();
        $entries = $this->loadSeedEntries();
        if ($entries === null) {
            return;
        }

        $now = now();
        $rows = [];
        foreach ($entries as $index => $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $rows[] = [
                'category' => substr((string) ($entry['category'] ?? ''), 0, 120),
                'position' => $index,
                'content' => (string) ($entry['content'] ?? ''),
                'image_url' => $this->nullableString($entry['imageUrl'] ?? null),
                'image_path' => $this->nullableString($entry['imagePath'] ?? null),
                'updated_by' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        DB::transaction(function () use ($rows): void {
            HandbookCategory::query()->delete();
            if ($rows !== []) {
                HandbookCategory::query()->insert($rows);
            }
        });

        $this->command?->info('Legacy handbook import complete: categories=' . count($entries) . '.');
    }

    /**
     * @return array<int, array<string, mixed>>|null
     */
    private function loadSeedEntries(): ?array
    {
        $seedPath = base_path(self::HANDBOOK_SEED_RELATIVE_PATH);
        $csvRows = $this->loadCsvRows($seedPath);
        if ($csvRows === null) {
            return null;
        }

        if ($csvRows === []) {
            $this->command?->warn("Legacy handbook import CSV has no rows in {$seedPath}. Skipping LegacyImportHandbookSeeder.");
            return null;
        }

        $contentByCategory = [];
        $categoryOrder = [];
        $currentCategory = '';
        $currentTopic = '';

        foreach ($csvRows as $row) {
            $sourceLine = (int) ($row['sourceLine'] ?? 0);

            $category = trim((string) ($row['category'] ?? ''));
            if ($category !== '') {
                $currentCategory = $category;
                $currentTopic = '';

                if ($this->shouldSkipImportedCategory($currentCategory)) {
                    $this->command?->info(
                        "Handbook category '{$currentCategory}' excluded from legacy import."
                    );
                    continue;
                }
            }

            if ($currentCategory === '') {
                $this->command?->warn("Handbook CSV line {$sourceLine} has no category context; row skipped.");
                continue;
            }

            if ($this->shouldSkipImportedCategory($currentCategory)) {
                continue;
            }

            $topic = trim((string) ($row['topic'] ?? ''));
            $entryCategory = $currentCategory;

            if ($currentCategory === 'FAQ') {
                if ($topic !== '') {
                    $currentTopic = $topic;
                }

                if ($currentTopic === '') {
                    $this->command?->warn("Handbook FAQ CSV line {$sourceLine} has no topic context; row skipped.");
                    continue;
                }

                $entryCategory = $currentTopic;
            }

            if (!isset($contentByCategory[$entryCategory])) {
                $contentByCategory[$entryCategory] = [];
                $categoryOrder[] = $entryCategory;
            }

            if ($currentCategory !== 'FAQ' && $topic !== '' && $topic !== $currentTopic) {
                $contentByCategory[$entryCategory][] = '<h1>' . $this->escapeHtml($topic) . '</h1>';
                $currentTopic = $topic;
            }

            $fragment = $this->buildEntryFragment($row, $entryCategory, $sourceLine);
            if ($fragment !== null) {
                $contentByCategory[$entryCategory][] = $fragment;
            }
        }

        $entries = [];
        foreach ($categoryOrder as $category) {
            $fragments = $contentByCategory[$category] ?? [];
            $content = trim(implode("\n", $fragments));
            if ($content === '') {
                $this->command?->warn("Handbook category '{$category}' had no import content; skipped.");
                continue;
            }

            $entries[] = [
                'category' => $category,
                'content' => $content,
            ];
        }

        if ($entries === []) {
            $this->command?->warn("Legacy handbook import CSV had no valid entries in {$seedPath}. Skipping LegacyImportHandbookSeeder.");
            return null;
        }

        return $entries;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function buildEntryFragment(array $row, string $category, int $sourceLine): ?string
    {
        $type = strtolower(trim((string) ($row['type'] ?? '')));
        $title = trim((string) ($row['title'] ?? ''));
        $content = trim((string) ($row['content'] ?? ''));

        if ($type === '' && $title === '' && $content === '') {
            return null;
        }

        if ($title !== '' && $this->shouldSkipImportedTitle($title)) {
            $this->command?->info(
                "Handbook CSV line {$sourceLine}: skipped '{$title}' due to excluded title suffix."
            );
            return null;
        }

        return match ($type) {
            'pdf' => $this->buildExternalLinkFragment($title, $content, $category, $sourceLine),
            'video' => $this->buildExternalLinkFragment($title, $content, $category, $sourceLine),
            'qna' => $this->buildQnaFragment($title, $content, $category, $sourceLine),
            default => $this->buildFallbackFragment($type, $title, $content, $category, $sourceLine),
        };
    }

    private function buildExternalLinkFragment(
        string $title,
        string $url,
        string $category,
        int $sourceLine
    ): ?string {
        if ($title === '' || $url === '') {
            $this->command?->warn("Handbook CSV line {$sourceLine} has incomplete link row; skipped.");
            return null;
        }

        $localizedUrl = $this->localizeGoogleDriveUrl($url, $title, $category, $sourceLine);

        return '<p><a href="' . $this->escapeHtml($localizedUrl) . '" target="_blank" rel="noopener noreferrer">'
            . $this->escapeHtml($title)
            . '</a></p>';
    }

    private function buildQnaFragment(string $title, string $content, string $category, int $sourceLine): ?string
    {
        if ($title === '' || $content === '') {
            $this->command?->warn("Handbook CSV line {$sourceLine} has incomplete Q&A row; skipped.");
            return null;
        }

        $bodyHtml = trim((string) Str::markdown($content));
        if ($bodyHtml === '') {
            return null;
        }
        $bodyHtml = $this->localizeGoogleDriveLinksInHtml($bodyHtml, $title, $category, $sourceLine);

        return '<details><summary>' . $this->escapeHtml($title) . '</summary>' . $bodyHtml . '</details>';
    }

    private function buildFallbackFragment(
        string $type,
        string $title,
        string $content,
        string $category,
        int $sourceLine
    ): ?string {
        if ($type !== '') {
            $this->command?->warn("Handbook CSV line {$sourceLine} has unknown type '{$type}'; treated as Q&A.");
        }

        if ($title === '' || $content === '') {
            return null;
        }

        return $this->buildQnaFragment($title, $content, $category, $sourceLine);
    }

    /**
     * @return array<int, array<string, mixed>>|null
     */
    private function loadCsvRows(string $seedPath): ?array
    {
        if (!is_file($seedPath)) {
            $this->command?->warn("Legacy handbook import data not found at {$seedPath}. Skipping LegacyImportHandbookSeeder.");
            return null;
        }

        $handle = fopen($seedPath, 'rb');
        if ($handle === false) {
            $this->command?->warn("Unable to read legacy handbook import data at {$seedPath}. Skipping LegacyImportHandbookSeeder.");
            return null;
        }

        $headers = fgetcsv($handle);
        if (!is_array($headers)) {
            fclose($handle);
            $this->command?->warn("Invalid CSV header in {$seedPath}. Skipping LegacyImportHandbookSeeder.");
            return null;
        }

        $normalizedHeaders = array_map(
            static fn(mixed $value): string => trim((string) $value),
            $headers
        );

        $rows = [];
        $sourceLine = 1;

        while (($columns = fgetcsv($handle)) !== false) {
            $sourceLine++;

            $row = [];
            foreach ($normalizedHeaders as $index => $header) {
                if ($header === '') {
                    continue;
                }
                $row[$header] = trim((string) ($columns[$index] ?? ''));
            }

            if (!$this->rowHasValues($row)) {
                continue;
            }

            $row['sourceLine'] = $sourceLine;
            $rows[] = $row;
        }

        fclose($handle);

        return $rows;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function rowHasValues(array $row): bool
    {
        foreach ($row as $value) {
            if (trim((string) $value) !== '') {
                return true;
            }
        }

        return false;
    }

    private function resolveSeedUploaderId(): ?int
    {
        $id = User::query()->orderBy('id')->value('id');
        return is_numeric($id) ? (int) $id : null;
    }

    private function localizeGoogleDriveLinksInHtml(
        string $html,
        string $fallbackName,
        string $category,
        int $sourceLine
    ): string {
        $localizedHtml = preg_replace_callback(
            '/\b(href|src)\s*=\s*(["\'])([^"\']+)\2/i',
            function (array $matches) use ($fallbackName, $category, $sourceLine): string {
                $originalUrl = (string) ($matches[3] ?? '');
                if ($originalUrl === '') {
                    return (string) ($matches[0] ?? '');
                }

                $localizedUrl = $this->localizeGoogleDriveUrl($originalUrl, $fallbackName, $category, $sourceLine);
                if ($localizedUrl === $originalUrl) {
                    return (string) ($matches[0] ?? '');
                }

                $attribute = (string) ($matches[1] ?? 'href');
                $quote = (string) ($matches[2] ?? '"');
                return $attribute . '=' . $quote . $this->escapeHtml($localizedUrl) . $quote;
            },
            $html
        );

        return is_string($localizedHtml) ? $localizedHtml : $html;
    }

    private function localizeGoogleDriveUrl(string $url, string $fallbackName, string $category, int $sourceLine): string
    {
        $normalizedUrl = trim(html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($normalizedUrl === '' || !$this->isGoogleDriveUrl($normalizedUrl)) {
            return $url;
        }

        if ($this->isFaqCategory($category)) {
            return $url;
        }

        $fileId = $this->extractGoogleDriveFileId($normalizedUrl);
        if ($fileId === null) {
            $this->command?->warn("Handbook CSV line {$sourceLine} has unsupported Google Drive URL; kept original link.");
            return $url;
        }

        if (isset($this->localizedUrlByDriveFileId[$fileId])) {
            return $this->localizedUrlByDriveFileId[$fileId];
        }

        $disk = (string) config('handbook.disk', 'local');
        $prefix = trim((string) config('handbook.prefix', 'handbook'), '/');
        if ($prefix === '') {
            $prefix = 'handbook';
        }

        if ($this->seedUploaderId === null) {
            if (!$this->missingUploaderWarningShown) {
                $this->missingUploaderWarningShown = true;
                $this->command?->warn(
                    'No users found for handbook file ownership; Google Drive links remain unchanged.'
                );
            }
            return $url;
        }

        if ($this->skipRemainingGoogleDriveDownloads) {
            return $url;
        }

        $downloaded = $this->downloadGoogleDriveFile($fileId, $sourceLine);
        if ($downloaded === null) {
            return $url;
        }

        $mimeType = (string) ($downloaded['mimeType'] ?? 'application/octet-stream');
        $tempPath = (string) ($downloaded['tempPath'] ?? '');
        $sizeBytes = (int) ($downloaded['sizeBytes'] ?? 0);
        if ($tempPath === '' || !is_file($tempPath)) {
            return $url;
        }

        try {
            $originalName = $this->normalizeImportedFilename(
                (string) ($downloaded['filename'] ?? ''),
                $fallbackName,
                $mimeType,
                $fileId
            );

            $resolvedStorage = $this->resolveImportedStoragePath($prefix, $originalName, $disk, $tempPath);
            $storagePath = (string) ($resolvedStorage['path'] ?? '');
            $shouldStore = (bool) ($resolvedStorage['shouldStore'] ?? false);
            if ($storagePath === '') {
                return $url;
            }

            $storedName = trim((string) pathinfo($storagePath, PATHINFO_BASENAME));
            if ($storedName !== '') {
                $assetType = $this->describeImportedAssetType($mimeType);
                if ($storedName === $originalName) {
                    $this->command?->info(
                        "Handbook CSV line {$sourceLine}: downloading Google Drive {$assetType} {$storedName}."
                    );
                } else {
                    $this->command?->info(
                        "Handbook CSV line {$sourceLine}: downloading Google Drive {$assetType} {$originalName} as {$storedName}."
                    );
                }
            }

            if ($shouldStore) {
                $stream = fopen($tempPath, 'rb');
                if ($stream === false) {
                    $this->command?->warn("Handbook CSV line {$sourceLine}: unable to read downloaded Google Drive file.");
                    return $url;
                }

                try {
                    $stored = Storage::disk($disk)->put($storagePath, $stream);
                } finally {
                    if (is_resource($stream)) {
                        fclose($stream);
                    }
                }

                if ($stored === false) {
                    $this->command?->warn("Handbook CSV line {$sourceLine}: unable to store downloaded Google Drive file.");
                    return $url;
                }
            }

            $record = HandbookFile::query()->updateOrCreate(
                ['path' => $storagePath],
                [
                    'mime_type' => $mimeType,
                    'size_bytes' => $sizeBytes,
                    'uploaded_by' => $this->seedUploaderId,
                ]
            );

            $localizedUrl = $this->buildHandbookFileRoute((int) $record->id, $storagePath);
            $this->localizedUrlByDriveFileId[$fileId] = $localizedUrl;

            return $localizedUrl;
        } finally {
            if (is_file($tempPath)) {
                @unlink($tempPath);
            }
        }
    }

    private function isGoogleDriveUrl(string $url): bool
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if ($host === '') {
            return false;
        }

        return $host === self::GOOGLE_DRIVE_HOST || str_ends_with($host, '.' . self::GOOGLE_DRIVE_HOST);
    }

    private function extractGoogleDriveFileId(string $url): ?string
    {
        $queryString = (string) parse_url($url, PHP_URL_QUERY);
        if ($queryString !== '') {
            $query = [];
            parse_str($queryString, $query);
            $id = trim((string) ($query['id'] ?? ''));
            if ($id !== '' && preg_match('/^[A-Za-z0-9_-]+$/', $id) === 1) {
                return $id;
            }
        }

        $path = (string) parse_url($url, PHP_URL_PATH);
        if ($path === '') {
            return null;
        }

        if (preg_match('#/file/d/([A-Za-z0-9_-]+)#', $path, $matches) === 1) {
            return (string) $matches[1];
        }

        return null;
    }

    private function buildHandbookFileRoute(int $id, string $path): string
    {
        $route = self::HANDBOOK_FILE_ROUTE_PREFIX . $id;
        $name = trim((string) pathinfo($path, PATHINFO_BASENAME));
        if ($name === '') {
            return $route;
        }

        return $route . '?name=' . rawurlencode($name);
    }

    /**
     * @return array{tempPath: string, mimeType: string, filename: string, sizeBytes: int}|null
     */
    private function downloadGoogleDriveFile(string $fileId, int $sourceLine): ?array
    {
        $tempPath = tempnam(sys_get_temp_dir(), 'handbook-gdrive-');
        if (!is_string($tempPath) || $tempPath === '') {
            $this->command?->warn(
                "Handbook CSV line {$sourceLine}: unable to create a temporary file for Google Drive download."
            );
            return null;
        }

        $cookieJar = new CookieJar();
        $nextUrl = $this->buildGoogleDriveDownloadUrl($fileId);

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $response = $this->requestGoogleDriveDownload($nextUrl, $cookieJar, $tempPath, $sourceLine);
            if ($response === null) {
                if (is_file($tempPath)) {
                    @unlink($tempPath);
                }
                return null;
            }

            $mimeType = $this->normalizeMimeType((string) $response->header('Content-Type'));
            $contents = null;
            if ($this->isLikelyHtmlMimeType($mimeType)) {
                $contents = $this->readGoogleDriveResponseBody($tempPath, $sourceLine);
                if ($contents === null) {
                    if (is_file($tempPath)) {
                        @unlink($tempPath);
                    }
                    return null;
                }
            }

            if (!$response->successful()) {
                $followupUrl = null;
                if ($contents !== '' && $this->isLikelyHtmlMimeType($mimeType)) {
                    $followupUrl = $this->extractGoogleDriveDownloadUrlFromHtml($contents, $nextUrl);
                }

                if ($followupUrl !== null && $followupUrl !== $nextUrl) {
                    $nextUrl = $followupUrl;
                    continue;
                }

                $this->command?->warn(
                    "Handbook CSV line {$sourceLine}: Google Drive download failed with HTTP {$response->status()} (url: {$nextUrl})."
                );
                if (is_file($tempPath)) {
                    @unlink($tempPath);
                }
                return null;
            }

            clearstatcache(true, $tempPath);
            $sizeBytes = filesize($tempPath);
            if (!is_int($sizeBytes) || $sizeBytes < 1) {
                $this->command?->warn("Handbook CSV line {$sourceLine}: downloaded Google Drive file was empty.");
                if (is_file($tempPath)) {
                    @unlink($tempPath);
                }
                return null;
            }

            if (
                !$this->isLikelyHtmlMimeType($mimeType) ||
                !str_contains(strtolower((string) $contents), '<html')
            ) {
                $filename = $this->extractFilenameFromContentDisposition((string) $response->header('Content-Disposition'));

                return [
                    'tempPath' => $tempPath,
                    'mimeType' => $mimeType,
                    'filename' => $filename,
                    'sizeBytes' => $sizeBytes,
                ];
            }

            $followupUrl = $this->extractGoogleDriveDownloadUrlFromHtml((string) $contents, $nextUrl);
            if ($followupUrl === null || $followupUrl === $nextUrl) {
                $this->command?->warn(
                    "Handbook CSV line {$sourceLine}: Google Drive returned an HTML page instead of a downloadable file (url: {$nextUrl})."
                );
                if (is_file($tempPath)) {
                    @unlink($tempPath);
                }
                return null;
            }

            $nextUrl = $followupUrl;
        }

        $this->command?->warn(
            "Handbook CSV line {$sourceLine}: exceeded max Google Drive download attempts; link kept unchanged (last url: {$nextUrl})."
        );
        if (is_file($tempPath)) {
            @unlink($tempPath);
        }
        return null;
    }

    private function requestGoogleDriveDownload(
        string $url,
        CookieJar $cookieJar,
        string $tempPath,
        int $sourceLine
    ): ?Response {
        try {
            return Http::withOptions([
                'allow_redirects' => true,
                'cookies' => $cookieJar,
                'sink' => $tempPath,
            ])
                ->withHeaders(['User-Agent' => 'Mozilla/5.0'])
                ->connectTimeout(8)
                ->timeout(20)
                ->get($url);
        } catch (ConnectionException $exception) {
            $this->skipRemainingGoogleDriveDownloads = true;
            $this->command?->warn(
                "Handbook CSV line {$sourceLine}: unable to reach Google Drive (url: {$url}). Remaining Drive links kept unchanged."
            );
            return null;
        } catch (\Throwable $exception) {
            $this->command?->warn(
                "Handbook CSV line {$sourceLine}: Google Drive download threw an exception (url: {$url}); link kept unchanged."
            );
            return null;
        }
    }

    private function buildGoogleDriveDownloadUrl(string $fileId): string
    {
        return self::GOOGLE_DRIVE_DOWNLOAD_BASE . '&' . http_build_query([
            'id' => $fileId,
        ]);
    }

    private function extractGoogleDriveDownloadUrlFromHtml(string $html, string $currentUrl): ?string
    {
        $decodedHtml = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $formUrl = $this->extractGoogleDriveDownloadFormUrl($decodedHtml);
        if ($formUrl !== null) {
            return $formUrl;
        }

        $escapedUrl = $this->extractGoogleDriveEscapedDownloadUrl($html);
        if ($escapedUrl !== null) {
            return $escapedUrl;
        }

        if (preg_match(
            '/(?:href|action)\s*=\s*["\']([^"\']*(?:\/uc\?export=download|drive\.usercontent\.google\.com\/download)[^"\']*)["\']/i',
            $decodedHtml,
            $matches
        ) === 1) {
            return $this->normalizeGoogleDriveCandidateUrl((string) $matches[1]);
        }

        $confirmToken = $this->extractGoogleDriveConfirmToken($decodedHtml);
        if ($confirmToken !== null) {
            return $this->appendQueryParameters($currentUrl, ['confirm' => $confirmToken]);
        }

        return null;
    }

    private function readGoogleDriveResponseBody(string $tempPath, int $sourceLine): ?string
    {
        $contents = file_get_contents($tempPath);
        if ($contents === false) {
            $this->command?->warn(
                "Handbook CSV line {$sourceLine}: unable to read the Google Drive response body."
            );
            return null;
        }

        return $contents;
    }

    private function extractGoogleDriveConfirmToken(string $html): ?string
    {
        if (preg_match('/confirm=([^&"\'<>\s]+)/i', $html, $matches) === 1) {
            return (string) $matches[1];
        }

        return null;
    }

    private function extractGoogleDriveDownloadFormUrl(string $html): ?string
    {
        if (preg_match('/<form[^>]*id=["\']download-form["\'][^>]*>(.*?)<\/form>/is', $html, $matches) !== 1) {
            return null;
        }

        $formHtml = (string) $matches[0];
        $action = '';
        if (preg_match('/<form[^>]*\saction=(["\'])(.*?)\1/i', $formHtml, $actionMatch) === 1) {
            $action = (string) $actionMatch[2];
        }
        if ($action === '') {
            $action = '/uc';
        }

        $query = [];
        if ($action !== '') {
            parse_str((string) parse_url($action, PHP_URL_QUERY), $query);
        }

        if (preg_match_all('/<input[^>]*type=["\']hidden["\'][^>]*>/i', $formHtml, $inputMatches) > 0) {
            foreach ($inputMatches[0] as $inputTag) {
                if (
                    preg_match('/\sname=(["\'])(.*?)\1/i', $inputTag, $nameMatch) === 1 &&
                    preg_match('/\svalue=(["\'])(.*?)\1/i', $inputTag, $valueMatch) === 1
                ) {
                    $query[(string) $nameMatch[2]] = (string) $valueMatch[2];
                }
            }
        }

        return $this->normalizeGoogleDriveCandidateUrl($action, $query);
    }

    private function extractGoogleDriveEscapedDownloadUrl(string $html): ?string
    {
        if (preg_match('/"downloadUrl":"([^"]+)"/i', $html, $matches) === 1) {
            return $this->normalizeGoogleDriveCandidateUrl((string) $matches[1]);
        }

        return null;
    }

    /**
     * @param array<string, string> $extraQuery
     */
    private function normalizeGoogleDriveCandidateUrl(string $candidate, array $extraQuery = []): ?string
    {
        $normalized = trim($candidate);
        if ($normalized === '') {
            return null;
        }

        $normalized = str_replace(['\\/', '\u003d', '\u0026'], ['/', '=', '&'], $normalized);
        $normalized = html_entity_decode($normalized, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        if (str_starts_with($normalized, '//')) {
            $normalized = 'https:' . $normalized;
        } elseif (str_starts_with($normalized, '/')) {
            $normalized = 'https://' . self::GOOGLE_DRIVE_HOST . $normalized;
        } elseif (!preg_match('#^https?://#i', $normalized)) {
            return null;
        }

        $path = (string) parse_url($normalized, PHP_URL_PATH);
        if ($path === '') {
            return null;
        }

        $host = strtolower((string) parse_url($normalized, PHP_URL_HOST));
        if (
            $host === '' ||
            !in_array($host, [self::GOOGLE_DRIVE_HOST, 'drive.usercontent.google.com'], true)
        ) {
            return null;
        }

        $lowerPath = strtolower($path);
        if (str_contains($lowerPath, '/signin/') || str_contains($lowerPath, 'servicelogin')) {
            return null;
        }
        if (
            $lowerPath !== '/uc' &&
            !str_contains($lowerPath, '/download') &&
            !str_contains($lowerPath, '/file/d/')
        ) {
            return null;
        }

        $query = [];
        parse_str((string) parse_url($normalized, PHP_URL_QUERY), $query);
        foreach ($extraQuery as $key => $value) {
            $query[$key] = $value;
        }

        return 'https://' . $host . $path . '?' . http_build_query($query);
    }

    /**
     * @param array<string, string> $params
     */
    private function appendQueryParameters(string $url, array $params): ?string
    {
        $normalized = trim($url);
        if ($normalized === '') {
            return null;
        }

        $host = strtolower((string) parse_url($normalized, PHP_URL_HOST));
        if (
            $host === '' ||
            !in_array($host, [self::GOOGLE_DRIVE_HOST, 'drive.usercontent.google.com'], true)
        ) {
            return null;
        }

        $path = (string) parse_url($normalized, PHP_URL_PATH);
        if ($path === '') {
            return null;
        }

        $query = [];
        parse_str((string) parse_url($normalized, PHP_URL_QUERY), $query);
        foreach ($params as $key => $value) {
            $query[$key] = $value;
        }

        return 'https://' . $host . $path . '?' . http_build_query($query);
    }

    /**
     * @return array{path: string, shouldStore: bool}
     */
    private function resolveImportedStoragePath(
        string $prefix,
        string $originalName,
        string $disk,
        string $tempPath
    ): array {
        $storage = Storage::disk($disk);
        $filename = trim($originalName) !== '' ? trim($originalName) : 'download.bin';
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

            if ($fileExists && $this->storedFileMatches($disk, $candidatePath, $tempPath)) {
                return [
                    'path' => $candidatePath,
                    'shouldStore' => false,
                ];
            }

            if ($record === null && !$fileExists) {
                return [
                    'path' => $candidatePath,
                    'shouldStore' => true,
                ];
            }
        }

        return [
            'path' => $prefix . '/' . Str::uuid()->toString() . '-' . $filename,
            'shouldStore' => true,
        ];
    }

    private function appendNumericSuffixToFilename(string $baseName, string $extension, int $attempt): string
    {
        $suffix = ' (' . $attempt . ')';
        if ($extension === '') {
            return $baseName . $suffix;
        }

        return $baseName . $suffix . '.' . $extension;
    }

    private function storedFileMatches(string $disk, string $path, string $tempPath): bool
    {
        clearstatcache(true, $tempPath);
        $tempSize = filesize($tempPath);
        if (!is_int($tempSize) || $tempSize < 0) {
            return false;
        }

        try {
            if (Storage::disk($disk)->size($path) !== $tempSize) {
                return false;
            }
        } catch (\Throwable $exception) {
            return false;
        }

        $existingStream = Storage::disk($disk)->readStream($path);
        if (!is_resource($existingStream)) {
            return false;
        }

        $tempStream = fopen($tempPath, 'rb');
        if ($tempStream === false) {
            fclose($existingStream);
            return false;
        }

        try {
            $existingHash = hash_init('sha1');
            hash_update_stream($existingHash, $existingStream);

            $tempHash = hash_init('sha1');
            hash_update_stream($tempHash, $tempStream);

            return hash_final($existingHash) === hash_final($tempHash);
        } finally {
            fclose($existingStream);
            fclose($tempStream);
        }
    }

    private function extractFilenameFromContentDisposition(string $contentDisposition): string
    {
        if ($contentDisposition === '') {
            return '';
        }

        if (preg_match("/filename\\*=UTF-8''([^;]+)/i", $contentDisposition, $matches) === 1) {
            return trim(rawurldecode((string) $matches[1]));
        }

        if (preg_match('/filename="?([^";]+)"?/i', $contentDisposition, $matches) === 1) {
            return trim((string) $matches[1]);
        }

        return '';
    }

    private function normalizeImportedFilename(
        string $filenameFromHeader,
        string $fallbackName,
        string $mimeType,
        string $fileId
    ): string {
        $candidate = trim($filenameFromHeader);
        if ($candidate === '') {
            $candidate = trim($fallbackName);
        }
        if ($candidate === '') {
            $candidate = "google-drive-{$fileId}";
        }

        $candidate = html_entity_decode($candidate, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $candidate = (string) preg_replace('/[\/\\\\]+/', '-', $candidate);
        $candidate = (string) preg_replace('/[^A-Za-z0-9._ -]+/', '_', $candidate);
        $candidate = trim($candidate, " .\t\n\r\0\x0B");
        if ($candidate === '') {
            $candidate = "google-drive-{$fileId}";
        }

        $extension = strtolower((string) pathinfo($candidate, PATHINFO_EXTENSION));
        if ($extension === '') {
            $guessed = $this->guessExtensionFromMimeType($mimeType);
            if ($guessed !== '') {
                $candidate .= '.' . $guessed;
                $extension = $guessed;
            }
        }

        if ($extension === '') {
            $candidate .= '.bin';
            $extension = 'bin';
        }

        if (strlen($candidate) > 180) {
            $maxBaseLength = 180 - strlen($extension) - 1;
            $base = substr((string) pathinfo($candidate, PATHINFO_FILENAME), 0, max(1, $maxBaseLength));
            $candidate = "{$base}.{$extension}";
        }

        return $candidate;
    }

    private function isFaqCategory(string $category): bool
    {
        return strtolower(trim($category)) === 'faq';
    }

    private function shouldSkipImportedCategory(string $category): bool
    {
        return in_array(strtolower(trim($category)), ['seminars', 'newsletters', 'resources'], true);
    }

    private function shouldSkipImportedTitle(string $title): bool
    {
        $normalized = strtolower(trim($title));
        if ($normalized === '') {
            return false;
        }

        foreach (['product summary', 'benefit illustration'] as $suffix) {
            if (str_ends_with($normalized, $suffix)) {
                return true;
            }
        }

        return false;
    }

    private function describeImportedAssetType(string $mimeType): string
    {
        $normalized = strtolower(trim($mimeType));
        if (str_starts_with($normalized, 'image/')) {
            return 'image';
        }
        if (str_starts_with($normalized, 'video/')) {
            return 'video';
        }
        if (str_starts_with($normalized, 'audio/')) {
            return 'audio';
        }

        return 'file';
    }

    private function guessExtensionFromMimeType(string $mimeType): string
    {
        return match ($mimeType) {
            'application/pdf' => 'pdf',
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/gif' => 'gif',
            'image/webp' => 'webp',
            'image/svg+xml' => 'svg',
            'video/mp4' => 'mp4',
            'video/webm' => 'webm',
            'audio/mpeg' => 'mp3',
            default => '',
        };
    }

    private function normalizeMimeType(string $rawContentType): string
    {
        $type = strtolower(trim(explode(';', $rawContentType)[0] ?? ''));
        return $type !== '' ? $type : 'application/octet-stream';
    }

    private function isLikelyHtmlMimeType(string $mimeType): bool
    {
        return $mimeType === 'text/html' || $mimeType === 'application/xhtml+xml';
    }

    private function escapeHtml(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private function nullableString(mixed $value): ?string
    {
        $text = trim((string) $value);
        return $text === '' ? null : substr($text, 0, 500);
    }
}
