<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

class AdminUndoService
{
    public const FEATURE_PRODUCTS = 'products';
    public const FEATURE_SOURCES = 'sources';
    public const FEATURE_REPORTS = 'reports';
    public const FEATURE_TEAM = 'team';
    public const FEATURE_HANDBOOK = 'handbook';
    public const FEATURE_CLOSINGS = 'closings';

    private const FREQUENCY_SINGLE = 1;
    private const FREQUENCY_MONTHLY_1 = 2;
    private const FREQUENCY_MONTHLY_2 = 4;
    private const FREQUENCY_QUARTERLY = 8;
    private const FREQUENCY_SEMI_ANNUAL = 16;
    private const FREQUENCY_ANNUAL = 32;
    private const SNAPSHOT_RETENTION_COUNT = 50;

    public function __construct(
        private readonly ReportTemplateStore $reportTemplateStore
    ) {
    }

    public function listSnapshotsForViewer(?User $viewer): array
    {
        $features = $this->featuresForViewer($viewer);
        if ($features === []) {
            return [];
        }

        $idsToKeep = $this->retainedSnapshotIds($features);
        if ($idsToKeep === []) {
            return [];
        }

        $rows = DB::table('admin_restore_snapshots as s')
            ->leftJoin('users as u', 'u.id', '=', 's.created_by')
            ->whereIn('s.id', $idsToKeep)
            ->orderByDesc('s.created_at')
            ->orderByDesc('s.id')
            ->get([
                's.id',
                's.feature',
                's.summary',
                's.scope_key',
                's.created_at',
                'u.nickname as created_by_nickname',
                'u.full_name as created_by_full_name',
                'u.email as created_by_email',
            ]);

        return $rows->map(function ($row): array {
            $feature = (string) $row->feature;
            $summary = $this->nullableString($row->summary ?? null, 255)
                ?? $this->defaultSummaryForFeature($feature);

            if ($feature === self::FEATURE_PRODUCTS) {
                $summary = $this->normalizeProductsSnapshotSummary($summary);
            }
            if ($feature === self::FEATURE_SOURCES) {
                $summary = $this->normalizeSourcesSnapshotSummary($summary);
            }
            if ($feature === self::FEATURE_TEAM) {
                $summary = $this->normalizeTeamSnapshotSummary($summary);
            }
            if ($feature === self::FEATURE_HANDBOOK) {
                $summary = $this->normalizeHandbookSnapshotSummary($summary);
            }
            if ($feature === self::FEATURE_REPORTS) {
                $summary = $this->normalizeReportsSnapshotSummary($summary);
            }

            return [
                'id' => (string) $row->id,
                'feature' => $feature,
                'summary' => $summary,
                'scopeKey' => $this->nullableString($row->scope_key ?? null, 120),
                'createdAt' => $this->toIsoOrNull($row->created_at),
                'createdBy' => $this->firstNonEmpty([
                    (string) ($row->created_by_nickname ?? ''),
                    (string) ($row->created_by_full_name ?? ''),
                    (string) ($row->created_by_email ?? ''),
                ]),
            ];
        })->values()->all();
    }

    public function restoreSnapshot(int $snapshotId, ?User $viewer): void
    {
        $row = DB::table('admin_restore_snapshots')->where('id', $snapshotId)->first();
        if (!$row) {
            throw ValidationException::withMessages([
                'snapshot' => 'Snapshot not found.',
            ]);
        }

        $feature = $this->normalizeFeature((string) ($row->feature ?? ''));
        if (!$this->viewerCanAccessFeature($viewer, $feature)) {
            throw ValidationException::withMessages([
                'snapshot' => 'You cannot restore this snapshot.',
            ]);
        }

        $payload = json_decode((string) ($row->payload ?? 'null'), true);
        $normalizedPayload = is_array($payload) ? $payload : [];

        DB::transaction(function () use ($snapshotId, $row, $feature, $normalizedPayload, $viewer): void {
            $restoredSummary = $this->nullableString($row->summary ?? null, 255);
            if ($feature === self::FEATURE_PRODUCTS) {
                $restoredSummary = $this->normalizeProductsSnapshotSummary($restoredSummary);
            }
            if ($feature === self::FEATURE_SOURCES) {
                $restoredSummary = $this->normalizeSourcesSnapshotSummary($restoredSummary);
            }
            if ($feature === self::FEATURE_TEAM) {
                $restoredSummary = $this->normalizeTeamSnapshotSummary($restoredSummary);
            }
            if ($feature === self::FEATURE_HANDBOOK) {
                $restoredSummary = $this->normalizeHandbookSnapshotSummary($restoredSummary);
            }
            if ($feature === self::FEATURE_REPORTS) {
                $restoredSummary = $this->normalizeReportsSnapshotSummary($restoredSummary);
            }

            $this->storePreRestoreSnapshot(
                $feature,
                $normalizedPayload,
                $viewer?->id,
                $restoredSummary,
                $this->nullableString($row->scope_key ?? null, 120),
            );

            $this->applySnapshotRestore($feature, $normalizedPayload, $viewer?->id);

            DB::table('admin_restore_snapshots')->where('id', $snapshotId)->delete();

            $this->pruneSnapshots();
        });
    }

    public function recordProductsSnapshot(?int $actorId = null, ?string $summary = null): void
    {
        $this->storeSnapshot(
            self::FEATURE_PRODUCTS,
            $this->captureProducts(),
            $actorId,
            $this->normalizeProductsSnapshotSummary($summary)
        );
    }

    public function recordSourcesSnapshot(?int $actorId = null, ?string $summary = null): void
    {
        $this->storeSnapshot(
            self::FEATURE_SOURCES,
            $this->captureSources(),
            $actorId,
            $this->normalizeSourcesSnapshotSummary($summary)
        );
    }

    public function recordReportsSnapshot(?int $actorId = null, ?string $summary = null): void
    {
        $this->storeSnapshot(
            self::FEATURE_REPORTS,
            ['reports' => $this->captureReports()],
            $actorId,
            $this->normalizeReportsSnapshotSummary($summary)
        );
    }

    public function recordTeamSnapshot(?int $actorId = null, ?string $summary = null): void
    {
        $this->storeSnapshot(
            self::FEATURE_TEAM,
            $this->captureTeam(),
            $actorId,
            $this->normalizeTeamSnapshotSummary($summary)
        );
    }

    public function captureTeamSnapshotPayload(): array
    {
        return $this->captureTeam();
    }

