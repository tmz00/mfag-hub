<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class LegacyImportClosingsSeeder extends Seeder
{
    private const CLOSINGS_SEED_RELATIVE_PATH = 'database/seeders/legacy-data/closings.json';
    private const LEGACY_LOCAL_TIMEZONE_FALLBACK = 'Asia/Singapore';
    private const SOURCE_ORDER = [
        'warm',
        'existing',
        'assigned',
        'referral',
        'roadshow',
        'social media',
        'seminar',
        'aia campaign',
        'other (cold)',
    ];

    public function run(): void
    {
        $rows = $this->loadSeedRows();
        if ($rows === []) {
            $this->command?->warn('Legacy closing import data has no closings. Skipping LegacyImportClosingsSeeder.');
            return;
        }

        $now = now();
        $usersByFscCode = $this->loadUsersByFscCode();
        $knownProducts = $this->loadKnownProducts();
        $knownProductTypeKeys = $this->loadKnownProductTypeKeys();
        [
            $sourceRows,
            $sourceItemRows,
            $sourceSeedStats,
            $sourceIdByKey,
            $seededSourceItemsBySourceKey,
            $sourceItemIdsBySourceKey,
        ] =
            $this->buildSourceRows($rows, $now);

        $stats = [
            'processedClosings' => 0,
            'insertedClosings' => 0,
            'insertedItems' => 0,
            'insertedRiders' => 0,
            'insertedPremiums' => 0,
            'skippedUnknownOwner' => 0,
            'skippedMissingSource' => 0,
            'skippedNoValidRootItems' => 0,
            'skippedInvalidItems' => 0,
            'skippedInvalidPremiums' => 0,
            'sourceItemPresent' => 0,
            'sourceItemMissing' => 0,
            'unmappedYearField' => 0,
            'unmappedMonthField' => 0,
            'unmappedDayField' => 0,
            'unmappedItemIdField' => 0,
            'unmappedItemCategoryField' => 0,
            'premiumTermObjectCount' => 0,
            'premiumTermObjectWithoutLabel' => 0,
            'unmappedPremiumTermFycRate' => 0,
            'timestampReconstructedFromDateParts' => 0,
            'timestampFallbackToNow' => 0,
            'insertedMissingProducts' => 0,
            'insertedMissingRiders' => 0,
            'productNameMismatches' => 0,
            'legacyProduct97RemappedTo111' => 0,
        ];

        $unknownOwnerCodes = [];
        $unknownSharedCodes = [];
        $unknownProductRefs = [];
        $productNameMismatchRefs = [];
        $sourceItemUsageCounts = [];
        $sourceLabelsById = [];
        foreach ($sourceRows as $sourceRow) {
            if (!is_array($sourceRow)) {
                continue;
            }
            $sourceId = $this->nullableString($sourceRow['id'] ?? null, 100);
            $sourceLabel = $this->nullableString($sourceRow['label'] ?? null, 150);
            if ($sourceId === null || $sourceLabel === null) {
                continue;
            }
            $sourceLabelsById[$sourceId] = $sourceLabel;
        }

        DB::transaction(function () use (
            $rows,
            $sourceRows,
            $sourceItemRows,
            $sourceIdByKey,
            $seededSourceItemsBySourceKey,
            $sourceItemIdsBySourceKey,
            $usersByFscCode,
            &$knownProducts,
            $knownProductTypeKeys,
            $now,
            &$stats,
            &$unknownOwnerCodes,
            &$unknownSharedCodes,
            &$unknownProductRefs,
            &$productNameMismatchRefs,
            &$sourceItemUsageCounts
        ): void {
            if ($sourceRows !== []) {
                DB::table('sources')->upsert(
                    $sourceRows,
                    ['id'],
                    ['label', 'description', 'position', 'is_deleted', 'updated_at'],
                );
            }

            if ($sourceItemRows !== []) {
                DB::table('source_items')->upsert(
                    $sourceItemRows,
                    ['id'],
                    ['source_id', 'label', 'position', 'is_deleted', 'updated_at'],
                );
            }

            DB::table('closing_item_premiums')->delete();
            DB::table('closing_items')->delete();
            DB::table('closings')->delete();

            foreach (array_values($rows) as $row) {
                if (!is_array($row)) {
                    continue;
                }

                $stats['processedClosings']++;

                if (array_key_exists('year', $row)) {
                    $stats['unmappedYearField']++;
                }
                if (array_key_exists('month', $row)) {
                    $stats['unmappedMonthField']++;
                }
                if (array_key_exists('day', $row)) {
                    $stats['unmappedDayField']++;
                }

                $ownerCode = $this->nullableString($row['fscCode'] ?? null, 20);
                $owner = $ownerCode !== null ? ($usersByFscCode[$ownerCode] ?? null) : null;
                if ($owner === null) {
                    $stats['skippedUnknownOwner']++;
                    if ($ownerCode !== null) {
                        $unknownOwnerCodes[$ownerCode] = ($unknownOwnerCodes[$ownerCode] ?? 0) + 1;
                    }
                    continue;
                }

                $sourceMapping = $this->mapSourceFromRow($row);
                $sourceKey = $sourceMapping['sourceKey'];
                if ($sourceKey === null) {
                    $stats['skippedMissingSource']++;
                    continue;
                }
                $sourceId = $sourceIdByKey[$sourceKey] ?? null;
                if ($sourceId === null) {
                    $stats['skippedMissingSource']++;
                    continue;
                }

                $sourceItemLabel = $sourceMapping['sourceItemKey'];
                $sourceItemId = null;
                if ($sourceItemLabel !== null) {
                    $sourceItemLookupKey = $this->normalizeLookupKey($sourceItemLabel);
                    if (
                        $sourceItemLookupKey !== ''
                        && isset($seededSourceItemsBySourceKey[$sourceKey][$sourceItemLookupKey])
                        && isset($sourceItemIdsBySourceKey[$sourceKey][$sourceItemLookupKey])
                    ) {
                        $sourceItemId = (int) $sourceItemIdsBySourceKey[$sourceKey][$sourceItemLookupKey];
                    }
                }
                if ($sourceItemId !== null) {
                    $stats['sourceItemPresent']++;
                } else {
                    $stats['sourceItemMissing']++;
                }

                $parsedSubmittedAt = $this->parseSubmittedAt($row);
                if ($parsedSubmittedAt['reconstructed']) {
                    $stats['timestampReconstructedFromDateParts']++;
                }
                if ($parsedSubmittedAt['fallbackNow']) {
                    $stats['timestampFallbackToNow']++;
                }
                $submittedAt = $parsedSubmittedAt['value'];

                $sharedCode = $this->nullableString($row['sharedFscCode'] ?? null, 20);
                $shared = $sharedCode !== null ? ($usersByFscCode[$sharedCode] ?? null) : null;

                if ($sharedCode !== null && $shared === null) {
                    $unknownSharedCodes[$sharedCode] = ($unknownSharedCodes[$sharedCode] ?? 0) + 1;
                }

                $isShared = $shared !== null || $sharedCode !== null;

                $closingId = DB::table('closings')->insertGetId([
                    'submitted_at' => $submittedAt,
                    'fsc_user_id' => (int) $owner['id'],
                    'fsc_code' => (string) $owner['fsc_code'],
                    'fsc_agency_code' => $this->nullableString($owner['agency_code'] ?? null, 50),
                    'is_shared' => $isShared,
                    'shared_fsc_user_id' => $shared !== null ? (int) $shared['id'] : null,
                    'shared_fsc_code' => $shared !== null
                        ? $this->nullableString($shared['fsc_code'] ?? null, 20)
                        : $sharedCode,
                    'shared_fsc_agency_code' => $shared !== null
                        ? $this->nullableString($shared['agency_code'] ?? null, 50)
                        : null,
                    'source_id' => $sourceId,
                    'source_item_id' => $sourceItemId,
                    'source_comment' => $sourceMapping['sourceComment'],
                    'referrals' => max(0, (int) ($row['referrals'] ?? 0)),
                    'referrals_comment' => $this->nullableString($row['referralsComment'] ?? null, 65535),
                    'created_by' => null,
                    'updated_by' => null,
                    'created_at' => $submittedAt,
                    'updated_at' => $submittedAt,
                ]);

                $items = is_array($row['items'] ?? null) ? $row['items'] : [];
                $rootItemsInserted = $this->insertClosingItems(
                    (int) $closingId,
                    $items,
                    $submittedAt,
                    $knownProducts,
                    $knownProductTypeKeys,
                    $unknownProductRefs,
                    $productNameMismatchRefs,
                    $stats,
                );

                if ($rootItemsInserted <= 0) {
                    DB::table('closings')->where('id', $closingId)->delete();
                    $stats['skippedNoValidRootItems']++;
                    continue;
                }

                if ($sourceItemId !== null && $sourceItemLabel !== null) {
                    if (!isset($sourceItemUsageCounts[$sourceId])) {
                        $sourceItemUsageCounts[$sourceId] = [];
                    }
                    $sourceItemUsageCounts[$sourceId][$sourceItemLabel] =
                        (int) (($sourceItemUsageCounts[$sourceId][$sourceItemLabel] ?? 0) + 1);
                }

                $stats['insertedClosings']++;
            }
        });

        ksort($unknownOwnerCodes);
        ksort($unknownSharedCodes);
        ksort($unknownProductRefs);
        ksort($productNameMismatchRefs);
        ksort($sourceItemUsageCounts);

        $this->command?->info(
            'Legacy sources import complete: '
                . 'sources=' . count($sourceRows)
                . ', sourceItems=' . count($sourceItemRows)
                . ', itemsFromSourceComment=' . $sourceSeedStats['itemsFromSourceComment']
                . ', itemsFromSourceDetail=' . $sourceSeedStats['itemsFromSourceDetail']
                . ', duplicateItemsSkipped=' . $sourceSeedStats['duplicateItemsSkipped']
                . ', remappedWarmToSocialMedia=' . $sourceSeedStats['remappedWarmToSocialMedia']
                . ', remappedWarmToWarm=' . $sourceSeedStats['remappedWarmToWarm']
                . ', remappedWarmToRoadshow=' . $sourceSeedStats['remappedWarmToRoadshow']
                . ', remappedToAssigned=' . $sourceSeedStats['remappedToAssigned']
                . ', remappedExistingToExisting=' . $sourceSeedStats['remappedExistingToExisting']
                . ', remappedExistingToCampaigns=' . $sourceSeedStats['remappedExistingToCampaigns']
                . ', remappedReferralToReferral=' . $sourceSeedStats['remappedReferralToReferral']
                . ', remappedItemToAmomusPodcast=' . $sourceSeedStats['remappedItemToAmomusPodcast']
                . ', remappedItemToShameemSeminar=' . $sourceSeedStats['remappedItemToShameemSeminar']
                . ', remappedItemToSafinahInstitute=' . $sourceSeedStats['remappedItemToSafinahInstitute']
                . ', remappedItemToFacebook=' . $sourceSeedStats['remappedItemToFacebook']
                . ', remappedItemToInstagram=' . $sourceSeedStats['remappedItemToInstagram']
                . ', remappedItemToSyarifAds=' . $sourceSeedStats['remappedItemToSyarifAds']
                . ', remappedItemToSyazwanTikTok=' . $sourceSeedStats['remappedItemToSyazwanTikTok']
                . ', remappedItemToIftarWithSitiNurhaliza=' . $sourceSeedStats['remappedItemToIftarWithSitiNurhaliza']
                . ', remappedItemToBeatInflation=' . $sourceSeedStats['remappedItemToBeatInflation']
                . ', remappedItemToMegaxpress=' . $sourceSeedStats['remappedItemToMegaxpress']
                . ', remappedItemToMuslimFest=' . $sourceSeedStats['remappedItemToMuslimFest']
                . ', remappedItemNeighbourToWarm=' . $sourceSeedStats['remappedItemNeighbourToWarm']
                . ', remappedItemToGlamEid=' . $sourceSeedStats['remappedItemToGlamEid']
                . ', remappedItemToHalalFoodsInternational=' . $sourceSeedStats['remappedItemToHalalFoodsInternational']
                . ', remappedItemToMuhajirin=' . $sourceSeedStats['remappedItemToMuhajirin']
                . ', remappedItemToStarlightMff=' . $sourceSeedStats['remappedItemToStarlightMff']
                . ', excludedSourceItemsByKeyword=' . $sourceSeedStats['excludedSourceItemsByKeyword']
                . ', excludedSingleUseSourceItems=' . $sourceSeedStats['excludedSingleUseSourceItems']
                . ', softDeletedSources=' . $sourceSeedStats['softDeletedSources']
                . ', softDeletedSourceItems=' . $sourceSeedStats['softDeletedSourceItems']
                . '.'
        );

        $this->command?->info(
            'Legacy closings import complete: '
                . 'processed=' . $stats['processedClosings']
                . ', insertedClosings=' . $stats['insertedClosings']
                . ', insertedItems=' . $stats['insertedItems']
                . ', insertedRiders=' . $stats['insertedRiders']
                . ', insertedPremiums=' . $stats['insertedPremiums']
                . ', skippedUnknownOwner=' . $stats['skippedUnknownOwner']
                . ', skippedMissingSource=' . $stats['skippedMissingSource']
                . ', skippedNoValidRootItems=' . $stats['skippedNoValidRootItems']
                . ', skippedInvalidItems=' . $stats['skippedInvalidItems']
                . ', skippedInvalidPremiums=' . $stats['skippedInvalidPremiums']
                . ', insertedMissingProducts=' . $stats['insertedMissingProducts']
                . ', insertedMissingRiders=' . $stats['insertedMissingRiders']
                . ', productNameMismatches=' . $stats['productNameMismatches']
                . ', legacyProduct97RemappedTo111=' . $stats['legacyProduct97RemappedTo111']
                . ', sourceRows=' . count($sourceRows)
                . ', sourceItemRows=' . count($sourceItemRows)
                . '.'
        );

        $this->command?->info(
            'Legacy closing import mapping diagnostics: '
                . 'sourceItemPresent=' . $stats['sourceItemPresent']
                . ', sourceItemMissing=' . $stats['sourceItemMissing']
                . ', unmappedYearField=' . $stats['unmappedYearField']
                . ', unmappedMonthField=' . $stats['unmappedMonthField']
                . ', unmappedDayField=' . $stats['unmappedDayField']
                . ', unmappedItemIdField=' . $stats['unmappedItemIdField']
                . ', unmappedItemCategoryField=' . $stats['unmappedItemCategoryField']
                . ', premiumTermObjectCount=' . $stats['premiumTermObjectCount']
                . ', premiumTermObjectWithoutLabel=' . $stats['premiumTermObjectWithoutLabel']
                . ', unmappedPremiumTermFycRate=' . $stats['unmappedPremiumTermFycRate']
                . ', timestampReconstructed=' . $stats['timestampReconstructedFromDateParts']
                . ', timestampFallbackToNow=' . $stats['timestampFallbackToNow']
                . '.'
        );

        if ($unknownOwnerCodes !== []) {
            $this->command?->warn(
                'LegacyImportClosingsSeeder: unknown owner FSC codes (rows skipped): '
                    . $this->formatFrequencyMap($unknownOwnerCodes)
                    . '.'
            );
        }

        if ($unknownSharedCodes !== []) {
            $this->command?->warn(
                'LegacyImportClosingsSeeder: unknown shared FSC codes (shared_fsc_user_id left null): '
                    . $this->formatFrequencyMap($unknownSharedCodes)
                    . '.'
            );
        }

        $singleUseSourceItems = [];
        foreach ($sourceItemUsageCounts as $sourceId => $countsByItemKey) {
            if (!is_array($countsByItemKey)) {
                continue;
            }

            $sourceLabel = $sourceLabelsById[(string) $sourceId] ?? (string) $sourceId;
            foreach ($countsByItemKey as $itemKey => $count) {
                if ((int) $count !== 1) {
                    continue;
                }
                $singleUseSourceItems[] = $sourceLabel . ' => ' . (string) $itemKey;
            }
        }
        if ($singleUseSourceItems !== []) {
            sort($singleUseSourceItems, SORT_NATURAL | SORT_FLAG_CASE);
            $this->command?->warn(
                'LegacyImportClosingsSeeder: source items used by only one closing: '
                    . implode(', ', $singleUseSourceItems)
                    . '.'
            );
        }

        if ($productNameMismatchRefs !== []) {
            $this->command?->warn(
                'LegacyImportClosingsSeeder: product name mismatches (productId|dbName|closingName): '
                    . $this->formatFrequencyMap($productNameMismatchRefs)
                    . '.'
            );
        }

        if ($unknownProductRefs !== []) {
            $this->command?->warn(
                'LegacyImportClosingsSeeder: products referenced by closings that could not be inserted: '
                    . $this->formatFrequencyMap($unknownProductRefs)
                    . '.'
            );
        }
    }

    /**
     * @return array<int, mixed>
     */
    private function loadSeedRows(): array
    {
        $seedPath = base_path(self::CLOSINGS_SEED_RELATIVE_PATH);
        if (!is_file($seedPath)) {
            $this->command?->warn("Legacy closing import data not found at {$seedPath}. Skipping LegacyImportClosingsSeeder.");
            return [];
        }

        $contents = file_get_contents($seedPath);
        if ($contents === false) {
            $this->command?->warn("Unable to read legacy closing import data at {$seedPath}. Skipping LegacyImportClosingsSeeder.");
            return [];
        }

        $decoded = json_decode($contents, true);
        if (!is_array($decoded)) {
            $this->command?->warn("Invalid closing JSON in {$seedPath}. Skipping LegacyImportClosingsSeeder.");
            return [];
        }

        return $decoded;
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function loadUsersByFscCode(): array
    {
        $rows = DB::table('users as u')
            ->leftJoin('agencies as a', 'a.id', '=', 'u.agency_id')
            ->orderBy('u.id')
            ->get([
                'u.id',
                'u.fsc_code',
                'u.nickname',
                'u.full_name',
                'a.code as agency_code',
            ]);

        $result = [];
        foreach ($rows as $row) {
            $code = $this->nullableString($row->fsc_code ?? null, 20);
            if ($code === null || isset($result[$code])) {
                continue;
            }

            $result[$code] = [
                'id' => (int) $row->id,
                'fsc_code' => $code,
                'nickname' => $this->nullableString($row->nickname ?? null, 100),
                'full_name' => $this->nullableString($row->full_name ?? null, 150),
                'agency_code' => $this->nullableString($row->agency_code ?? null, 50),
            ];
        }

        return $result;
    }

    /**
     * @return array<string, array{full_name: ?string, full_name_norm: ?string, is_rider: bool}>
     */
    private function loadKnownProducts(): array
    {
        $rows = DB::table('products')
            ->orderBy('id')
            ->get(['id', 'full_name', 'is_rider']);

        $result = [];
        foreach ($rows as $row) {
            $id = $this->nullableString($row->id ?? null, 100);
            if ($id === null) {
                continue;
            }

            $fullName = $this->nullableString($row->full_name ?? null, 200);
            $result[$id] = [
                'full_name' => $fullName,
                'full_name_norm' => $this->normalizeProductName($fullName),
                'is_rider' => (bool) ($row->is_rider ?? false),
            ];
        }

        return $result;
    }

    /**
     * @return array<string, bool>
     */
    private function loadKnownProductTypeKeys(): array
    {
        return DB::table('product_type_definitions')
            ->where('is_deleted', false)
            ->pluck('type_key')
            ->mapWithKeys(static fn(mixed $typeKey): array => [
                (string) $typeKey => true,
            ])
            ->all();
    }

    /**
     * @param array<int, mixed> $rows
     * @return array{
     *   0: array<int, array<string, mixed>>,
     *   1: array<int, array<string, mixed>>,
     *   2: array{
     *     itemsFromSourceComment: int,
     *     itemsFromSourceDetail: int,
     *     duplicateItemsSkipped: int,
     *     remappedWarmToSocialMedia: int,
     *     remappedWarmToWarm: int,
     *     remappedWarmToRoadshow: int,
     *     remappedToAssigned: int,
     *     remappedExistingToExisting: int,
     *     remappedExistingToCampaigns: int,
     *     remappedReferralToReferral: int,
     *     remappedItemToAmomusPodcast: int,
     *     remappedItemToShameemSeminar: int,
     *     remappedItemToSafinahInstitute: int,
     *     remappedItemToFacebook: int,
     *     remappedItemToInstagram: int,
     *     remappedItemToSyarifAds: int,
     *     remappedItemToSyazwanTikTok: int,
     *     remappedItemToIftarWithSitiNurhaliza: int,
     *     remappedItemToBeatInflation: int,
     *     remappedItemToMegaxpress: int,
     *     remappedItemToMuslimFest: int,
     *     remappedItemNeighbourToWarm: int,
     *     remappedItemToGlamEid: int,
     *     remappedItemToHalalFoodsInternational: int,
     *     remappedItemToMuhajirin: int,
     *     remappedItemToStarlightMff: int,
     *     excludedSourceItemsByKeyword: int,
     *     excludedSingleUseSourceItems: int,
     *     softDeletedSources: int,
     *     softDeletedSourceItems: int
     *   },
     *   3: array<string, string>,
     *   4: array<string, array<string, bool>>,
     *   5: array<string, array<string, int>>
     * }
     */
    private function buildSourceRows(array $rows, \DateTimeInterface $now): array
    {
        $sourceLabelsByKey = [];
        $sourceOrder = [];
        $itemLabelsBySourceKey = [];
        $itemLatestSeenBySourceKey = [];
        $itemLatestSubmittedAtBySourceKey = [];
        $sourceLatestSubmittedAtByKey = [];
        $itemUsageCountBySourceKey = [];
        $softDeleteCutoff = Carbon::create(2024, 1, 1, 0, 0, 0, 'UTC');
        $sourceSeedStats = [
            'itemsFromSourceComment' => 0,
            'itemsFromSourceDetail' => 0,
            'duplicateItemsSkipped' => 0,
            'remappedWarmToSocialMedia' => 0,
            'remappedWarmToWarm' => 0,
            'remappedWarmToRoadshow' => 0,
            'remappedToAssigned' => 0,
            'remappedExistingToExisting' => 0,
            'remappedExistingToCampaigns' => 0,
            'remappedReferralToReferral' => 0,
            'remappedItemToAmomusPodcast' => 0,
            'remappedItemToShameemSeminar' => 0,
            'remappedItemToSafinahInstitute' => 0,
            'remappedItemToFacebook' => 0,
            'remappedItemToInstagram' => 0,
            'remappedItemToSyarifAds' => 0,
            'remappedItemToSyazwanTikTok' => 0,
            'remappedItemToIftarWithSitiNurhaliza' => 0,
            'remappedItemToBeatInflation' => 0,
            'remappedItemToMegaxpress' => 0,
            'remappedItemToMuslimFest' => 0,
            'remappedItemNeighbourToWarm' => 0,
            'remappedItemToGlamEid' => 0,
            'remappedItemToHalalFoodsInternational' => 0,
            'remappedItemToMuhajirin' => 0,
            'remappedItemToStarlightMff' => 0,
            'excludedSourceItemsByKeyword' => 0,
            'excludedSingleUseSourceItems' => 0,
            'softDeletedSources' => 0,
            'softDeletedSourceItems' => 0,
        ];

        foreach ($rows as $rowIndex => $row) {
            if (!is_array($row)) {
                continue;
            }

            $mapped = $this->mapSourceFromRow($row);
            $sourceKey = $mapped['sourceKey'];
            if ($sourceKey === null) {
                continue;
            }
            $submittedAt = $this->parseSubmittedAt($row)['value'];

            if (!isset($sourceLabelsByKey[$sourceKey])) {
                $sourceLabelsByKey[$sourceKey] = $mapped['sourceLabel'];
                $sourceOrder[] = $sourceKey;
            }
            if (
                !isset($sourceLatestSubmittedAtByKey[$sourceKey])
                || $submittedAt->gt($sourceLatestSubmittedAtByKey[$sourceKey])
            ) {
                $sourceLatestSubmittedAtByKey[$sourceKey] = $submittedAt;
            }

            switch ($mapped['mappingRule']) {
                case 'warm_to_social_media':
                    $sourceSeedStats['remappedWarmToSocialMedia']++;
                    break;
                case 'warm_to_warm':
                    $sourceSeedStats['remappedWarmToWarm']++;
                    break;
                case 'warm_to_roadshow':
                    $sourceSeedStats['remappedWarmToRoadshow']++;
                    break;
                case 'comment_to_assigned':
                    $sourceSeedStats['remappedToAssigned']++;
                    break;
                case 'existing_to_existing':
                    $sourceSeedStats['remappedExistingToExisting']++;
                    break;
                case 'existing_to_campaigns':
                    $sourceSeedStats['remappedExistingToCampaigns']++;
                    break;
                case 'referral_to_referral':
                    $sourceSeedStats['remappedReferralToReferral']++;
                    break;
                case 'item_to_amomus_podcast':
                    $sourceSeedStats['remappedItemToAmomusPodcast']++;
                    break;
                case 'item_to_shameem_seminar':
                    $sourceSeedStats['remappedItemToShameemSeminar']++;
                    break;
                case 'item_to_safinah_institute':
                    $sourceSeedStats['remappedItemToSafinahInstitute']++;
                    break;
                case 'item_to_facebook':
                    $sourceSeedStats['remappedItemToFacebook']++;
                    break;
                case 'item_to_instagram':
                    $sourceSeedStats['remappedItemToInstagram']++;
                    break;
                case 'item_to_syarif_ads':
                    $sourceSeedStats['remappedItemToSyarifAds']++;
                    break;
                case 'item_to_syazwan_tiktok':
                    $sourceSeedStats['remappedItemToSyazwanTikTok']++;
                    break;
                case 'item_to_iftar_with_siti_nurhaliza':
                    $sourceSeedStats['remappedItemToIftarWithSitiNurhaliza']++;
                    break;
                case 'item_to_beat_inflation':
                    $sourceSeedStats['remappedItemToBeatInflation']++;
                    break;
                case 'item_to_megaxpress':
                    $sourceSeedStats['remappedItemToMegaxpress']++;
                    break;
                case 'item_to_muslim_fest':
                    $sourceSeedStats['remappedItemToMuslimFest']++;
                    break;
                case 'item_neighbour_to_warm_comment':
                    $sourceSeedStats['remappedItemNeighbourToWarm']++;
                    break;
                case 'item_to_glam_eid':
                    $sourceSeedStats['remappedItemToGlamEid']++;
                    break;
                case 'item_to_halal_foods_international':
                    $sourceSeedStats['remappedItemToHalalFoodsInternational']++;
                    break;
                case 'item_to_muhajirin':
                    $sourceSeedStats['remappedItemToMuhajirin']++;
                    break;
                case 'item_to_starlight_mff':
                    $sourceSeedStats['remappedItemToStarlightMff']++;
                    break;
            }

            $sourceItemKey = $mapped['sourceItemKey'];
            if ($sourceItemKey === null) {
                continue;
            }

            $itemKeyNormalized = $this->normalizeLookupKey($sourceItemKey);
            if ($itemKeyNormalized === '') {
                continue;
            }

            if (!isset($itemLabelsBySourceKey[$sourceKey])) {
                $itemLabelsBySourceKey[$sourceKey] = [];
            }
            if (!isset($itemLatestSeenBySourceKey[$sourceKey])) {
                $itemLatestSeenBySourceKey[$sourceKey] = [];
            }
            if (!isset($itemLatestSubmittedAtBySourceKey[$sourceKey])) {
                $itemLatestSubmittedAtBySourceKey[$sourceKey] = [];
            }
            if (!isset($itemUsageCountBySourceKey[$sourceKey])) {
                $itemUsageCountBySourceKey[$sourceKey] = [];
            }

            $itemUsageCountBySourceKey[$sourceKey][$itemKeyNormalized] =
                (int) (($itemUsageCountBySourceKey[$sourceKey][$itemKeyNormalized] ?? 0) + 1);

            if (isset($itemLabelsBySourceKey[$sourceKey][$itemKeyNormalized])) {
                $sourceSeedStats['duplicateItemsSkipped']++;
            } else {
                if ($mapped['sourceItemOrigin'] === 'sourceDetail') {
                    $sourceSeedStats['itemsFromSourceDetail']++;
                } else {
                    $sourceSeedStats['itemsFromSourceComment']++;
                }
            }

            // Keep latest seen label/time so source item positions can be newest -> oldest.
            $itemLabelsBySourceKey[$sourceKey][$itemKeyNormalized] = $sourceItemKey;
            $itemLatestSeenBySourceKey[$sourceKey][$itemKeyNormalized] = (int) $rowIndex;
            if (
                !isset($itemLatestSubmittedAtBySourceKey[$sourceKey][$itemKeyNormalized])
                || $submittedAt->gt($itemLatestSubmittedAtBySourceKey[$sourceKey][$itemKeyNormalized])
            ) {
                $itemLatestSubmittedAtBySourceKey[$sourceKey][$itemKeyNormalized] = $submittedAt;
            }
        }

        foreach ($sourceOrder as $sourceKey) {
            if (!isset($itemLatestSeenBySourceKey[$sourceKey])) {
                continue;
            }

            uksort(
                $itemLatestSeenBySourceKey[$sourceKey],
                static function (string $left, string $right) use ($itemLatestSeenBySourceKey, $sourceKey): int {
                    $leftSeen = (int) ($itemLatestSeenBySourceKey[$sourceKey][$left] ?? -1);
                    $rightSeen = (int) ($itemLatestSeenBySourceKey[$sourceKey][$right] ?? -1);
                    if ($leftSeen !== $rightSeen) {
                        return $rightSeen <=> $leftSeen;
                    }

                    return strcmp($left, $right);
                }
            );
        }

        $sourceOrder = $this->sortSourceOrder($sourceOrder);

        $sourceRows = [];
        $sourceIdByKey = [];
        foreach ($sourceOrder as $position => $sourceKey) {
            $sourceId = (string) ($position + 1);
            $sourceIdByKey[$sourceKey] = $sourceId;
            $isSourceDeleted = $sourceKey !== 'assigned'
                && isset($sourceLatestSubmittedAtByKey[$sourceKey])
                && $sourceLatestSubmittedAtByKey[$sourceKey]->lt($softDeleteCutoff);

            $sourceRows[] = [
                'id' => $sourceId,
                'label' => $sourceLabelsByKey[$sourceKey],
                'description' => null,
                'position' => $position,
                'is_deleted' => $isSourceDeleted,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            if ($isSourceDeleted) {
                $sourceSeedStats['softDeletedSources']++;
            }
        }

        $sourceItemRows = [];
        $seededSourceItemsBySourceKey = [];
        $sourceItemIdsBySourceKey = [];
        $nextSourceItemId = 1;
        foreach ($sourceOrder as $sourceKey) {
            $sourceId = $sourceIdByKey[$sourceKey] ?? null;
            if ($sourceId === null) {
                continue;
            }

            $itemLatestSeen = $itemLatestSeenBySourceKey[$sourceKey] ?? [];
            $position = 0;
            foreach (array_keys($itemLatestSeen) as $itemKeyNormalized) {
                $itemLabel = $itemLabelsBySourceKey[$sourceKey][$itemKeyNormalized] ?? null;
                if ($itemLabel === null) {
                    continue;
                }
                if ($this->shouldExcludeSourceItem($itemLabel)) {
                    $sourceSeedStats['excludedSourceItemsByKeyword']++;
                    continue;
                }
                $itemUsageCount = (int) ($itemUsageCountBySourceKey[$sourceKey][$itemKeyNormalized] ?? 0);
                if ($this->shouldExcludeSingleUseSourceItem($sourceKey, $itemLabel, $itemUsageCount)) {
                    $sourceSeedStats['excludedSingleUseSourceItems']++;
                    continue;
                }

                if (!isset($seededSourceItemsBySourceKey[$sourceKey])) {
                    $seededSourceItemsBySourceKey[$sourceKey] = [];
                }
                $seededSourceItemsBySourceKey[$sourceKey][$itemKeyNormalized] = true;
                if (!isset($sourceItemIdsBySourceKey[$sourceKey])) {
                    $sourceItemIdsBySourceKey[$sourceKey] = [];
                }
                $sourceItemId = $nextSourceItemId++;
                $sourceItemIdsBySourceKey[$sourceKey][$itemKeyNormalized] = $sourceItemId;
                $itemLatestSubmittedAt = $itemLatestSubmittedAtBySourceKey[$sourceKey][$itemKeyNormalized] ?? null;
                $isItemDeleted = $sourceKey !== 'assigned'
                    && $itemLatestSubmittedAt !== null
                    && $itemLatestSubmittedAt->lt($softDeleteCutoff);

                $sourceItemRows[] = [
                    'id' => $sourceItemId,
                    'source_id' => $sourceId,
                    'label' => $itemLabel,
                    'position' => $position,
                    'is_deleted' => $isItemDeleted,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
                if ($isItemDeleted) {
                    $sourceSeedStats['softDeletedSourceItems']++;
                }
                $position++;
            }
        }

        return [
            $sourceRows,
            $sourceItemRows,
            $sourceSeedStats,
            $sourceIdByKey,
            $seededSourceItemsBySourceKey,
            $sourceItemIdsBySourceKey,
        ];
    }

    /**
     * @param array<string, mixed> $row
     */
    private function mapSourceFromRow(array $row): array
    {
        $baseSourceLabel = $this->canonicalizeSourceLabel(
            $this->normalizeSourceText($row['source'] ?? null, 100)
        );
        if ($baseSourceLabel === null) {
            return [
                'sourceKey' => null,
                'sourceLabel' => null,
                'sourceItemKey' => null,
                'sourceComment' => $this->normalizeSourceComment($row['sourceComment'] ?? null, 65535),
                'sourceItemOrigin' => null,
                'mappingRule' => 'missing_source',
            ];
        }

        $sourceComment = $this->normalizeSourceComment($row['sourceComment'] ?? null, 65535);
        $sourceCommentForMapping = $this->normalizeSourceComment($row['sourceComment'] ?? null, 100);
        $sourceDetail = $this->normalizeSourceComment($row['sourceDetail'] ?? null, 100);
        $effectiveComment = $sourceCommentForMapping ?? $sourceDetail;
        $usedDetailFallback = $sourceCommentForMapping === null && $sourceDetail !== null;
        $effectiveCommentKey = $this->normalizeLookupKey($effectiveComment);
        $effectiveCommentCompact = $this->compactLookupKey($effectiveComment);
        $isNeighbourComment = $effectiveCommentKey === 'neighbour' || $effectiveCommentKey === 'neighbor';
        $isOldProspectComment = str_starts_with($effectiveCommentKey, 'old prospect');

        $mappedSourceLabel = $baseSourceLabel;
        $mappedSourceItemKey = null;
        $mappingRule = 'passthrough';

        if (
            str_contains($effectiveCommentKey, 'aia')
            || str_contains($effectiveCommentKey, 'call centre')
            || str_contains($effectiveCommentKey, 'call center')
        ) {
            $mappedSourceLabel = 'Assigned';
            $mappedSourceItemKey = 'AIA Call Centre';
            $mappingRule = 'item_to_aia_call_centre';
        } elseif (
            $effectiveCommentKey !== ''
            && $this->startsWithAny($effectiveCommentKey, ['assign', 'cvf', 'orphan'])
        ) {
            $mappedSourceLabel = 'Assigned';
            $mappedSourceItemKey = 'Orphan Client';
            $mappingRule = 'comment_to_assigned';
        } elseif (str_contains($effectiveCommentKey, 'flowers of rasulullah')) {
            $mappedSourceLabel = 'Seminar';
            $mappedSourceItemKey = 'Flowers of Rasulullah ﷺ';
            $mappingRule = 'item_to_flowers_of_rasulullah';
        } elseif (str_contains($effectiveCommentKey, 'love symposium')) {
            $mappedSourceLabel = 'Seminar';
            $mappedSourceItemKey = 'Love Symposium';
            $mappingRule = 'item_to_love_symposium';
        } elseif (str_contains($effectiveCommentKey, 'zakat')) {
            $mappedSourceLabel = 'Seminar';
            $mappedSourceItemKey = 'Zakat Seminar';
            $mappingRule = 'item_to_zakat_seminar';
        } elseif (str_contains($effectiveCommentKey, 'islamic mental health')) {
            $mappedSourceLabel = 'Seminar';
            $mappedSourceItemKey = 'Islamic Mental Health';
            $mappingRule = 'item_to_islamic_mental_health';
        } elseif (str_contains($effectiveCommentKey, 'shameem')) {
            $mappedSourceLabel = 'Seminar';
            $mappedSourceItemKey = 'Ustazah Shameem Sultanah';
            $mappingRule = 'item_to_shameem_seminar';
        } elseif (str_contains($effectiveCommentKey, 'safina')) {
            $mappedSourceLabel = 'Seminar';
            $mappedSourceItemKey = 'Safinah Institute';
            $mappingRule = 'item_to_safinah_institute';
        } elseif (str_contains($effectiveCommentKey, 'inflation')) {
            $mappedSourceLabel = 'Seminar';
            $mappedSourceItemKey = 'Beat Inflation';
            $mappingRule = 'item_to_beat_inflation';
        } elseif (
            str_contains($effectiveCommentKey, 'syarif')
            || str_contains($effectiveCommentKey, 'sharif')
            || str_contains($effectiveCommentKey, 'malaque')
        ) {
            $mappedSourceLabel = 'Social Media';
            $mappedSourceItemKey = 'Syarif/Malaque Ads';
            $mappingRule = 'item_to_syarif_ads';
        } elseif (str_contains($effectiveCommentKey, 'syazwan')) {
            $mappedSourceLabel = 'Social Media';
            $mappedSourceItemKey = 'Syazwan Tik Tok';
            $mappingRule = 'item_to_syazwan_tiktok';
        } elseif ($this->containsWord($effectiveCommentKey, 'siti')) {
            $mappedSourceLabel = 'Other (Cold)';
            $mappedSourceItemKey = 'Iftar with Siti Nurhaliza';
            $mappingRule = 'item_to_iftar_with_siti_nurhaliza';
        } elseif (
            ($effectiveCommentKey !== '' && str_starts_with($effectiveCommentKey, 'amu'))
            || str_contains($effectiveCommentCompact, 'amomus')
            || str_contains($effectiveCommentCompact, 'amumus')
        ) {
            $mappedSourceLabel = 'Social Media';
            $mappedSourceItemKey = 'AMomUs Podcast';
            $mappingRule = 'item_to_amomus_podcast';
        } elseif (
            $this->containsWord($effectiveCommentKey, 'facebook')
            || $this->containsWord($effectiveCommentKey, 'fb')
        ) {
            $mappedSourceLabel = 'Social Media';
            $mappedSourceItemKey = 'Facebook';
            $mappingRule = 'item_to_facebook';
        } elseif (
            str_contains($effectiveCommentKey, 'instagram')
            || $this->containsWord($effectiveCommentKey, 'ig')
        ) {
            $mappedSourceLabel = 'Social Media';
            $mappedSourceItemKey = 'Instagram';
            $mappingRule = 'item_to_instagram';
        } elseif (
            str_contains($effectiveCommentKey, 'linkedin')
            || $this->containsWord($effectiveCommentKey, 'li')
        ) {
            $mappedSourceLabel = 'Social Media';
            $mappedSourceItemKey = 'LinkedIn';
            $mappingRule = 'item_to_linkedin';
        } elseif (str_contains($effectiveCommentCompact, 'careshieldad')) {
            $mappedSourceLabel = 'Social Media';
            $mappedSourceItemKey = 'Careshield Ads';
            $mappingRule = 'item_to_careshield_ads';
        } elseif (str_contains($effectiveCommentCompact, 'marchleadgen')) {
            $mappedSourceLabel = 'Social Media';
            $mappedSourceItemKey = 'Sales Ads';
            $mappingRule = 'item_to_sales_ads';
        } elseif (str_contains($effectiveCommentCompact, 'absolut')) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Absolut Fest';
            $mappingRule = 'item_to_absolut_fest';
        } elseif (str_contains($effectiveCommentCompact, 'glameid')) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Glam Eid';
            $mappingRule = 'item_to_glam_eid';
        } elseif (str_starts_with($effectiveCommentKey, 'hala')) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Halal Foods International';
            $mappingRule = 'item_to_halal_foods_international';
        } elseif (str_contains($effectiveCommentCompact, 'muhajirin')) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Muhajirin';
            $mappingRule = 'item_to_muhajirin';
        } elseif (str_contains($effectiveCommentKey, 'starlight')) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Starlight Muslim Fashion Fest';
            $mappingRule = 'item_to_starlight_mff';
        } elseif ($effectiveCommentKey === 'referral') {
            $mappedSourceLabel = 'Social Media';
            $mappedSourceItemKey = 'Referral';
            $mappingRule = 'item_to_referral';
        } elseif (
            str_contains($effectiveCommentCompact, 'wedding')
            || str_contains($effectiveCommentCompact, 'weeding')
        ) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Wedding Expo';
            $mappingRule = 'item_to_wedding_expo';
        } elseif (str_contains($effectiveCommentCompact, 'olg')) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'OLG Fest';
            $mappingRule = 'item_to_olg_fest';
        } elseif (str_contains($effectiveCommentCompact, 'celebfest')) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Celebfest';
            $mappingRule = 'item_to_celebfest';
        } elseif (str_contains($effectiveCommentCompact, 'gegarfest')) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Gegarfest';
            $mappingRule = 'item_to_gegarfest';
        } elseif (
            str_contains($effectiveCommentCompact, 'twilight')
            || str_contains($effectiveCommentCompact, 'twlight')
            || str_contains($effectiveCommentCompact, 'twillight')
        ) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Twilight';
            $mappingRule = 'item_to_twilight';
        } elseif (
            str_contains($effectiveCommentCompact, 'vaultfest')
            || str_contains($effectiveCommentCompact, 'valutfest')
        ) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Vaultfest';
            $mappingRule = 'item_to_vaultfest';
        } elseif (
            str_contains($effectiveCommentCompact, 'muslimfest')
            || str_contains($effectiveCommentCompact, 'muslimfestival')
        ) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Muslimfest';
            $mappingRule = 'item_to_muslim_fest';
        } elseif (
            str_contains($effectiveCommentCompact, 'megaexpress')
            || str_contains($effectiveCommentCompact, 'megaxpress')
        ) {
            $mappedSourceLabel = 'Roadshow';
            $mappedSourceItemKey = 'Megaxpress';
            $mappingRule = 'item_to_megaxpress';
        } elseif ($isNeighbourComment) {
            $mappedSourceLabel = 'Warm';
            $mappedSourceItemKey = null;
            $mappingRule = 'item_neighbour_to_warm_comment';
        } else {
            $baseSourceKey = $this->normalizeLookupKey($baseSourceLabel);
            if ($baseSourceKey === 'warm') {
                if ($effectiveCommentKey === '' || $effectiveCommentKey === '0' || $effectiveCommentKey === 'warm') {
                    $mappedSourceLabel = 'Warm';
                    $mappingRule = 'warm_to_warm';
                } elseif ($effectiveCommentKey === 'social media' || $effectiveCommentKey === 'socialmedia') {
                    $mappedSourceLabel = 'Social Media';
                    $mappingRule = 'warm_to_social_media';
                } else {
                    $mappedSourceLabel = 'Roadshow';
                    $mappedSourceItemKey = $effectiveComment;
                    $mappingRule = 'warm_to_roadshow';
                }
            } elseif ($baseSourceKey === 'existing') {
                if ($effectiveCommentKey === '' || $effectiveCommentKey === '0') {
                    $mappedSourceLabel = 'Existing';
                    $mappingRule = 'existing_to_existing';
                } elseif ($effectiveCommentKey === 'm2b') {
                    $mappedSourceLabel = 'AIA Campaign';
                    $mappedSourceItemKey = 'Mum2Baby';
                    $mappingRule = 'existing_to_campaigns';
                } elseif ($effectiveCommentKey === 'monopoly') {
                    $mappedSourceLabel = 'AIA Campaign';
                    $mappedSourceItemKey = 'Monopoly';
                    $mappingRule = 'existing_to_campaigns';
                } elseif ($effectiveComment !== null) {
                    $mappedSourceLabel = 'Existing';
                    $mappedSourceItemKey = $effectiveComment;
                    $mappingRule = 'existing_passthrough';
                } else {
                    $mappedSourceLabel = 'Existing';
                    $mappingRule = 'existing_to_existing';
                }
            } elseif ($baseSourceKey === 'referral') {
                $mappedSourceLabel = 'Referral';
                $mappedSourceItemKey = $effectiveComment;
                $mappingRule = 'referral_to_referral';
            } elseif ($effectiveComment !== null) {
                $mappedSourceItemKey = $effectiveComment;
            }
        }

        if ($mappedSourceItemKey !== null) {
            $mappedSourceItemKey = $this->normalizeMappedSourceItemKey($mappedSourceItemKey, $mappedSourceLabel);
        }

        if ($isOldProspectComment || $isNeighbourComment) {
            $mappedSourceItemKey = null;
            if ($isOldProspectComment) {
                $mappingRule = 'item_old_prospect_comment_only';
            }
        }

        if ($mappedSourceItemKey !== null) {
            $mappedSourceItemKeyKey = $this->normalizeLookupKey($mappedSourceItemKey);
            if (
                $mappedSourceItemKeyKey === 'm2b'
                || $mappedSourceItemKeyKey === 'mum2baby'
                || $mappedSourceItemKeyKey === 'aia mum2baby'
            ) {
                $mappedSourceItemKey = 'Mum2Baby';
            }
        }

        $mappedSourceKey = $this->normalizeLookupKey($mappedSourceLabel);
        if ($mappedSourceItemKey !== null) {
            $mappedItemKey = $this->normalizeLookupKey($mappedSourceItemKey);
            if ($mappedItemKey === '' || $mappedItemKey === '0' || $mappedItemKey === $mappedSourceKey) {
                $mappedSourceItemKey = null;
            }
        }

        return [
            'sourceKey' => $mappedSourceKey !== '' ? $mappedSourceKey : null,
            'sourceLabel' => $mappedSourceLabel,
            'sourceItemKey' => $mappedSourceItemKey,
            'sourceComment' => $sourceComment,
            'sourceItemOrigin' => $mappedSourceItemKey === null
                ? null
                : ($usedDetailFallback ? 'sourceDetail' : 'sourceComment'),
            'mappingRule' => $mappingRule,
        ];
    }

    private function canonicalizeSourceLabel(?string $sourceText): ?string
    {
        if ($sourceText === null) {
            return null;
        }

        $withSpaces = preg_replace('/(?<!^)[A-Z]/', ' $0', $sourceText);
        $normalized = str_replace(['-', '_'], ' ', (string) $withSpaces);
        $normalized = trim((string) preg_replace('/\s+/', ' ', $normalized));
        if ($normalized === '') {
            return null;
        }

        $normalizedKey = $this->normalizeLookupKey($normalized);
        if ($normalizedKey === 'socialmedia') {
            return 'Social Media';
        }
        if ($normalizedKey === 'road show') {
            return 'Roadshow';
        }
        if ($normalizedKey === 'seminars') {
            return 'Seminar';
        }
        if (
            $normalizedKey === 'campaigns'
            || $normalizedKey === 'campaign'
            || $normalizedKey === 'aia campaign'
            || $normalizedKey === 'aiacampaign'
        ) {
            return 'AIA Campaign';
        }
        if ($normalizedKey === 'cold' || $normalizedKey === 'cold other') {
            return 'Other (Cold)';
        }

        return ucwords(strtolower($normalized));
    }

    /**
     * @param array<int, string> $sourceOrder
     * @return array<int, string>
     */
    private function sortSourceOrder(array $sourceOrder): array
    {
        $preferredOrder = array_flip(self::SOURCE_ORDER);
        $originalPositions = [];
        foreach (array_values($sourceOrder) as $index => $sourceKey) {
            if (!isset($originalPositions[$sourceKey])) {
                $originalPositions[$sourceKey] = $index;
            }
        }

        usort($sourceOrder, static function (string $left, string $right) use ($preferredOrder, $originalPositions): int {
            $leftRank = $preferredOrder[$left] ?? PHP_INT_MAX;
            $rightRank = $preferredOrder[$right] ?? PHP_INT_MAX;
            if ($leftRank !== $rightRank) {
                return $leftRank <=> $rightRank;
            }

            return ($originalPositions[$left] ?? PHP_INT_MAX) <=> ($originalPositions[$right] ?? PHP_INT_MAX);
        });

        return $sourceOrder;
    }

    private function normalizeSourceComment(mixed $value, int $maxLength): ?string
    {
        return $this->normalizeSourceText($value, $maxLength, true);
    }

    private function normalizeSourceText(mixed $value, int $maxLength, bool $removeBrackets = false): ?string
    {
        $text = (string) ($value ?? '');
        if ($removeBrackets) {
            $text = str_replace(['[', ']', '(', ')', '{', '}', '<', '>'], '', $text);
        }

        $text = trim($text);
        if ($text === '') {
            return null;
        }

        $text = trim((string) preg_replace('/\s+/', ' ', $text));
        if ($text === '') {
            return null;
        }

        return substr($text, 0, $maxLength);
    }

    private function normalizeLookupKey(?string $text): string
    {
        if ($text === null) {
            return '';
        }

        $normalized = trim((string) preg_replace('/\s+/', ' ', $text));
        if ($normalized === '') {
            return '';
        }

        return strtolower($normalized);
    }

    private function compactLookupKey(?string $text): string
    {
        $normalized = $this->normalizeLookupKey($text);
        if ($normalized === '') {
            return '';
        }

        return strtolower((string) preg_replace('/[^a-z0-9]+/', '', $normalized));
    }

    private function normalizeMappedSourceItemKey(string $itemKey, string $sourceLabel): string
    {
        $label = trim((string) preg_replace('/\s+/', ' ', $itemKey));
        if ($label === '') {
            return $itemKey;
        }

        $labelKeyCompact = $this->compactLookupKey($label);
        if (
            $labelKeyCompact === 'm2b'
            || $labelKeyCompact === 'mum2baby'
            || $labelKeyCompact === 'aiamum2baby'
        ) {
            return 'Mum2Baby';
        }
        if (
            str_contains($labelKeyCompact, 'perksappleads')
            || str_contains($labelKeyCompact, 'peksappleads')
            || $labelKeyCompact === 'perksapp'
            || $labelKeyCompact === 'peksapp'
        ) {
            return 'Peks App';
        }

        $sourceKey = $this->normalizeLookupKey($sourceLabel);
        if ($sourceKey === 'roadshow') {
            $label = (string) preg_replace('/festival/i', 'Fest', $label);
            $label = (string) preg_replace('/\bfest\b/i', 'Fest', $label);
            $label = trim((string) preg_replace('/\s+/', ' ', $label));

            $labelKey = $this->normalizeLookupKey($label);
            if ($labelKey === 'salamfest' || $labelKey === 'salam fest') {
                return 'SalamFest';
            }
            if (
                $labelKey === 'absolut'
                || $labelKey === 'absolute'
                || $labelKey === 'absolutfest'
                || $labelKey === 'absolutefest'
                || $labelKey === 'absolut fest'
                || $labelKey === 'absolute fest'
            ) {
                return 'Absolut Fest';
            }
            if ($labelKey === 'muslim fest') {
                return 'Muslimfest';
            }
        }

        return $label;
    }

    private function shouldExcludeSourceItem(string $itemKey): bool
    {
        $normalized = $this->normalizeLookupKey($itemKey);
        if ($normalized === '') {
            return false;
        }

        return $this->containsWord($normalized, 'webinar')
            || $this->containsWord($normalized, 'playground')
            || $this->containsWord($normalized, 'lig');
    }

    private function shouldExcludeSingleUseSourceItem(string $sourceKey, string $itemKey, int $usageCount): bool
    {
        if ($usageCount !== 1) {
            return false;
        }

        $normalizedSourceKey = $this->normalizeLookupKey($sourceKey);
        if ($normalizedSourceKey === 'aia campaign' || $normalizedSourceKey === 'assigned') {
            return false;
        }

        $normalizedItemKey = $this->normalizeLookupKey($itemKey);

        return $normalizedItemKey !== 'aia call centre' && $normalizedItemKey !== 'aia call center';
    }

    private function containsWord(string $haystack, string $word): bool
    {
        if ($haystack === '' || $word === '') {
            return false;
        }

        return preg_match('/\b' . preg_quote(strtolower($word), '/') . '\b/u', $haystack) === 1;
    }

    /**
     * @param array<int, string> $prefixes
     */
    private function startsWithAny(string $value, array $prefixes): bool
    {
        foreach ($prefixes as $prefix) {
            if ($prefix !== '' && str_starts_with($value, strtolower($prefix))) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $row
     * @return array{value: Carbon, reconstructed: bool, fallbackNow: bool}
     */
    private function parseSubmittedAt(array $row): array
    {
        $timestamp = $this->nullableString($row['timestamp'] ?? null, 255);
        if ($timestamp !== null) {
            try {
                return [
                    'value' => $this->parseLegacyTimestamp($timestamp),
                    'reconstructed' => false,
                    'fallbackNow' => false,
                ];
            } catch (\Throwable) {
                // Fallback below.
            }
        }

        $year = (int) ($row['year'] ?? 0);
        $month = (int) ($row['month'] ?? 0);
        $day = (int) ($row['day'] ?? 0);
        if ($year > 0 && checkdate($month, $day, $year)) {
            return [
                'value' => Carbon::create($year, $month, $day, 12, 0, 0, config('app.timezone')),
                'reconstructed' => true,
                'fallbackNow' => false,
            ];
        }

        return [
            'value' => now(),
            'reconstructed' => false,
            'fallbackNow' => true,
        ];
    }

    private function parseLegacyTimestamp(string $timestamp): Carbon
    {
        $trimmed = trim($timestamp);
        if ($trimmed === '') {
            throw new \InvalidArgumentException('Timestamp cannot be empty.');
        }

        return Carbon::parse(
            $this->stripLegacyTimezoneSuffix($trimmed),
            $this->legacyImportTimezone()
        )->utc();
    }

    private function stripLegacyTimezoneSuffix(string $timestamp): string
    {
        return rtrim((string) preg_replace('/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i', '', $timestamp));
    }

    private function legacyImportTimezone(): string
    {
        $configured = trim((string) config('app.closing_filter_timezone', ''));
        return $configured !== '' ? $configured : self::LEGACY_LOCAL_TIMEZONE_FALLBACK;
    }

    /**
     * @param array<int, mixed> $items
     * @param array<string, array{full_name: ?string, full_name_norm: ?string, is_rider: bool}> $knownProducts
     * @param array<string, bool> $knownProductTypeKeys
     * @param array<string, int> $unknownProductRefs
     * @param array<string, int> $productNameMismatchRefs
     * @param array<string, int> $stats
     */
    private function insertClosingItems(
        int $closingId,
        array $items,
        \DateTimeInterface $now,
        array &$knownProducts,
        array $knownProductTypeKeys,
        array &$unknownProductRefs,
        array &$productNameMismatchRefs,
        array &$stats,
        ?int $parentItemId = null,
        bool $isRider = false
    ): int {
        $inserted = 0;

        foreach (array_values($items) as $position => $item) {
            if (!is_array($item)) {
                $stats['skippedInvalidItems']++;
                continue;
            }

            if (array_key_exists('id', $item)) {
                $stats['unmappedItemIdField']++;
            }
            if (array_key_exists('category', $item)) {
                $stats['unmappedItemCategoryField']++;
            }

            $productId = $this->nullableString($item['productId'] ?? null, 100);
            $fullName = $this->nullableString($item['fullName'] ?? null, 200);
            if ($productId === null || $fullName === null) {
                $stats['skippedInvalidItems']++;
                continue;
            }

            $remappedProductId = $this->resolveLegacyClosingProductId($productId, $fullName);
            if ($remappedProductId !== $productId) {
                $productId = $remappedProductId;
                $stats['legacyProduct97RemappedTo111']++;
            }

            $effectiveIsRider = $isRider || $this->legacyItemIdMarksStandaloneRider($item['id'] ?? null);

            if (!isset($knownProducts[$productId])) {
                $productSeeded = $this->seedMissingProductFromClosing(
                    $productId,
                    $item,
                    $effectiveIsRider,
                    $now,
                    $knownProductTypeKeys,
                    $knownProducts,
                    $stats,
                );
                if (!$productSeeded) {
                    $unknownProductRefs[$productId] = ($unknownProductRefs[$productId] ?? 0) + 1;
                }
            }

            $knownProduct = $knownProducts[$productId] ?? null;
            if ($knownProduct !== null) {
                $dbNameNorm = $knownProduct['full_name_norm'] ?? null;
                $closingNameNorm = $this->normalizeProductName($fullName);
                if ($closingNameNorm !== null && $dbNameNorm !== $closingNameNorm) {
                    $mismatchKey = $productId
                        . '|'
                        . ($knownProduct['full_name'] ?? '')
                        . '|'
                        . $fullName;
                    $productNameMismatchRefs[$mismatchKey] = ($productNameMismatchRefs[$mismatchKey] ?? 0) + 1;
                    $stats['productNameMismatches']++;
                }
            }

            $premiumTerm = $this->normalizePremiumTerm($item['premiumTermOrIssueAge'] ?? null, $stats);
            $itemId = DB::table('closing_items')->insertGetId([
                'closing_id' => $closingId,
                'parent_item_id' => $parentItemId,
                'is_rider' => $effectiveIsRider,
                'product_id' => $productId,
                'full_name' => $fullName,
                'short_name' => $this->nullableString($item['shortName'] ?? null, 120),
                'premium_term_or_issue_age' => $premiumTerm,
                'type_key' => $this->nullableString($item['type'] ?? null, 50),
                'fyc_rate' => $this->toDecimal($item['fycRate'] ?? 0),
                'gst' => $this->toDecimal($item['gst'] ?? 0),
                'position' => $position,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $inserted++;
            if ($effectiveIsRider) {
                $stats['insertedRiders']++;
            } else {
                $stats['insertedItems']++;
            }

            $premiums = is_array($item['quantitiesAndPremiums'] ?? null) ? $item['quantitiesAndPremiums'] : [];
            foreach (array_values($premiums) as $premiumPosition => $premium) {
                if (!is_array($premium)) {
                    $stats['skippedInvalidPremiums']++;
                    continue;
                }

                $premiumValue = $this->toDecimal($premium['premium'] ?? 0);
                if ($premiumValue <= 0) {
                    $stats['skippedInvalidPremiums']++;
                    continue;
                }

                DB::table('closing_item_premiums')->insert([
                    'closing_item_id' => $itemId,
                    'quantity' => max(1, (int) ($premium['quantity'] ?? 1)),
                    'premium' => $premiumValue,
                    'frequency' => $this->nullableString($premium['frequency'] ?? null, 30),
                    'position' => $premiumPosition,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $stats['insertedPremiums']++;
            }

            $riders = is_array($item['riders'] ?? null) ? $item['riders'] : [];
            $this->insertClosingItems(
                $closingId,
                $riders,
                $now,
                $knownProducts,
                $knownProductTypeKeys,
                $unknownProductRefs,
                $productNameMismatchRefs,
                $stats,
                (int) $itemId,
                true,
            );
        }

        return $inserted;
    }

    /**
     * @param array<string, int> $stats
     */
    private function normalizePremiumTerm(mixed $value, array &$stats): ?string
    {
        if (!is_array($value)) {
            return $this->nullableString($value, 120);
        }

        $stats['premiumTermObjectCount']++;
        if (array_key_exists('fycRate', $value)) {
            $stats['unmappedPremiumTermFycRate']++;
        }

        $label = $this->nullableString($value['label'] ?? null, 120);
        if ($label === null) {
            $stats['premiumTermObjectWithoutLabel']++;
        }
        return $label;
    }

    /**
     * @param array<string, mixed> $item
     * @param array<string, bool> $knownProductTypeKeys
     * @param array<string, array{full_name: ?string, full_name_norm: ?string, is_rider: bool}> $knownProducts
     * @param array<string, int> $stats
     */
    private function seedMissingProductFromClosing(
        string $productId,
        array $item,
        bool $isRider,
        \DateTimeInterface $now,
        array $knownProductTypeKeys,
        array &$knownProducts,
        array &$stats
    ): bool {
        $fullName = $this->nullableString($item['fullName'] ?? null, 200);
        if ($fullName === null) {
            return false;
        }

        $typeKeyRaw = $this->nullableString($item['type'] ?? null, 50);
        $typeKey = $typeKeyRaw !== null && isset($knownProductTypeKeys[$typeKeyRaw])
            ? $typeKeyRaw
            : null;
        $nextPosition = ((int) (DB::table('products')->max('position') ?? -1)) + 1;

        try {
            DB::table('products')->insert([
                'id' => $productId,
                'is_rider' => $isRider,
                'category' => null,
                'full_name' => $fullName,
                'short_name' => $this->nullableString($item['shortName'] ?? null, 120),
                'type_key' => $typeKey,
                'notes' => null,
                'option_title' => null,
                'fyc_rate' => $this->nullableString($item['fycRate'] ?? null, 20),
                'frequency_mask' => 0,
                'gst' => $this->nullableString($item['gst'] ?? null, 20),
                'position' => $nextPosition,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } catch (\Throwable) {
            $existing = DB::table('products')
                ->where('id', $productId)
                ->first(['full_name', 'is_rider']);
            if ($existing === null) {
                return false;
            }

            $existingName = $this->nullableString($existing->full_name ?? null, 200);
            $knownProducts[$productId] = [
                'full_name' => $existingName,
                'full_name_norm' => $this->normalizeProductName($existingName),
                'is_rider' => (bool) ($existing->is_rider ?? false),
            ];
            return true;
        }

        $knownProducts[$productId] = [
            'full_name' => $fullName,
            'full_name_norm' => $this->normalizeProductName($fullName),
            'is_rider' => $isRider,
        ];
        if ($isRider) {
            $stats['insertedMissingRiders']++;
        } else {
            $stats['insertedMissingProducts']++;
        }

        return true;
    }

    private function normalizeProductName(mixed $value): ?string
    {
        $text = trim((string) ($value ?? ''));
        if ($text === '') {
            return null;
        }

        $text = trim((string) preg_replace('/\s+/', ' ', $text));
        if ($text === '') {
            return null;
        }

        return strtolower($text);
    }

    private function legacyItemIdMarksStandaloneRider(mixed $value): bool
    {
        if (is_int($value)) {
            return $value >= 1000;
        }

        if (is_string($value)) {
            $trimmed = trim($value);
            if ($trimmed !== '' && ctype_digit($trimmed)) {
                return (int) $trimmed >= 1000;
            }
        }

        return false;
    }

    private function resolveLegacyClosingProductId(string $productId, string $fullName): string
    {
        if ($productId !== '97') {
            return $productId;
        }

        $name = trim((string) preg_replace('/\s+/', ' ', $fullName));
        if ($name !== '' && preg_match('/^smart\b/i', $name) === 1) {
            return '97';
        }

        return '111';
    }

    private function nullableString(mixed $value, int $maxLength): ?string
    {
        $text = trim((string) ($value ?? ''));
        if ($text === '') {
            return null;
        }

        return substr($text, 0, $maxLength);
    }

    private function toDecimal(mixed $value): float
    {
        $num = (float) $value;
        return is_finite($num) ? $num : 0.0;
    }

    /**
     * @param array<string, int> $map
     */
    private function formatFrequencyMap(array $map): string
    {
        $parts = [];
        foreach ($map as $key => $count) {
            $parts[] = "{$key}={$count}";
        }

        return implode(', ', $parts);
    }
}
