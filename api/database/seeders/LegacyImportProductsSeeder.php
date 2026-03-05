<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class LegacyImportProductsSeeder extends Seeder
{
    private const PRODUCTS_BASE_SEED_RELATIVE_PATH = 'database/seeders/legacy-data/products - basic.csv';
    private const PRODUCTS_RIDERS_SEED_RELATIVE_PATH = 'database/seeders/legacy-data/products - riders.csv';

    private const PRODUCT_TYPE_LABELS = [
        'regular' => 'Regular premium',
        'hsg' => 'HSG',
        'pa' => 'Personal accident',
        'single' => 'Single premium',
        'cs' => 'Corporate Solutions',
    ];

    private const FALLBACK_PRODUCT_TYPE_LABELS = [
        'pl' => 'Personal line',
    ];

    private const BASE_PRODUCT_ID_OVERRIDES_BY_SOURCE_LINE = [
        60 => ['from' => '97', 'to' => '111'],
    ];

    private const ATTACHABLE_RIDER_ID_REMAP = [
        '1024' => '1026',
    ];

    private const ATTACHABLE_RIDER_IDS_REMOVED = [
        '204' => true,
        '205' => true,
    ];

    private const SINGLE_FREQUENCIES = ['Single'];

    private const REGULAR_FREQUENCIES = [
        'Annual',
        'Semi-Annual',
        'Quarterly',
        'Mthly-1',
        'Mthly-2',
    ];

    private const FREQUENCY_SINGLE = 1;
    private const FREQUENCY_MONTHLY_1 = 2;
    private const FREQUENCY_MONTHLY_2 = 4;
    private const FREQUENCY_QUARTERLY = 8;
    private const FREQUENCY_SEMI_ANNUAL = 16;
    private const FREQUENCY_ANNUAL = 32;
    private const OPTION_LABEL_PREFIX_PATTERN = '/^(?:Issue Age|Premium Term|Entry Age)(?=\\s|[:\\-]|$)\\s*[:\\-]?\\s*/i';

    public function run(): void
    {
        $seedData = $this->loadSeedDataFromCsv();
        if ($seedData === null) {
            return;
        }

        $types = is_array($seedData['types'] ?? null) ? $seedData['types'] : [];
        $basePlans = is_array($seedData['basePlans'] ?? null) ? $seedData['basePlans'] : [];
        $riders = is_array($seedData['riders'] ?? null) ? $seedData['riders'] : [];
        $settings = is_array($seedData['settings'] ?? null) ? $seedData['settings'] : [];
        $gst = $this->toNullableNumber($settings['gst'] ?? null);
        $now = now();

        $typeKeys = [];
        $seededRiderIds = [];
        $seededBaseIds = [];
        $optionsInserted = 0;
        $frequenciesInserted = 0;
        $attachablesInserted = 0;

        DB::transaction(function () use (
            $types,
            $riders,
            $basePlans,
            $gst,
            $now,
            &$typeKeys,
            &$seededRiderIds,
            &$seededBaseIds,
            &$optionsInserted,
            &$frequenciesInserted,
            &$attachablesInserted
        ): void {
            DB::table('product_attachable_riders')->delete();
            DB::table('product_options')->delete();
            DB::table('products')->delete();
            DB::table('product_type_definitions')->delete();

            $typePosition = 0;
            foreach ($types as $type) {
                if (!is_array($type)) {
                    continue;
                }

                $typeKey = trim((string) ($type['typeKey'] ?? $type['type_key'] ?? ''));
                $label = trim((string) ($type['label'] ?? ''));
                if ($typeKey === '' || $label === '') {
                    continue;
                }

                DB::table('product_type_definitions')->insert([
                    'type_key' => substr($typeKey, 0, 50),
                    'label' => substr($label, 0, 100),
                    'position' => $typePosition,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                $typeKeys[$typeKey] = true;
                $typePosition++;
            }

            foreach (array_values($riders) as $position => $rider) {
                if (!is_array($rider)) {
                    continue;
                }

                $id = $this->seedProduct($rider, true, $position, $typeKeys, $now, $optionsInserted, $frequenciesInserted);
                if ($id !== null) {
                    $seededRiderIds[$id] = true;
                }
            }

            foreach (array_values($basePlans) as $position => $plan) {
                if (!is_array($plan)) {
                    continue;
                }

                $id = $this->seedProduct($plan, false, $position, $typeKeys, $now, $optionsInserted, $frequenciesInserted);
                if ($id === null) {
                    continue;
                }

                $seededBaseIds[$id] = true;
                $attachableRiders = is_array($plan['attachableRiders'] ?? null)
                    ? $plan['attachableRiders']
                    : (is_array($plan['attachable_riders'] ?? null) ? $plan['attachable_riders'] : []);

                $seenAttachables = [];
                $attachablePosition = 0;
                foreach (array_values($attachableRiders) as $riderIdRaw) {
                    $riderId = trim((string) $riderIdRaw);
                    if ($riderId === '' || isset($seenAttachables[$riderId])) {
                        continue;
                    }
                    if (!isset($seededRiderIds[$riderId])) {
                        $this->command?->warn("LegacyImportProductsSeeder: base {$id} references unknown rider {$riderId}; skipped.");
                        continue;
                    }

                    DB::table('product_attachable_riders')->insert([
                        'base_product_id' => $id,
                        'rider_id' => $riderId,
                        'position' => $attachablePosition,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                    $seenAttachables[$riderId] = true;
                    $attachablePosition++;
                    $attachablesInserted++;
                }
            }

            DB::table('product_settings')->updateOrInsert(
                ['id' => 1],
                [
                    'gst' => $gst,
                    'updated_by' => null,
                    'updated_at' => $now,
                    'created_at' => $now,
                ]
            );
        });

        $this->command?->info(
            'Legacy product import complete: '
            . 'types=' . count($typeKeys)
            . ', basePlans=' . count($seededBaseIds)
            . ', riders=' . count($seededRiderIds)
            . ', options=' . $optionsInserted
            . ', frequencies=' . $frequenciesInserted
            . ', attachables=' . $attachablesInserted
            . ', gst=' . ($gst !== null ? (string) $gst : 'null')
            . '.'
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    private function loadSeedDataFromCsv(): ?array
    {
        $baseRows = $this->loadCsvRows(self::PRODUCTS_BASE_SEED_RELATIVE_PATH);
        if ($baseRows === null) {
            return null;
        }

        $riderRows = $this->loadCsvRows(self::PRODUCTS_RIDERS_SEED_RELATIVE_PATH);
        if ($riderRows === null) {
            return null;
        }

        $basePlans = $this->buildProductsFromRows($baseRows, true);
        $riders = $this->buildProductsFromRows($riderRows, false);

        if ($basePlans === [] && $riders === []) {
            $this->command?->warn('Legacy product import CSV has no products. Skipping LegacyImportProductsSeeder.');
            return null;
        }

        return [
            'types' => $this->buildTypeDefinitions($basePlans, $riders),
            'basePlans' => $basePlans,
            'riders' => $riders,
            'settings' => [
                'gst' => $this->detectGstRate($baseRows, $riderRows),
            ],
        ];
    }

    /**
     * @return array<int, array<string, string>>|null
     */
    private function loadCsvRows(string $relativePath): ?array
    {
        $seedPath = base_path($relativePath);
        if (!is_file($seedPath)) {
            $this->command?->warn("Legacy product import data not found at {$seedPath}. Skipping LegacyImportProductsSeeder.");
            return null;
        }

        $handle = fopen($seedPath, 'rb');
        if ($handle === false) {
            $this->command?->warn("Unable to read legacy product import data at {$seedPath}. Skipping LegacyImportProductsSeeder.");
            return null;
        }

        $headers = fgetcsv($handle);
        if (!is_array($headers)) {
            fclose($handle);
            $this->command?->warn("Invalid CSV header in {$seedPath}. Skipping LegacyImportProductsSeeder.");
            return null;
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

            $row['sourceLine'] = (string) $sourceLine;
            $rows[] = $row;
        }

        fclose($handle);

        return $rows;
    }

    /**
     * @param array<int, array<string, string>> $rows
     * @return array<int, array<string, mixed>>
     */
    private function buildProductsFromRows(array $rows, bool $includeAttachableRiders): array
    {
        $products = [];
        $currentIndex = null;

        foreach ($rows as $row) {
            $idRaw = trim((string) ($row['id'] ?? ''));

            if ($idRaw !== '') {
                $sourceLine = (int) ($row['sourceLine'] ?? 0);
                $id = $includeAttachableRiders
                    ? $this->normalizeBaseProductId($idRaw, $sourceLine)
                    : $idRaw;

                if ($id === '') {
                    $currentIndex = null;
                    continue;
                }

                $description = trim((string) ($row['description'] ?? ''));
                $typeKey = strtolower(trim((string) ($row['type'] ?? '')));

                $product = [
                    'sourceLine' => $sourceLine,
                    'id' => $id,
                    'category' => $this->nullableTrimmedString($row['category'] ?? null),
                    'type' => $typeKey !== '' ? $typeKey : null,
                    'fullName' => $this->nullableTrimmedString($row['fullName'] ?? null),
                    'shortName' => $this->nullableTrimmedString($row['displayName'] ?? null),
                    'notes' => $this->normalizeDescription($description),
                    'optionTitle' => $this->nullableTrimmedString($row['optionTitle'] ?? null),
                    'options' => [],
                    'fycRate' => null,
                    'gst' => $this->normalizeGstMarker($row['gst'] ?? null),
                    'frequencies' => $this->defaultFrequenciesForType($typeKey),
                ];

                if ($includeAttachableRiders) {
                    $product['attachableRiders'] = $this->parseAttachableRiders((string) ($row['attachableRiders'] ?? ''));
                }

                $products[] = $product;
                $currentIndex = array_key_last($products);
            }

            if ($currentIndex === null) {
                continue;
            }

            $optionTitle = trim((string) ($row['optionTitle'] ?? ''));
            if ($optionTitle !== '') {
                $products[$currentIndex]['optionTitle'] = $optionTitle;
            }

            $optionValue = $this->normalizeOptionLabel((string) ($row['optionValue'] ?? ''));
            $fycRate = trim((string) ($row['fycRate'] ?? ''));
            if ($optionValue !== '') {
                $this->upsertProductOption($products[$currentIndex], $optionValue, $fycRate);
                continue;
            }

            if ($fycRate !== '' && ($products[$currentIndex]['fycRate'] ?? null) === null) {
                $products[$currentIndex]['fycRate'] = $fycRate;
            }
        }

        return array_values(array_map(
            fn (array $product): array => $this->finalizeProductRow($product),
            $products
        ));
    }

    private function normalizeBaseProductId(string $id, int $sourceLine): string
    {
        $override = self::BASE_PRODUCT_ID_OVERRIDES_BY_SOURCE_LINE[$sourceLine] ?? null;
        if (!is_array($override)) {
            return $id;
        }

        $from = trim((string) ($override['from'] ?? ''));
        $to = trim((string) ($override['to'] ?? ''));
        if ($from === '' || $to === '' || $id !== $from) {
            return $id;
        }

        return $to;
    }

    /**
     * @return array<int, string>
     */
    private function parseAttachableRiders(string $raw): array
    {
        $normalized = trim($raw);
        if ($normalized === '' || $normalized === '-') {
            return [];
        }

        $result = [];
        $seen = [];
        foreach (preg_split('/\s+/', $normalized) ?: [] as $piece) {
            $riderId = trim((string) $piece);
            if ($riderId === '') {
                continue;
            }

            $riderId = self::ATTACHABLE_RIDER_ID_REMAP[$riderId] ?? $riderId;
            if (isset(self::ATTACHABLE_RIDER_IDS_REMOVED[$riderId])) {
                continue;
            }

            if (isset($seen[$riderId])) {
                continue;
            }

            $seen[$riderId] = true;
            $result[] = $riderId;
        }

        return $result;
    }

    /**
     * @param array<string, mixed> $product
     */
    private function upsertProductOption(array &$product, string $label, string $fycRate): void
    {
        $options = is_array($product['options'] ?? null) ? $product['options'] : [];

        foreach ($options as $index => $option) {
            $existingLabel = trim((string) ($option['label'] ?? ''));
            if ($existingLabel !== $label) {
                continue;
            }

            $options[$index]['fycRate'] = $fycRate;
            $product['options'] = $options;
            return;
        }

        $options[] = [
            'label' => $label,
            'fycRate' => $fycRate,
        ];

        $product['options'] = $options;
    }

    /**
     * @param array<string, mixed> $product
     * @return array<string, mixed>
     */
    private function finalizeProductRow(array $product): array
    {
        $normalized = [
            'id' => trim((string) ($product['id'] ?? '')),
            'sourceLine' => (int) ($product['sourceLine'] ?? 0),
            'category' => $this->nullableTrimmedString($product['category'] ?? null),
            'type' => $this->nullableTrimmedString($product['type'] ?? null),
            'fullName' => $this->nullableTrimmedString($product['fullName'] ?? null),
            'shortName' => $this->nullableTrimmedString($product['shortName'] ?? null),
            'attachedSuffix' => $this->nullableTrimmedString($product['attachedSuffix'] ?? null),
            'notes' => $this->nullableTrimmedString($product['notes'] ?? null),
            'optionTitle' => $this->nullableTrimmedString($product['optionTitle'] ?? null),
            'fycRate' => $this->nullableTrimmedString($product['fycRate'] ?? null),
            'gst' => $this->nullableTrimmedString($product['gst'] ?? null),
            'frequencies' => is_array($product['frequencies'] ?? null) ? $product['frequencies'] : [],
            'options' => is_array($product['options'] ?? null) ? $product['options'] : [],
        ];

        if (is_array($product['attachableRiders'] ?? null)) {
            $normalized['attachableRiders'] = $product['attachableRiders'];
        }

        foreach (['category', 'type', 'fullName', 'shortName', 'attachedSuffix', 'notes', 'optionTitle', 'fycRate', 'gst'] as $field) {
            if (($normalized[$field] ?? null) === null) {
                unset($normalized[$field]);
            }
        }

        if (($normalized['sourceLine'] ?? 0) <= 0) {
            unset($normalized['sourceLine']);
        }

        if (($normalized['frequencies'] ?? []) === []) {
            unset($normalized['frequencies']);
        }

        if (($normalized['options'] ?? []) === []) {
            unset($normalized['options']);
        }

        if (($normalized['attachableRiders'] ?? []) === []) {
            unset($normalized['attachableRiders']);
        }

        return $normalized;
    }

    /**
     * @param array<int, array<string, mixed>> $basePlans
     * @param array<int, array<string, mixed>> $riders
     * @return array<int, array<string, mixed>>
     */
    private function buildTypeDefinitions(array $basePlans, array $riders): array
    {
        $seenTypeKeys = [];
        foreach (array_merge($basePlans, $riders) as $product) {
            $typeKey = strtolower(trim((string) ($product['type'] ?? '')));
            if ($typeKey !== '') {
                $seenTypeKeys[$typeKey] = true;
            }
        }

        $types = [];
        $position = 0;

        foreach (array_keys(self::PRODUCT_TYPE_LABELS) as $knownTypeKey) {
            if (!isset($seenTypeKeys[$knownTypeKey])) {
                continue;
            }

            $types[] = [
                'typeKey' => $knownTypeKey,
                'label' => self::PRODUCT_TYPE_LABELS[$knownTypeKey],
                'position' => $position,
            ];
            unset($seenTypeKeys[$knownTypeKey]);
            $position++;
        }

        $remainingTypeKeys = array_keys($seenTypeKeys);
        sort($remainingTypeKeys);

        foreach ($remainingTypeKeys as $typeKey) {
            $types[] = [
                'typeKey' => $typeKey,
                'label' => $this->fallbackTypeLabel($typeKey),
                'position' => $position,
            ];
            $position++;
        }

        return $types;
    }

    private function fallbackTypeLabel(string $typeKey): string
    {
        if (isset(self::FALLBACK_PRODUCT_TYPE_LABELS[$typeKey])) {
            return self::FALLBACK_PRODUCT_TYPE_LABELS[$typeKey];
        }

        $label = str_replace(['-', '_'], ' ', strtolower($typeKey));
        return ucwords($label);
    }

    /**
     * @param array<int, array<string, string>> $baseRows
     * @param array<int, array<string, string>> $riderRows
     */
    private function detectGstRate(array $baseRows, array $riderRows): ?float
    {
        $values = [];

        foreach (array_merge($baseRows, $riderRows) as $row) {
            $gstRaw = trim((string) ($row['gst'] ?? ''));
            if ($gstRaw === '' || !is_numeric($gstRaw)) {
                continue;
            }

            $values[(string) ((float) $gstRaw)] = (float) $gstRaw;
        }

        if ($values === []) {
            return null;
        }

        $rates = array_values($values);
        sort($rates, SORT_NUMERIC);

        if (count($rates) > 1) {
            $this->command?->warn('LegacyImportProductsSeeder: multiple GST values detected in CSV; using highest value.');
        }

        return $rates[count($rates) - 1];
    }

    /**
     * @return array<int, string>
     */
    private function defaultFrequenciesForType(string $typeKey): array
    {
        if (strtolower(trim($typeKey)) === 'single') {
            return self::SINGLE_FREQUENCIES;
        }

        return self::REGULAR_FREQUENCIES;
    }

    private function normalizeDescription(string $value): ?string
    {
        $description = trim($value);
        if ($description === '') {
            return null;
        }

        return $description;
    }

    private function normalizeOptionLabel(string $value): string
    {
        $label = trim($value);
        if ($label === '') {
            return '';
        }

        $label = (string) preg_replace(self::OPTION_LABEL_PREFIX_PATTERN, '', $label);

        return trim((string) preg_replace('/\s+/', ' ', $label));
    }

    private function normalizeGstMarker(mixed $value): ?string
    {
        $text = trim((string) ($value ?? ''));
        return $text === '' ? null : 'Y';
    }

    private function nullableTrimmedString(mixed $value): ?string
    {
        $text = trim((string) ($value ?? ''));
        return $text === '' ? null : $text;
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
     * @param array<string, mixed> $row
     * @param array<string, bool> $typeKeys
     */
    private function seedProduct(
        array $row,
        bool $isRider,
        int $position,
        array $typeKeys,
        \DateTimeInterface|string $now,
        int &$optionsInserted,
        int &$frequenciesInserted
    ): ?string {
        $id = trim((string) ($row['id'] ?? ''));
        if ($id === '') {
            return null;
        }

        $typeKeyRaw = trim((string) ($row['type'] ?? $row['typeKey'] ?? $row['type_key'] ?? ''));
        $typeKey = $typeKeyRaw !== '' && isset($typeKeys[$typeKeyRaw]) ? $typeKeyRaw : null;
        if ($typeKeyRaw !== '' && $typeKey === null) {
            $this->command?->warn("LegacyImportProductsSeeder: {$id} has unknown type '{$typeKeyRaw}'; type_key set to null.");
        }
        $frequencies = is_array($row['frequencies'] ?? null) ? $row['frequencies'] : [];
        $frequencyMask = $this->frequencyMaskFromInput($frequencies);

        DB::table('products')->insert([
            'id' => substr($id, 0, 100),
            'is_rider' => $isRider,
            'category' => $this->nullableString($row['category'] ?? null, 100),
            'full_name' => $this->nullableString($row['fullName'] ?? $row['full_name'] ?? null, 200),
            'short_name' => $this->nullableString($row['shortName'] ?? $row['short_name'] ?? null, 120),
            'attached_suffix' => $this->nullableString($row['attachedSuffix'] ?? $row['attached_suffix'] ?? null, 120),
            'type_key' => $this->nullableString($typeKey, 50),
            'notes' => $this->nullableString($row['notes'] ?? null, 65535),
            'option_title' => $this->nullableString($row['optionTitle'] ?? $row['option_title'] ?? null, 150),
            'fyc_rate' => $this->nullableString($row['fycRate'] ?? $row['fyc_rate'] ?? null, 20),
            'frequency_mask' => $frequencyMask,
            'gst' => $this->nullableString($row['gst'] ?? null, 20),
            'position' => $position,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $options = is_array($row['options'] ?? null) ? $row['options'] : [];
        $optionPosition = 0;
        foreach (array_values($options) as $option) {
            if (!is_array($option)) {
                continue;
            }
            $label = trim((string) ($option['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            DB::table('product_options')->insert([
                'product_id' => $id,
                'label' => substr($label, 0, 150),
                'fyc_rate' => $this->nullableString($option['fycRate'] ?? $option['fyc_rate'] ?? null, 20),
                'position' => $optionPosition,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $optionPosition++;
            $optionsInserted++;
        }
        $frequenciesInserted += $this->countFrequencyBits($frequencyMask);

        return $id;
    }

    private function nullableString(mixed $value, int $maxLength): ?string
    {
        $text = trim((string) ($value ?? ''));
        if ($text === '') {
            return null;
        }
        return substr($text, 0, $maxLength);
    }

    private function toNullableNumber(mixed $value): ?float
    {
        if (is_numeric($value)) {
            return (float) $value;
        }
        if (is_string($value)) {
            $text = trim($value);
            if ($text !== '' && is_numeric($text)) {
                return (float) $text;
            }
        }

        return null;
    }

    private function frequencyMaskFromInput(array $frequencies): int
    {
        $mask = 0;
        foreach ($frequencies as $frequency) {
            $mask |= $this->frequencyBit($frequency);
        }

        return $mask;
    }

    private function frequencyBit(mixed $frequency): int
    {
        $key = strtolower(trim((string) $frequency));
        $key = str_replace(['_', ' '], '-', $key);

        return match ($key) {
            'single' => self::FREQUENCY_SINGLE,
            'monthly-1', 'mthly-1' => self::FREQUENCY_MONTHLY_1,
            'monthly-2', 'mthly-2' => self::FREQUENCY_MONTHLY_2,
            'quarterly' => self::FREQUENCY_QUARTERLY,
            'semi-annual', 'semiannual' => self::FREQUENCY_SEMI_ANNUAL,
            'annual' => self::FREQUENCY_ANNUAL,
            default => 0,
        };
    }

    private function countFrequencyBits(int $mask): int
    {
        $count = 0;
        foreach ([
            self::FREQUENCY_SINGLE,
            self::FREQUENCY_MONTHLY_1,
            self::FREQUENCY_MONTHLY_2,
            self::FREQUENCY_QUARTERLY,
            self::FREQUENCY_SEMI_ANNUAL,
            self::FREQUENCY_ANNUAL,
        ] as $bit) {
            if (($mask & $bit) === $bit) {
                $count++;
            }
        }

        return $count;
    }
}