    public function recordTeamSnapshotPayload(array $payload, ?int $actorId = null, ?string $summary = null): void
    {
        $this->storeSnapshot(
            self::FEATURE_TEAM,
            $payload,
            $actorId,
            $this->normalizeTeamSnapshotSummary($summary)
        );
    }

    public function recordHandbookSnapshot(?int $actorId = null, ?string $summary = null): void
    {
        $this->storeSnapshot(
            self::FEATURE_HANDBOOK,
            ['payload' => $this->captureHandbook()],
            $actorId,
            $this->normalizeHandbookSnapshotSummary($summary)
        );
    }

    public function recordClosingsSnapshot(array $monthKeys, ?int $actorId = null, ?string $summary = null): void
    {
        $normalizedMonthKeys = array_values(array_unique(array_filter(
            array_map(fn ($value): string => trim((string) $value), $monthKeys),
            fn (string $value): bool => $value !== ''
        )));

        if ($normalizedMonthKeys === []) {
            return;
        }

        $months = [];
        foreach ($normalizedMonthKeys as $monthKey) {
            $this->assertMonthKey($monthKey);
            $months[] = $this->captureClosingMonth($monthKey);
        }

        $scopeKey = implode(',', array_map(
            static fn (array $month): string => (string) ($month['monthKey'] ?? ''),
            $months
        ));

        $resolvedSummary = $summary ?? (
            count($months) === 1
                ? 'Closings: after saving month ' . $months[0]['monthKey']
                : 'Closings: after saving ' . count($months) . ' months'
        );

        $this->storeSnapshot(
            self::FEATURE_CLOSINGS,
            ['months' => $months],
            $actorId,
            $resolvedSummary,
            $scopeKey
        );
    }

    public function restoreTeam(array $payload): void
    {
        $users = is_array($payload['users'] ?? null) ? $payload['users'] : [];
        $agencies = is_array($payload['agencies'] ?? null) ? $payload['agencies'] : [];
        $now = now();

        DB::transaction(function () use ($users, $agencies, $now): void {
            $normalizedAgencies = [];
            $seenAgencyCodes = [];
            foreach (array_values($agencies) as $index => $agency) {
                if (!is_array($agency)) {
                    continue;
                }

                $code = trim((string) ($agency['code'] ?? ''));
                $name = trim((string) ($agency['name'] ?? ''));
                if ($code === '') {
                    continue;
                }
                if (isset($seenAgencyCodes[$code])) {
                    continue;
                }
                $seenAgencyCodes[$code] = true;

                $normalizedAgencies[] = [
                    'code' => substr($code, 0, 50),
                    'name' => substr($name !== '' ? $name : $code, 0, 150),
                    'position' => $index,
                    'is_delete' => $this->toBoolean(
                        $agency['isDeleted'] ?? !(bool) ($agency['isActive'] ?? true),
                        false
                    ),
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }

            if ($normalizedAgencies !== []) {
                DB::table('agencies')->upsert(
                    $normalizedAgencies,
                    ['code'],
                    ['name', 'position', 'is_delete', 'updated_at']
                );
            }

            $incomingAgencyCodes = array_map(
                static fn (array $agency): string => (string) $agency['code'],
                $normalizedAgencies
            );
            if ($incomingAgencyCodes !== []) {
                DB::table('agencies')
                    ->whereNotIn('code', $incomingAgencyCodes)
                    ->update([
                        'is_delete' => true,
                        'updated_at' => $now,
                    ]);
            }

            $agencyIdByCode = DB::table('agencies')
                ->pluck('id', 'code')
                ->mapWithKeys(static fn ($id, $code): array => [(string) $code => (int) $id])
                ->all();

            $existingCreatedAt = DB::table('users')
                ->pluck('created_at', 'id')
                ->mapWithKeys(static fn ($createdAt, $id): array => [(int) $id => $createdAt])
                ->all();

            $normalizedUsers = [];
            $incomingUserIds = [];
            foreach (array_values($users) as $user) {
                if (!is_array($user)) {
                    continue;
                }

                $id = (int) ($user['id'] ?? 0);
                $email = strtolower(trim((string) ($user['email'] ?? '')));
                $fscCode = trim((string) ($user['fscCode'] ?? ''));
                if ($id <= 0 || $email === '' || $fscCode === '') {
                    continue;
                }

                $agencyCode = trim((string) ($user['agencyCode'] ?? ''));
                $agencyId = $agencyCode !== '' ? ($agencyIdByCode[$agencyCode] ?? null) : null;

                $birthDate = $this->normalizeDateString(
                    $this->nullableString($user['birthDate'] ?? null, 20),
                    (int) ($user['birthYear'] ?? 0),
                    (int) ($user['birthMonth'] ?? 0),
                    (int) ($user['birthDay'] ?? 0),
                );
                $contractDate = $this->normalizeDateString(
                    $this->nullableString($user['contractDate'] ?? null, 20),
                    (int) ($user['contractYear'] ?? 0),
                    (int) ($user['contractMonth'] ?? 0),
                    (int) ($user['contractDay'] ?? 0),
                );

                $incomingUserIds[] = $id;
                $normalizedUsers[] = [
                    'id' => $id,
                    'email' => $email,
                    'fsc_code' => substr($fscCode, 0, 20),
                    'access_level' => $this->normalizeAccessLevel((string) ($user['accessLevel'] ?? 'standard')),
                    'agency_id' => $agencyId,
                    'nickname' => $this->nullableString($user['nickname'] ?? null, 100),
                    'full_name' => $this->nullableString($user['fullName'] ?? null, 150),
                    'birth_date' => $birthDate,
                    'contract_date' => $contractDate,
                    'is_active' => true,
                    'remember_token' => null,
                    'created_at' => $existingCreatedAt[$id] ?? $now,
                    'updated_at' => $now,
                ];
            }

            if ($normalizedUsers !== []) {
                DB::table('users')->upsert(
                    $normalizedUsers,
                    ['id'],
                    [
                        'email',
                        'fsc_code',
                        'access_level',
                        'agency_id',
                        'nickname',
                        'full_name',
                        'birth_date',
                        'contract_date',
                        'is_active',
                        'updated_at',
                    ]
                );
            }

            if ($incomingUserIds !== []) {
                DB::table('users')
                    ->whereNotIn('id', $incomingUserIds)
                    ->update([
                        'is_active' => false,
                        'updated_at' => $now,
                    ]);
            }
        });
    }

    private function captureProducts(): array
    {
        $setting = DB::table('product_settings')->where('id', 1)->first();
        $types = DB::table('product_type_definitions')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['type_key', 'label']);

        $basePlans = DB::table('products')
            ->where('is_rider', false)
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get();
        $riders = DB::table('products')
            ->where('is_rider', true)
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get();
        $baseIds = $basePlans->pluck('id')->all();
        $allIds = array_values(array_unique(array_merge($baseIds, $riders->pluck('id')->all())));
        $options = DB::table('product_options')
            ->whereIn('product_id', $allIds ?: [''])
            ->orderBy('position')
            ->orderBy('id')
            ->get();
        $attachables = DB::table('product_attachable_riders')
            ->whereIn('base_product_id', $baseIds ?: [''])
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        return [
            'gst' => $setting?->gst !== null ? (float) $setting->gst : null,
            'types' => $types->mapWithKeys(static fn ($row): array => [
                (string) $row->type_key => (string) $row->label,
            ])->all(),
            'basePlans' => $basePlans->map(function ($row) use ($options, $attachables): array {
                $id = (string) $row->id;
                return [
                    'id' => $id,
                    'category' => (string) ($row->category ?? ''),
                    'fullName' => (string) ($row->full_name ?? ''),
                    'shortName' => (string) ($row->short_name ?? ''),
                    'type' => (string) ($row->type_key ?? ''),
                    'notes' => (string) ($row->notes ?? ''),
                    'optionTitle' => (string) ($row->option_title ?? ''),
                    'options' => $options->where('product_id', $id)->values()->map(static fn ($item): array => [
                        'label' => (string) $item->label,
                        'fycRate' => (string) ($item->fyc_rate ?? ''),
                    ])->all(),
                    'fycRate' => (string) ($row->fyc_rate ?? ''),
                    'frequencies' => $this->frequenciesFromMask((int) ($row->frequency_mask ?? 0)),
                    'gst' => (string) ($row->gst ?? ''),
                    'attachableRiders' => $attachables
                        ->where('base_product_id', $id)
                        ->values()
                        ->map(static fn ($item): string => (string) $item->rider_id)
                        ->all(),
                ];
            })->values()->all(),
            'riders' => $riders->map(function ($row) use ($options): array {
                $id = (string) $row->id;
                return [
                    'id' => $id,
                    'category' => (string) ($row->category ?? ''),
                    'fullName' => (string) ($row->full_name ?? ''),
                    'shortName' => (string) ($row->short_name ?? ''),
                    'type' => (string) ($row->type_key ?? ''),
                    'notes' => (string) ($row->notes ?? ''),
                    'optionTitle' => (string) ($row->option_title ?? ''),
                    'options' => $options->where('product_id', $id)->values()->map(static fn ($item): array => [
                        'label' => (string) $item->label,
                        'fycRate' => (string) ($item->fyc_rate ?? ''),
                    ])->all(),
                    'fycRate' => (string) ($row->fyc_rate ?? ''),
                    'frequencies' => $this->frequenciesFromMask((int) ($row->frequency_mask ?? 0)),
                    'gst' => (string) ($row->gst ?? ''),
                ];
            })->values()->all(),
        ];
    }

