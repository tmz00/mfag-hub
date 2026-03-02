<?php

namespace Database\Seeders;

use App\Models\Agency;
use App\Models\User;
use Illuminate\Database\Seeder;

class LegacyImportUsersSeeder extends Seeder
{
    private const USERS_SEED_RELATIVE_PATH = 'database/seeders/legacy-data/users.csv';

    private const AGENCY_NAME_MAP = [
        '02459' => 'SP-MFAGroup',
        '02755' => 'SP-MNM-MFAGroup',
        '02761' => 'SP-EN-MFAGroup',
        '02763' => 'SP-FH-MFAGroup',
        '02960' => 'SP-HAZ-MFAGroup',
        '03075' => 'SP-MHE-MFAGroup',
        '03109' => 'SP-NSM-MFAGroup',
    ];

    private const INACTIVE_AGENCY_CODES = [
        '02755',
        '02960',
    ];

    public function run(): void
    {
        $rows = $this->loadUserRows();
        if ($rows === []) {
            $this->command?->warn('Legacy user import data has no users. Skipping LegacyImportUsersSeeder.');
            return;
        }

        $agencySeed = $this->seedAgencies($rows, []);
        $agencyIdByCode = $agencySeed['agencyIdByCode'];
        $agencyStats = $agencySeed['stats'];

        $this->command?->info(
            'Legacy agency import complete: '
            . 'total=' . $agencyStats['total']
            . ', created=' . $agencyStats['created']
            . ', updated=' . $agencyStats['updated']
            . ', active=' . $agencyStats['active']
            . ', inactive=' . $agencyStats['inactive']
            . ', predefined=' . $agencyStats['predefined']
            . ', discoveredFromUsers=' . $agencyStats['discoveredFromUsers']
            . '.'
        );

        $processed = 0;
        $upserted = 0;
        $skipped = 0;
        $skippedInterns = 0;
        $warnings = 0;
        $seenEmailLine = [];

        foreach ($rows as $index => $row) {
            if (!is_array($row)) {
                continue;
            }

            $processed++;
            $lineNumber = (int) ($row['sourceLine'] ?? 0);
            $rowLabel = $lineNumber > 0 ? "Line {$lineNumber}" : 'Row ' . ($index + 1);

            $accessRaw = strtolower(trim((string) ($row['access'] ?? '')));
            if ($accessRaw === 'intern') {
                $skipped++;
                $skippedInterns++;
                continue;
            }

            $email = strtolower(trim((string) ($row['email'] ?? '')));
            if ($email === '') {
                $this->command?->warn("{$rowLabel}: missing email; row skipped.");
                $warnings++;
                $skipped++;
                continue;
            }

            $fscCode = trim((string) ($row['fscCode'] ?? ''));
            if ($fscCode === '') {
                $this->command?->warn("{$rowLabel}: missing fscCode for {$email}; row skipped.");
                $warnings++;
                $skipped++;
                continue;
            }

            if (isset($seenEmailLine[$email])) {
                $previousLabel = $seenEmailLine[$email];
                $this->command?->warn(
                    "{$rowLabel}: duplicate email {$email}; this row overwrites {$previousLabel}."
                );
                $warnings++;
            }
            $seenEmailLine[$email] = $rowLabel;

            [$accessLevel, $isActive] = $this->mapAccess($accessRaw);

            $agencyCode = trim((string) ($row['agencyCode'] ?? ''));
            $agencyId = $agencyCode !== '' ? ($agencyIdByCode[$agencyCode] ?? null) : null;

            if ($agencyCode === '') {
                $this->command?->warn("{$rowLabel}: missing agencyCode for {$email}; agency_id set to null.");
                $warnings++;
            }

            if (!preg_match('/^\d{5}$/', $fscCode)) {
                $this->command?->warn("{$rowLabel}: fscCode '{$fscCode}' is not 5 digits for {$email}.");
                $warnings++;
            }

            $birthDate = $this->parseSeedDate((string) ($row['birthDate'] ?? ''), $rowLabel, 'birthDate', $warnings);
            $contractDate = $this->parseSeedDate((string) ($row['contractDate'] ?? ''), $rowLabel, 'contractDate', $warnings);

            $nickname = $this->normalizeSeedNickname((string) ($row['displayName'] ?? ''), $isActive);
            $fullName = trim((string) ($row['fullName'] ?? ''));

            User::query()->updateOrCreate(
                ['email' => $email],
                [
                    'fsc_code' => $fscCode,
                    'access_level' => $accessLevel,
                    'agency_id' => $agencyId,
                    'nickname' => $nickname,
                    'full_name' => $fullName !== '' ? $fullName : null,
                    'birth_date' => $birthDate,
                    'contract_date' => $contractDate,
                    'is_active' => $isActive,
                ]
            );
            $upserted++;
        }

        $this->command?->info(
            "Legacy user import complete: processed={$processed}, upserted={$upserted}, skipped={$skipped}, internsSkipped={$skippedInterns}, warnings={$warnings}."
        );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function loadUserRows(): array
    {
        $seedPath = base_path(self::USERS_SEED_RELATIVE_PATH);
        if (!is_file($seedPath)) {
            $this->command?->warn("Legacy user import data not found at {$seedPath}. Skipping LegacyImportUsersSeeder.");
            return [];
        }

        $handle = fopen($seedPath, 'rb');
        if ($handle === false) {
            $this->command?->warn("Unable to read legacy user import data at {$seedPath}. Skipping LegacyImportUsersSeeder.");
            return [];
        }

        $headers = fgetcsv($handle);
        if (!is_array($headers)) {
            fclose($handle);
            $this->command?->warn("Invalid CSV header in {$seedPath}. Skipping LegacyImportUsersSeeder.");
            return [];
        }

        $normalizedHeaders = array_map(
            static fn (mixed $value): string => trim((string) $value),
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

    /**
     * @param array<int, array<string, mixed>> $rows
     * @param array<int, array<string, mixed>> $agencies
     * @return array{
     *   agencyIdByCode: array<string, int>,
     *   stats: array{
     *     total: int,
     *     created: int,
     *     updated: int,
     *     active: int,
     *     inactive: int,
     *     predefined: int,
     *     discoveredFromUsers: int
     *   }
     * }
     */
    private function seedAgencies(array $rows, array $agencies): array
    {
        $nameByCode = self::AGENCY_NAME_MAP;
        $deletedByCode = array_fill_keys(array_keys(self::AGENCY_NAME_MAP), false);
        foreach (self::INACTIVE_AGENCY_CODES as $inactiveCode) {
            $deletedByCode[$inactiveCode] = true;
        }
        $orderedCodes = [];

        foreach ($agencies as $agency) {
            if (!is_array($agency)) {
                continue;
            }
            $code = trim((string) ($agency['code'] ?? ''));
            if ($code === '' || in_array($code, $orderedCodes, true)) {
                continue;
            }
            $orderedCodes[] = $code;
            $name = trim((string) ($agency['name'] ?? ''));
            if ($name !== '') {
                $nameByCode[$code] = $name;
            }

            if (array_key_exists('isDelete', $agency)) {
                $deletedByCode[$code] = $this->toBool($agency['isDelete'], false);
            } elseif (array_key_exists('isActive', $agency)) {
                $deletedByCode[$code] = !$this->toBool($agency['isActive'], true);
            }
        }

        $extraCodes = [];
        foreach ($rows as $row) {
            $code = trim((string) ($row['agencyCode'] ?? ''));
            if ($code === '' || in_array($code, $orderedCodes, true)) {
                continue;
            }
            $extraCodes[$code] = true;
        }

        $extra = array_keys($extraCodes);
        sort($extra);
        $allCodes = array_merge($orderedCodes, $extra);
        $existingIdByCode = count($allCodes) > 0
            ? Agency::query()
                ->whereIn('code', $allCodes)
                ->pluck('id', 'code')
                ->mapWithKeys(static fn (mixed $id, mixed $code): array => [(string) $code => (int) $id])
                ->all()
            : [];

        $result = [];
        $stats = [
            'total' => 0,
            'created' => 0,
            'updated' => 0,
            'active' => 0,
            'inactive' => 0,
            'predefined' => 0,
            'discoveredFromUsers' => 0,
        ];

        foreach ($allCodes as $position => $code) {
            $name = $nameByCode[$code] ?? $code;
            $isDeleted = (bool) ($deletedByCode[$code] ?? false);
            $agency = Agency::query()->updateOrCreate(
                ['code' => $code],
                [
                    'name' => $name,
                    'position' => $position,
                    'is_delete' => $isDeleted,
                ]
            );
            $result[$code] = (int) $agency->id;

            $stats['total']++;
            if (isset($existingIdByCode[$code])) {
                $stats['updated']++;
            } else {
                $stats['created']++;
            }
            if ($isDeleted) {
                $stats['inactive']++;
            } else {
                $stats['active']++;
            }
            if (array_key_exists($code, self::AGENCY_NAME_MAP)) {
                $stats['predefined']++;
            } else {
                $stats['discoveredFromUsers']++;
            }
        }

        return [
            'agencyIdByCode' => $result,
            'stats' => $stats,
        ];
    }

    /**
     * @return array{0: string, 1: bool}
     */
    private function mapAccess(string $access): array
    {
        return match ($access) {
            'superadmin', 'admin', 'director' => ['admin', true],
            'editor' => ['editor', true],
            'inactive' => ['standard', false],
            default => ['standard', true],
        };
    }

    private function toBool(mixed $value, bool $default): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value) || is_float($value)) {
            return (bool) $value;
        }
        if (is_string($value)) {
            $normalized = strtolower(trim($value));
            if ($normalized === '') {
                return $default;
            }
            if (in_array($normalized, ['1', 'true', 'yes', 'y'], true)) {
                return true;
            }
            if (in_array($normalized, ['0', 'false', 'no', 'n'], true)) {
                return false;
            }
        }

        return $default;
    }

    private function normalizeSeedNickname(string $incoming, bool $isActive): ?string
    {
        $nickname = trim($incoming);
        if ($nickname === '') {
            return null;
        }

        if (!$isActive && str_ends_with($nickname, '0')) {
            $nickname = trim(substr($nickname, 0, -1));
        }

        return $nickname !== '' ? $nickname : null;
    }

    private function parseSeedDate(string $value, string $rowLabel, string $field, int &$warnings): ?string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }

        if (!preg_match('/^(\d{2})\/(\d{2})\/(\d{4})$/', $trimmed, $parts)) {
            $this->command?->warn("{$rowLabel}: invalid {$field} format '{$trimmed}'; stored as null.");
            $warnings++;
            return null;
        }

        $day = (int) $parts[1];
        $month = (int) $parts[2];
        $year = (int) $parts[3];

        if (!checkdate($month, $day, $year)) {
            $this->command?->warn("{$rowLabel}: invalid {$field} date '{$trimmed}'; stored as null.");
            $warnings++;
            return null;
        }

        return sprintf('%04d-%02d-%02d', $year, $month, $day);
    }
}