    private function restoreProducts(array $payload, ?int $actorId): void
    {
        $types = is_array($payload['types'] ?? null) ? $payload['types'] : [];
        $basePlans = is_array($payload['basePlans'] ?? null) ? $payload['basePlans'] : [];
        $riders = is_array($payload['riders'] ?? null) ? $payload['riders'] : [];
        $now = now();

        DB::transaction(function () use ($payload, $types, $basePlans, $riders, $actorId, $now): void {
            DB::table('product_attachable_riders')->delete();
            DB::table('product_options')->delete();
            DB::table('products')->update([
                'is_deleted' => true,
                'updated_at' => $now,
            ]);
            DB::table('product_type_definitions')->update([
                'is_deleted' => true,
                'updated_at' => $now,
            ]);

            $typePosition = 0;
            foreach ($types as $index => $label) {
                $typeKey = trim((string) $index);
                $typeLabel = trim((string) $label);
                if ($typeKey === '' || $typeLabel === '') {
                    continue;
                }
                DB::table('product_type_definitions')->updateOrInsert([
                    'type_key' => $typeKey,
                ], [
                    'type_key' => $typeKey,
                    'label' => $typeLabel,
                    'position' => $typePosition,
                    'is_deleted' => false,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $typePosition++;
            }

            foreach (array_values($riders) as $position => $rider) {
                if (!is_array($rider)) {
                    continue;
                }
                $id = trim((string) ($rider['id'] ?? ''));
                if ($id === '') {
                    continue;
                }

                $frequencies = is_array($rider['frequencies'] ?? null) ? $rider['frequencies'] : [];
                DB::table('products')->updateOrInsert([
                    'id' => $id,
                ], [
                    'id' => $id,
                    'is_deleted' => false,
                    'is_rider' => true,
                    'category' => $this->nullableString($rider['category'] ?? null, 100),
                    'full_name' => $this->nullableString($rider['fullName'] ?? null, 200),
                    'short_name' => $this->nullableString($rider['shortName'] ?? null, 120),
                    'type_key' => $this->nullableString($rider['type'] ?? null, 50),
                    'notes' => $this->nullableString($rider['notes'] ?? null, 65535),
                    'option_title' => $this->nullableString($rider['optionTitle'] ?? null, 150),
                    'fyc_rate' => $this->nullableString($rider['fycRate'] ?? null, 20),
                    'frequency_mask' => $this->frequencyMaskFromInput($frequencies),
                    'gst' => $this->nullableString($rider['gst'] ?? null, 20),
                    'position' => $position,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                $options = is_array($rider['options'] ?? null) ? $rider['options'] : [];
                foreach (array_values($options) as $optIndex => $option) {
                    if (!is_array($option)) {
                        continue;
                    }
                    $label = trim((string) ($option['label'] ?? ''));
                    if ($label === '') {
                        continue;
                    }
                    DB::table('product_options')->insert([
                        'product_id' => $id,
                        'label' => $label,
                        'fyc_rate' => $this->nullableString($option['fycRate'] ?? null, 20),
                        'position' => $optIndex,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                }
            }

            $existingRiderIds = DB::table('products')
                ->where('is_rider', true)
                ->where('is_deleted', false)
                ->pluck('id')
                ->flip();

            foreach (array_values($basePlans) as $position => $plan) {
                if (!is_array($plan)) {
                    continue;
                }
                $id = trim((string) ($plan['id'] ?? ''));
                if ($id === '') {
                    continue;
                }

                $frequencies = is_array($plan['frequencies'] ?? null) ? $plan['frequencies'] : [];
                DB::table('products')->updateOrInsert([
                    'id' => $id,
                ], [
                    'id' => $id,
                    'is_deleted' => false,
                    'is_rider' => false,
                    'category' => $this->nullableString($plan['category'] ?? null, 100),
                    'full_name' => $this->nullableString($plan['fullName'] ?? null, 200),
                    'short_name' => $this->nullableString($plan['shortName'] ?? null, 120),
                    'type_key' => $this->nullableString($plan['type'] ?? null, 50),
                    'notes' => $this->nullableString($plan['notes'] ?? null, 65535),
                    'option_title' => $this->nullableString($plan['optionTitle'] ?? null, 150),
                    'fyc_rate' => $this->nullableString($plan['fycRate'] ?? null, 20),
                    'frequency_mask' => $this->frequencyMaskFromInput($frequencies),
                    'gst' => $this->nullableString($plan['gst'] ?? null, 20),
                    'position' => $position,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                $options = is_array($plan['options'] ?? null) ? $plan['options'] : [];
                foreach (array_values($options) as $optIndex => $option) {
                    if (!is_array($option)) {
                        continue;
                    }
                    $label = trim((string) ($option['label'] ?? ''));
                    if ($label === '') {
                        continue;
                    }
                    DB::table('product_options')->insert([
                        'product_id' => $id,
                        'label' => $label,
                        'fyc_rate' => $this->nullableString($option['fycRate'] ?? null, 20),
                        'position' => $optIndex,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                }

                $attachableRiders = is_array($plan['attachableRiders'] ?? null) ? $plan['attachableRiders'] : [];
                foreach (array_values($attachableRiders) as $attachIndex => $riderId) {
                    $rid = trim((string) $riderId);
                    if ($rid === '' || !$existingRiderIds->has($rid)) {
                        continue;
                    }
                    DB::table('product_attachable_riders')->insert([
                        'base_product_id' => $id,
                        'rider_id' => $rid,
                        'position' => $attachIndex,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                }
            }

            DB::table('product_settings')->updateOrInsert(
                ['id' => 1],
                [
                    'gst' => isset($payload['gst']) && $payload['gst'] !== null ? (float) $payload['gst'] : null,
                    'updated_by' => $actorId,
                    'updated_at' => $now,
                    'created_at' => $now,
                ]
            );
        });
    }

    private function captureSources(): array
    {
        $sources = DB::table('sources')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'label', 'description']);

        $items = DB::table('source_items')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'source_id', 'label']);

        return $sources->map(function ($source) use ($items): array {
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
                    ])
                    ->all(),
            ];
        })->values()->all();
    }

    private function restoreSources(array $payload): void
    {
        $sources = is_array($payload['sources'] ?? null)
            ? $payload['sources']
            : (array_is_list($payload) ? $payload : []);
        $normalized = $this->normalizeSources($sources);
        $now = now();

        DB::transaction(function () use ($normalized, $now): void {
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

            if ($sourceRows !== []) {
                DB::table('sources')->upsert(
                    $sourceRows,
                    ['id'],
                    ['label', 'description', 'position', 'is_deleted', 'updated_at'],
                );
            }

            if ($existingItemRows !== []) {
                DB::table('source_items')->upsert(
                    $existingItemRows,
                    ['id'],
                    ['source_id', 'label', 'position', 'is_deleted', 'updated_at'],
                );
            }

            if ($newItemRows !== []) {
                DB::table('source_items')->insert($newItemRows);
            }

            $staleItemIds = [];
            foreach ($existingItemIdsBySource as $sourceId => $idsBySource) {
                $sourceWasRemoved = in_array($sourceId, $staleSourceIds, true);
                foreach (array_keys($idsBySource) as $existingItemId) {
                    if ($sourceWasRemoved || !isset($incomingItemIds[$sourceId][$existingItemId])) {
                        $staleItemIds[] = (int) $existingItemId;
                    }
                }
            }

            if ($staleItemIds !== []) {
                DB::table('source_items')
                    ->whereIn('id', $staleItemIds)
                    ->update([
                        'is_deleted' => true,
                        'updated_at' => $now,
                    ]);
            }

            if ($staleSourceIds !== []) {
                DB::table('sources')
                    ->whereIn('id', $staleSourceIds)
                    ->update([
                        'is_deleted' => true,
                        'updated_at' => $now,
                    ]);
            }
        });
    }

    private function captureReports(): array
    {
        return $this->reportTemplateStore->list();
    }

    private function restoreReports(array $payload, ?int $actorId): void
    {
        $reports = is_array($payload['reports'] ?? null)
            ? $payload['reports']
            : (array_is_list($payload) ? $payload : []);

        DB::transaction(function () use ($reports, $actorId): void {
            $this->reportTemplateStore->replace($reports, $actorId);
        });
    }

    private function captureHandbook(): array
    {
        return DB::table('handbook_categories')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get()
            ->map(function ($row): array {
                return [
                    'id' => (int) ($row->id ?? 0),
                    'category' => (string) ($row->category ?? ''),
                    'content' => (string) ($row->content ?? ''),
                    'imageUrl' => (string) ($row->image_url ?? ''),
                    'imagePath' => (string) ($row->image_path ?? ''),
                ];
            })
            ->values()
            ->all();
    }

    private function restoreHandbook(array $payload, ?int $actorId): void
    {
        $entries = is_array($payload['payload'] ?? null)
            ? $payload['payload']
            : (array_is_list($payload) ? $payload : []);
        $now = now();
        $existingIds = DB::table('handbook_categories')
            ->pluck('id')
            ->map(static fn ($value): int => (int) $value)
            ->flip()
            ->all();
        $existingRows = [];
        $newRows = [];
        $seenExistingIds = [];

        foreach (array_values($entries) as $index => $entry) {
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
                'image_url' => $this->nullableString($entry['imageUrl'] ?? null, 500),
                'image_path' => $this->nullableString($entry['imagePath'] ?? null, 500),
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

        DB::transaction(function () use ($existingRows, $newRows, $actorId, $now): void {
            $activeIds = DB::table('handbook_categories')
                ->where('is_deleted', false)
                ->pluck('id')
                ->map(static fn ($value): int => (int) $value)
                ->all();

            if ($existingRows !== []) {
                DB::table('handbook_categories')->upsert(
                    $existingRows,
                    ['id'],
                    ['category', 'position', 'content', 'image_url', 'image_path', 'is_deleted', 'updated_by', 'updated_at']
                );
            }

            if ($newRows !== []) {
                DB::table('handbook_categories')->insert($newRows);
            }

            $keptExistingIds = array_values(array_map(
                static fn (array $row): int => (int) $row['id'],
                $existingRows
            ));
            $staleIds = array_values(array_diff($activeIds, $keptExistingIds));
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
    }

    private function captureTeam(): array
    {
        $users = DB::table('users as u')
            ->leftJoin('agencies as a', 'a.id', '=', 'u.agency_id')
            ->where('u.is_active', true)
            ->orderBy('u.agency_id')
            ->orderBy('u.fsc_code')
            ->get([
                'u.id',
                'u.email',
                'u.fsc_code',
                'u.access_level',
                'u.nickname',
                'u.full_name',
                'u.birth_date',
                'u.contract_date',
                'a.code as agency_code',
            ])
            ->map(function ($row): array {
                return [
                    'id' => (string) $row->id,
                    'email' => (string) ($row->email ?? ''),
                    'fscCode' => (string) ($row->fsc_code ?? ''),
                    'accessLevel' => (string) ($row->access_level ?? 'standard'),
                    'nickname' => (string) ($row->nickname ?? ''),
                    'fullName' => (string) ($row->full_name ?? ''),
                    'birthDate' => $row->birth_date,
                    'contractDate' => $row->contract_date,
                    'agencyCode' => (string) ($row->agency_code ?? ''),
                ];
            })
            ->values()
            ->all();

        $agencies = DB::table('agencies')
            ->orderBy('position')
            ->orderBy('name')
            ->get(['code', 'name', 'is_delete'])
            ->map(static fn ($row): array => [
                'code' => (string) $row->code,
                'name' => (string) $row->name,
                'isDeleted' => (bool) ($row->is_delete ?? false),
            ])
            ->values()
            ->all();

        return [
            'users' => $users,
            'agencies' => $agencies,
        ];
    }

    private function captureClosingMonth(string $monthKey): array
    {
        [$start, $end] = $this->monthRange($monthKey);

        $closings = DB::table('closings')
            ->where('submitted_at', '>=', $start)
            ->where('submitted_at', '<', $end)
            ->orderBy('submitted_at')
            ->orderBy('id')
            ->get()
            ->map(static fn ($row): array => (array) $row)
            ->values()
            ->all();

        $closingIds = array_values(array_map(
            static fn (array $row): int => (int) ($row['id'] ?? 0),
            $closings
        ));

        $items = DB::table('closing_items')
            ->whereIn('closing_id', $closingIds ?: [0])
            ->orderByRaw('parent_item_id IS NOT NULL')
            ->orderBy('parent_item_id')
            ->orderBy('position')
            ->orderBy('id')
            ->get()
            ->map(static fn ($row): array => (array) $row)
            ->values()
            ->all();

        $itemIds = array_values(array_map(
            static fn (array $row): int => (int) ($row['id'] ?? 0),
            $items
        ));

        $premiums = DB::table('closing_item_premiums')
            ->whereIn('closing_item_id', $itemIds ?: [0])
            ->orderBy('closing_item_id')
            ->orderBy('position')
            ->orderBy('id')
            ->get()
            ->map(static fn ($row): array => (array) $row)
            ->values()
            ->all();

        return [
            'monthKey' => $monthKey,
            'closings' => $closings,
            'items' => $items,
            'premiums' => $premiums,
        ];
    }

    private function restoreClosings(array $payload): void
    {
        $months = is_array($payload['months'] ?? null) ? $payload['months'] : [];

        DB::transaction(function () use ($months): void {
            foreach ($months as $monthSnapshot) {
                if (!is_array($monthSnapshot)) {
                    continue;
                }

                $monthKey = trim((string) ($monthSnapshot['monthKey'] ?? ''));
                $this->assertMonthKey($monthKey);
                [$start, $end] = $this->monthRange($monthKey);

                DB::table('closings')
                    ->where('submitted_at', '>=', $start)
                    ->where('submitted_at', '<', $end)
                    ->delete();

                $closings = is_array($monthSnapshot['closings'] ?? null) ? $monthSnapshot['closings'] : [];
                $items = is_array($monthSnapshot['items'] ?? null) ? $monthSnapshot['items'] : [];
                $premiums = is_array($monthSnapshot['premiums'] ?? null) ? $monthSnapshot['premiums'] : [];

                foreach ($closings as $row) {
                    if (!is_array($row)) {
                        continue;
                    }
                    DB::table('closings')->insert($row);
                }

                foreach ($items as $row) {
                    if (!is_array($row)) {
                        continue;
                    }
                    DB::table('closing_items')->insert($row);
                }

                foreach ($premiums as $row) {
                    if (!is_array($row)) {
                        continue;
                    }
                    DB::table('closing_item_premiums')->insert($row);
                }
            }
        });
    }

    private function storeSnapshot(
        string $feature,
        array $payload,
        ?int $actorId = null,
        ?string $summary = null,
        ?string $scopeKey = null
    ): void {
        $this->insertSnapshot($feature, $payload, $actorId, $summary, $scopeKey);
        $this->pruneSnapshots();
    }

    private function storePreRestoreSnapshot(
        string $feature,
        array $restoredPayload,
        ?int $actorId = null,
        ?string $restoredSummary = null,
        ?string $restoredScopeKey = null
    ): void {
        $snapshot = $this->captureCurrentSnapshotForRestore($feature, $restoredPayload, $restoredScopeKey);
        $baseSummary = $restoredSummary ?? $this->defaultSummaryForFeature($feature);
        $summary = $this->nullableString('Before restore: ' . $baseSummary, 255)
            ?? $this->defaultSummaryForFeature($feature);

        $this->insertSnapshot(
            $feature,
            $snapshot['payload'],
            $actorId,
            $summary,
            $snapshot['scopeKey'] ?? null
        );
    }

    private function captureCurrentSnapshotForRestore(
        string $feature,
        array $restoredPayload,
        ?string $restoredScopeKey = null
    ): array {
        return match ($feature) {
            self::FEATURE_PRODUCTS => [
                'payload' => $this->captureProducts(),
            ],
            self::FEATURE_SOURCES => [
                'payload' => $this->captureSources(),
            ],
            self::FEATURE_REPORTS => [
                'payload' => ['reports' => $this->captureReports()],
            ],
            self::FEATURE_TEAM => [
                'payload' => $this->captureTeam(),
            ],
            self::FEATURE_HANDBOOK => [
                'payload' => ['payload' => $this->captureHandbook()],
            ],
            self::FEATURE_CLOSINGS => $this->captureCurrentClosingSnapshotForRestore(
                $restoredPayload,
                $restoredScopeKey
            ),
            default => throw new InvalidArgumentException('Unsupported snapshot feature.'),
        };
    }

    private function captureCurrentClosingSnapshotForRestore(array $restoredPayload, ?string $restoredScopeKey = null): array
    {
        $monthKeys = [];
        $months = is_array($restoredPayload['months'] ?? null) ? $restoredPayload['months'] : [];

        foreach ($months as $monthSnapshot) {
            if (!is_array($monthSnapshot)) {
                continue;
            }

            $monthKey = trim((string) ($monthSnapshot['monthKey'] ?? ''));
            if ($monthKey === '' || in_array($monthKey, $monthKeys, true)) {
                continue;
            }

            $monthKeys[] = $monthKey;
        }

        if ($monthKeys === [] && $restoredScopeKey !== null) {
            foreach (explode(',', $restoredScopeKey) as $candidate) {
                $monthKey = trim($candidate);
                if ($monthKey === '' || in_array($monthKey, $monthKeys, true)) {
                    continue;
                }

                $monthKeys[] = $monthKey;
            }
        }

        $monthsPayload = [];
        foreach ($monthKeys as $monthKey) {
            $this->assertMonthKey($monthKey);
            $monthsPayload[] = $this->captureClosingMonth($monthKey);
        }

        return [
            'payload' => ['months' => $monthsPayload],
            'scopeKey' => $monthKeys !== [] ? implode(',', $monthKeys) : null,
        ];
    }

    private function applySnapshotRestore(string $feature, array $payload, ?int $actorId = null): void
    {
        match ($feature) {
            self::FEATURE_PRODUCTS => $this->restoreProducts($payload, $actorId),
            self::FEATURE_SOURCES => $this->restoreSources($payload),
            self::FEATURE_REPORTS => $this->restoreReports($payload, $actorId),
            self::FEATURE_TEAM => $this->restoreTeam($payload),
            self::FEATURE_HANDBOOK => $this->restoreHandbook($payload, $actorId),
            self::FEATURE_CLOSINGS => $this->restoreClosings($payload),
            default => throw new InvalidArgumentException('Unsupported snapshot feature.'),
        };
    }

    private function insertSnapshot(
        string $feature,
        array $payload,
        ?int $actorId = null,
        ?string $summary = null,
        ?string $scopeKey = null
    ): void {
        $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
        $now = now();

        DB::table('admin_restore_snapshots')->insert([
            'feature' => $this->normalizeFeature($feature),
            'summary' => $this->nullableString($summary, 255),
            'scope_key' => $this->nullableString($scopeKey, 120),
            'payload' => $encoded,
            'created_by' => $actorId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    private function pruneSnapshots(): void
    {
        $idsToKeep = $this->retainedSnapshotIds();

        if ($idsToKeep !== []) {
            DB::table('admin_restore_snapshots')
                ->whereNotIn('id', $idsToKeep)
                ->delete();
        }
    }

    private function retainedSnapshotIds(array $features = []): array
    {
        $query = DB::table('admin_restore_snapshots')
            ->select(['id', 'feature'])
            ->orderBy('feature')
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        if ($features !== []) {
            $query->whereIn('feature', array_values(array_unique(array_map(
                fn (string $feature): string => $this->normalizeFeature($feature),
                $features
            ))));
        }

        $rows = $query->get();
        $counts = [];
        $ids = [];

        foreach ($rows as $row) {
            $feature = strtolower(trim((string) ($row->feature ?? '')));
            if ($feature === '') {
                continue;
            }
            $count = $counts[$feature] ?? 0;
            if ($count >= self::SNAPSHOT_RETENTION_COUNT) {
                continue;
            }

            $counts[$feature] = $count + 1;
            $ids[] = (int) ($row->id ?? 0);
        }

        return array_values(array_filter($ids, static fn (int $id): bool => $id > 0));
    }

    private function featuresForViewer(?User $viewer): array
    {
        $access = $this->normalizeAccessLevel((string) ($viewer?->access_level ?? ''));

        return match ($access) {
            'admin' => [
                self::FEATURE_PRODUCTS,
                self::FEATURE_SOURCES,
                self::FEATURE_REPORTS,
                self::FEATURE_TEAM,
                self::FEATURE_HANDBOOK,
            ],
            'editor' => [
                self::FEATURE_PRODUCTS,
                self::FEATURE_SOURCES,
                self::FEATURE_HANDBOOK,
            ],
            default => [],
        };
    }

    private function viewerCanAccessFeature(?User $viewer, string $feature): bool
    {
        return in_array($feature, $this->featuresForViewer($viewer), true);
    }

    private function defaultSummaryForFeature(string $feature): string
    {
        return match ($feature) {
            self::FEATURE_PRODUCTS => 'after Edit Plan / Rider / Top-up',
            self::FEATURE_SOURCES => 'after editing sources',
            self::FEATURE_TEAM => 'after editing team changes',
            self::FEATURE_HANDBOOK => 'after editing handbook',
            self::FEATURE_REPORTS => 'after editing report templates',
            self::FEATURE_CLOSINGS => 'Closings: after saving closings',
            default => 'Restore snapshot',
        };
    }

    private function normalizeProductsSnapshotSummary(?string $summary): string
    {
        $resolved = $this->nullableString($summary, 255) ?? 'after Edit Plan / Rider / Top-up';
        $beforeRestorePrefix = 'Before restore: ';

        if (str_starts_with($resolved, $beforeRestorePrefix)) {
            $innerSummary = trim(substr($resolved, strlen($beforeRestorePrefix)));
            return $beforeRestorePrefix . $this->normalizeProductsSnapshotSummary($innerSummary);
        }

        if (
            $resolved === 'Edit GST / Type Definitions'
            || $resolved === 'after Edit GST / Type Definitions'
        ) {
            return 'after editing GST / type definitions';
        }

        if (
            $resolved === 'Reorder Categories / Products'
            || $resolved === 'after Reorder Categories / Products'
        ) {
            return 'after reordering categories / products';
        }

        if (str_starts_with(strtolower($resolved), 'after ')) {
            return $resolved;
        }

        return $this->nullableString('after ' . $resolved, 255)
            ?? 'after Edit Plan / Rider / Top-up';
    }

    private function normalizeSourcesSnapshotSummary(?string $summary): string
    {
        $resolved = $this->nullableString($summary, 255) ?? 'after editing sources';
        $beforeRestorePrefix = 'Before restore: ';

        if (str_starts_with($resolved, $beforeRestorePrefix)) {
            $innerSummary = trim(substr($resolved, strlen($beforeRestorePrefix)));
            return $beforeRestorePrefix . $this->normalizeSourcesSnapshotSummary($innerSummary);
        }

        if (preg_match('/^Manage Closing Sources: after adding source "(.+)" \([^)]+\)$/', $resolved, $matches)) {
            $resolved = 'after adding ' . trim((string) ($matches[1] ?? ''));
        } elseif (preg_match('/^Manage Closing Sources: after deleting source "(.+)" \([^)]+\)$/', $resolved, $matches)) {
            $resolved = 'after deleting ' . trim((string) ($matches[1] ?? ''));
        } elseif (preg_match('/^Manage Closing Sources: after updating source "(.+)" \([^)]+\)$/', $resolved, $matches)) {
            $resolved = 'after editing ' . trim((string) ($matches[1] ?? ''));
        } elseif (
            $resolved === 'Manage Closing Sources: after reordering sources'
            || $resolved === 'after Reorder Sources'
        ) {
            $resolved = 'after reordering sources';
        } elseif ($resolved === 'Manage Closing Sources: after saving sources') {
            $resolved = 'after editing sources';
        } elseif (preg_match('/^after Add (.+)$/', $resolved, $matches)) {
            $resolved = 'after adding ' . trim((string) ($matches[1] ?? ''));
        } elseif (preg_match('/^after Delete (.+)$/', $resolved, $matches)) {
            $resolved = 'after deleting ' . trim((string) ($matches[1] ?? ''));
        } elseif (preg_match('/^after Edit (.+)$/', $resolved, $matches)) {
            $resolved = 'after editing ' . trim((string) ($matches[1] ?? ''));
        } elseif ($resolved === 'after Edit Sources') {
            $resolved = 'after editing sources';
        }

        if (str_starts_with(strtolower($resolved), 'after ')) {
            return $resolved;
        }

        return $this->nullableString('after ' . $resolved, 255)
            ?? 'after editing sources';
    }

    private function normalizeReportsSnapshotSummary(?string $summary): string
    {
        $resolved = $this->nullableString($summary, 255) ?? 'after editing report templates';
        $beforeRestorePrefix = 'Before restore: ';

        if (str_starts_with($resolved, $beforeRestorePrefix)) {
            $innerSummary = trim(substr($resolved, strlen($beforeRestorePrefix)));
            return $beforeRestorePrefix . $this->normalizeReportsSnapshotSummary($innerSummary);
        }

        if (preg_match('/^Manage Report Templates: after adding report template "(.+)"$/', $resolved, $matches)) {
            $resolved = 'after adding ' . trim((string) ($matches[1] ?? ''));
        } elseif (preg_match('/^Manage Report Templates: after updating report template "(.+)"$/', $resolved, $matches)) {
            $resolved = 'after editing ' . trim((string) ($matches[1] ?? ''));
        } elseif (preg_match('/^Manage Report Templates: after deleting report template "(.+)"$/', $resolved, $matches)) {
            $resolved = 'after deleting ' . trim((string) ($matches[1] ?? ''));
        } elseif ($resolved === 'Manage Report Templates: after reordering report templates') {
            $resolved = 'after reordering report templates';
        } elseif (
            $resolved === 'Manage Report Templates: after saving report templates'
            || preg_match('/^Manage Report Templates: after saving report templates \(.+\)$/', $resolved)
        ) {
            $resolved = 'after editing report templates';
        }

        if (str_starts_with(strtolower($resolved), 'after ')) {
            return $resolved;
        }

        return $this->nullableString('after ' . $resolved, 255)
            ?? 'after editing report templates';
    }

    private function normalizeHandbookSnapshotSummary(?string $summary): string
    {
        $resolved = $this->nullableString($summary, 255) ?? 'after editing handbook';
        $beforeRestorePrefix = 'Before restore: ';

        if (str_starts_with($resolved, $beforeRestorePrefix)) {
            $innerSummary = trim(substr($resolved, strlen($beforeRestorePrefix)));
            return $beforeRestorePrefix . $this->normalizeHandbookSnapshotSummary($innerSummary);
        }

        if (preg_match('/^Manage Handbook: after adding category "(.+)"$/', $resolved, $matches)) {
            $resolved = 'after adding ' . trim((string) ($matches[1] ?? ''));
        } elseif (preg_match('/^Manage Handbook: after deleting category #\d+ "(.+)"$/', $resolved, $matches)) {
            $resolved = 'after deleting ' . trim((string) ($matches[1] ?? ''));
        } elseif (preg_match('/^Manage Handbook: after updating category #\d+ "(.+)"$/', $resolved, $matches)) {
            $resolved = 'after editing ' . trim((string) ($matches[1] ?? ''));
        } elseif ($resolved === 'Manage Handbook: after reordering categories') {
            $resolved = 'after reordering categories';
        } elseif ($resolved === 'Manage Handbook: after saving handbook') {
            $resolved = 'after editing handbook';
        }

        if (str_starts_with(strtolower($resolved), 'after ')) {
            return $resolved;
        }

        return $this->nullableString('after ' . $resolved, 255)
            ?? 'after editing handbook';
    }

    private function normalizeTeamSnapshotSummary(?string $summary): string
    {
        $resolved = $this->nullableString($summary, 255) ?? 'after editing team changes';
        $beforeRestorePrefix = 'Before restore: ';
        $legacyPrefix = 'Manage Team: ';

        if (str_starts_with($resolved, $beforeRestorePrefix)) {
            $innerSummary = trim(substr($resolved, strlen($beforeRestorePrefix)));
            return $beforeRestorePrefix . $this->normalizeTeamSnapshotSummary($innerSummary);
        }

        if (str_starts_with($resolved, $legacyPrefix)) {
            $resolved = trim(substr($resolved, strlen($legacyPrefix)));
        }

        if (preg_match('/^after adding team member "(.+)"$/', $resolved, $matches)) {
            $resolved = 'after adding ' . trim((string) ($matches[1] ?? ''));
        } elseif (preg_match('/^after updating team member #(\d+) "(.+)"$/', $resolved, $matches)) {
            $resolved = sprintf(
                'after editing %s (ID#%d)',
                trim((string) ($matches[2] ?? '')),
                (int) ($matches[1] ?? 0)
            );
        } elseif (preg_match('/^after deleting team member #(\d+) "(.+)"$/', $resolved, $matches)) {
            $resolved = sprintf(
                'after deleting %s (ID#%d)',
                trim((string) ($matches[2] ?? '')),
                (int) ($matches[1] ?? 0)
            );
        } elseif (preg_match('/^after moving team member #(\d+) "(.+)" to agency .+$/', $resolved, $matches)) {
            $resolved = sprintf(
                'after editing %s (ID#%d)',
                trim((string) ($matches[2] ?? '')),
                (int) ($matches[1] ?? 0)
            );
        } elseif (preg_match('/^after reassigning agencies for \d+ users$/', $resolved)) {
            $resolved = 'after editing team member agencies';
        } elseif (preg_match('/^after adding agency "(.+)" \((.+)\)$/', $resolved, $matches)) {
            $resolved = sprintf(
                'after adding agency %s (%s)',
                trim((string) ($matches[1] ?? '')),
                trim((string) ($matches[2] ?? ''))
            );
        } elseif (preg_match('/^after updating agency "(.+)" \((.+)\)$/', $resolved, $matches)) {
            $resolved = sprintf(
                'after editing agency %s (%s)',
                trim((string) ($matches[1] ?? '')),
                trim((string) ($matches[2] ?? ''))
            );
        } elseif (preg_match('/^after deleting agency "(.+)" \((.+)\)$/', $resolved, $matches)) {
            $resolved = sprintf(
                'after deleting agency %s (%s)',
                trim((string) ($matches[1] ?? '')),
                trim((string) ($matches[2] ?? ''))
            );
        } elseif (preg_match('/^after saving \d+ agencies$/', $resolved)) {
            $resolved = 'after reordering agencies';
        }

        if (str_starts_with(strtolower($resolved), 'after ')) {
            return $resolved;
        }

        return $this->nullableString('after ' . $resolved, 255)
            ?? 'after editing team changes';
    }

    private function normalizeFeature(string $feature): string
    {
        $normalized = strtolower(trim($feature));

        return match ($normalized) {
            self::FEATURE_PRODUCTS,
            self::FEATURE_SOURCES,
            self::FEATURE_REPORTS,
            self::FEATURE_TEAM,
            self::FEATURE_HANDBOOK,
            self::FEATURE_CLOSINGS => $normalized,
            default => throw new InvalidArgumentException('Unsupported undo feature.'),
        };
    }

    private function frequenciesFromMask(int $mask): array
    {
        $values = [];
        if (($mask & self::FREQUENCY_SINGLE) === self::FREQUENCY_SINGLE) {
            $values[] = 'Single';
        }
        if (($mask & self::FREQUENCY_MONTHLY_1) === self::FREQUENCY_MONTHLY_1) {
            $values[] = 'Mthly-1';
        }
        if (($mask & self::FREQUENCY_MONTHLY_2) === self::FREQUENCY_MONTHLY_2) {
            $values[] = 'Mthly-2';
        }
        if (($mask & self::FREQUENCY_QUARTERLY) === self::FREQUENCY_QUARTERLY) {
            $values[] = 'Quarterly';
        }
        if (($mask & self::FREQUENCY_SEMI_ANNUAL) === self::FREQUENCY_SEMI_ANNUAL) {
            $values[] = 'Semi-Annual';
        }
        if (($mask & self::FREQUENCY_ANNUAL) === self::FREQUENCY_ANNUAL) {
            $values[] = 'Annual';
        }

        return $values;
    }

    private function frequencyMaskFromInput(array $frequencies): int
    {
        $mask = 0;
        foreach ($frequencies as $frequency) {
            $normalized = strtolower(trim((string) $frequency));
            $mask |= match ($normalized) {
                'single' => self::FREQUENCY_SINGLE,
                'mthly-1', 'monthly-1' => self::FREQUENCY_MONTHLY_1,
                'mthly-2', 'monthly-2' => self::FREQUENCY_MONTHLY_2,
                'quarterly' => self::FREQUENCY_QUARTERLY,
                'semi-annual', 'semiannual' => self::FREQUENCY_SEMI_ANNUAL,
                'annual' => self::FREQUENCY_ANNUAL,
                default => 0,
            };
        }

        return $mask;
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
                'description' => $this->nullableString($source['description'] ?? null, 65535) ?? '',
                'position' => count($normalized),
                'children' => $normalizedChildren,
            ];
        }

        return $normalized;
    }

    private function normalizeLookupKey(string $value): string
    {
        return mb_strtolower(trim($value));
    }

    private function assertMonthKey(string $monthKey): void
    {
        if (!preg_match('/^\d{4}(0[1-9]|1[0-2])$/', $monthKey)) {
            throw ValidationException::withMessages([
                'monthKey' => 'monthKey must be in YYYYMM format.',
            ]);
        }
    }

    private function monthRange(string $monthKey): array
    {
        $year = (int) substr($monthKey, 0, 4);
        $month = (int) substr($monthKey, 4, 2);
        $start = Carbon::create($year, $month, 1, 0, 0, 0, config('app.timezone'));
        $end = (clone $start)->addMonth();
        return [$start, $end];
    }

    private function normalizeAccessLevel(string $incoming, string $fallback = 'standard'): string
    {
        $value = strtolower(trim($incoming));
        if ($value === '' || $value === 'standard') {
            $value = strtolower(trim($fallback)) ?: 'standard';
        }

        return match ($value) {
            'superadmin', 'director', 'admin' => 'admin',
            'editor' => 'editor',
            'standard' => 'standard',
            default => 'standard',
        };
    }

    private function normalizeDateString(?string $value, int $year, int $month, int $day): ?string
    {
        $trimmed = trim((string) $value);
        if ($trimmed !== '') {
            return substr($trimmed, 0, 10);
        }

        if ($year > 0 && $month > 0 && $day > 0) {
            return sprintf('%04d-%02d-%02d', $year, $month, $day);
        }

        return null;
    }

    private function toBoolean(mixed $value, bool $defaultValue): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_numeric($value)) {
            return (int) $value !== 0;
        }
        if (is_string($value)) {
            $normalized = strtolower(trim($value));
            if ($normalized === '') {
                return $defaultValue;
            }
            if (in_array($normalized, ['1', 'true', 'yes', 'y'], true)) {
                return true;
            }
            if (in_array($normalized, ['0', 'false', 'no', 'n'], true)) {
                return false;
            }
        }

        return $defaultValue;
    }

    private function nullableString(mixed $value, int $maxLength): ?string
    {
        $text = trim((string) $value);
        if ($text === '') {
            return null;
        }

        return substr($text, 0, $maxLength);
    }

    private function firstNonEmpty(array $values): ?string
    {
        foreach ($values as $value) {
            $text = trim((string) $value);
            if ($text !== '') {
                return $text;
            }
        }

        return null;
    }

    private function toIsoOrNull(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return Carbon::parse((string) $value)->toISOString();
    }
}
