<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ClosingsController extends Controller
{
    private const BACKUP_TTL_DAYS = 90;

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'startDate' => ['required', 'date'],
            'endDate' => ['required', 'date'],
            'fscCode' => ['nullable', 'string', 'max:20'],
        ]);

        $start = $this->parseClosingFilterStart((string) $filters['startDate']);
        $end = $this->parseClosingFilterEnd((string) $filters['endDate']);
        if ($start->gte($end)) {
            throw ValidationException::withMessages([
                'endDate' => 'endDate must be later than startDate.',
            ]);
        }

        $query = $this->baseClosingsQuery()
            ->where('c.submitted_at', '>=', $start)
            ->where('c.submitted_at', '<', $end);

        $fscCode = trim((string) ($filters['fscCode'] ?? ''));
        if ($fscCode !== '') {
            $query->where(function ($q) use ($fscCode): void {
                $q->where('c.fsc_code', $fscCode)
                    ->orWhere('c.shared_fsc_code', $fscCode)
                    ->orWhere('fu.fsc_code', $fscCode)
                    ->orWhere('su.fsc_code', $fscCode);
            });
        }

        $rows = $query
            ->orderByDesc('c.submitted_at')
            ->orderByDesc('c.id')
            ->get();

        return response()->json([
            'closings' => $this->hydrateClosings($rows)->values(),
        ]);
    }

    public function dateRange(): JsonResponse
    {
        $min = DB::table('closings')->min('submitted_at');
        $max = DB::table('closings')->max('submitted_at');

        return response()->json([
            'minDate' => $min,
            'maxDate' => $max,
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $row = $this->baseClosingsQuery()
            ->where('c.id', $id)
            ->first();

        if (!$row) {
            return response()->json(['message' => 'Closing not found'], 404);
        }

        $closing = $this->hydrateClosings(collect([$row]))->first();
        return response()->json(['closing' => $closing]);
    }

    public function store(Request $request): JsonResponse
    {
        $payload = $this->validateClosingPayload($request);
        $actorId = $request->user()?->id;
        $now = now();

        $closingId = DB::transaction(function () use ($payload, $actorId, $now): int {
            return $this->insertClosingFromPayload($payload, $actorId, $now);
        });

        return response()->json(['id' => (string) $closingId], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $payload = $this->validateClosingPayload($request);
        $actor = $request->user();
        $actorId = $actor?->id;

        $existing = DB::table('closings')->where('id', $id)->first();
        if (!$existing) {
            return response()->json(['message' => 'Closing not found'], 404);
        }

        if (!$this->canManageClosing($actorId, (string) ($actor?->access_level ?? ''), $existing)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $now = now();

        DB::transaction(function () use ($id, $payload, $actorId, $now, $existing): void {
            $createdBy = $existing->created_by !== null ? (int) $existing->created_by : null;
            $createdAt = $existing->created_at !== null
                ? $this->parseTimestamp($existing->created_at)
                : $this->parseTimestamp($now);

            $record = $this->prepareClosingRecord($payload, $actorId, $now, $createdBy, $createdAt);
            DB::table('closings')
                ->where('id', $id)
                ->update($record);

            DB::table('closing_items')->where('closing_id', $id)->delete();
            $catalogRiderFlags = $this->catalogRiderFlagsForPayloadItems($payload['items']);
            $insertedRootItems = $this->insertClosingItems($id, $payload['items'], $now, null, false, $catalogRiderFlags);
            if ($insertedRootItems <= 0) {
                throw ValidationException::withMessages([
                    'items' => 'At least one valid closing item is required.',
                ]);
            }
        });

        return response()->json(['saved' => true]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $actor = $request->user();
        $actorId = $actor?->id;

        $existing = DB::table('closings')->where('id', $id)->first();
        if (!$existing) {
            return response()->json(['message' => 'Closing not found'], 404);
        }

        if (!$this->canManageClosing($actorId, (string) ($actor?->access_level ?? ''), $existing)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        DB::transaction(function () use ($id): void {
            DB::table('closings')->where('id', $id)->delete();
        });

        return response()->json(['deleted' => true]);
    }

    public function monthData(string $monthKey): JsonResponse
    {
        $this->assertMonthKey($monthKey);
        $entries = $this->exportMonthEntries($monthKey);
        return response()->json([
            'data' => json_encode($entries, JSON_UNESCAPED_UNICODE),
        ]);
    }

    public function monthBackups(string $monthKey): JsonResponse
    {
        $this->assertMonthKey($monthKey);

        $rows = DB::table('closing_month_backups as b')
            ->leftJoin('users as u', 'u.id', '=', 'b.created_by')
            ->where('b.month_key', $monthKey)
            ->where(function ($q): void {
                $q->whereNull('b.expires_at')->orWhere('b.expires_at', '>=', now());
            })
            ->orderByDesc('b.created_at')
            ->limit(50)
            ->get([
                'b.id',
                'b.month_key',
                'b.data',
                'b.created_at',
                'b.expires_at',
                'u.nickname as created_by_nickname',
                'u.full_name as created_by_full_name',
            ]);

        $backups = $rows->map(function ($row): array {
            return [
                'id' => (string) $row->id,
                'monthKey' => (string) $row->month_key,
                'data' => (string) ($row->data ?? '[]'),
                'createdAt' => $this->toIsoOrNull($row->created_at),
                'expiresAt' => $this->toIsoOrNull($row->expires_at),
                'createdBy' => $this->firstNonEmpty([
                    (string) ($row->created_by_nickname ?? ''),
                    (string) ($row->created_by_full_name ?? ''),
                ]),
            ];
        })->values();

        return response()->json(['backups' => $backups]);
    }

    public function replaceMonthData(Request $request, string $monthKey): JsonResponse
    {
        $this->assertMonthKey($monthKey);
        $payload = $request->validate([
            'data' => ['required', 'string'],
        ]);

        $decoded = json_decode((string) $payload['data'], true);
        if (!is_array($decoded)) {
            throw ValidationException::withMessages([
                'data' => 'data must be a JSON array.',
            ]);
        }

        $actorId = $request->user()?->id;
        $now = now();
        [$monthStart, $monthEnd] = $this->monthRange($monthKey);

        DB::transaction(function () use ($monthKey, $decoded, $actorId, $now, $monthStart, $monthEnd): void {
            $this->backupMonthData($monthKey, $actorId);

            DB::table('closings')
                ->where('submitted_at', '>=', $monthStart)
                ->where('submitted_at', '<', $monthEnd)
                ->delete();

            foreach ($decoded as $entry) {
                if (!is_array($entry)) {
                    continue;
                }
                $payload = $this->normalizeImportedClosingPayload($entry, $monthStart, $monthEnd);
                if (!$payload) {
                    continue;
                }
                $this->insertClosingFromPayload($payload, $actorId, $now);
            }
        });

        return response()->json(['saved' => true]);
    }

    public function deleteBackup(int $id): JsonResponse
    {
        DB::table('closing_month_backups')->where('id', $id)->delete();
        return response()->json(['deleted' => true]);
    }

    private function validateClosingPayload(Request $request): array
    {
        /** @var array{
         *  timestamp:mixed,
         *  fscCode:mixed,
         *  sharedFscCode?:mixed,
         *  isShared?:mixed,
         *  sourceId:mixed,
         *  sourceItemId?:mixed,
         *  sourceComment?:mixed,
         *  referrals:mixed,
         *  referralsComment?:mixed,
         *  items:mixed
         * } $validated
         */
        $validated = $request->validate([
            'timestamp' => ['required'],
            'fscCode' => ['required', 'string', 'max:20'],
            'sharedFscCode' => ['nullable', 'string', 'max:20'],
            'isShared' => ['nullable', 'boolean'],
            'sourceId' => ['required', 'string', 'max:100'],
            'sourceItemId' => ['nullable'],
            'sourceComment' => ['nullable', 'string'],
            'referrals' => ['required', 'integer', 'min:0'],
            'referralsComment' => ['nullable', 'string'],
            'items' => ['required', 'array', 'min:1'],
        ]);

        $items = is_array($validated['items']) ? $validated['items'] : [];
        if (count($items) === 0) {
            throw ValidationException::withMessages([
                'items' => 'At least one closing item is required.',
            ]);
        }

        return [
            'timestamp' => $validated['timestamp'],
            'fscCode' => trim((string) $validated['fscCode']),
            'sharedFscCode' => $this->nullableString($validated['sharedFscCode'] ?? null, 20),
            'isShared' => array_key_exists('isShared', $validated)
                ? $this->nullableBool($validated['isShared'])
                : null,
            'sourceId' => trim((string) $validated['sourceId']),
            'sourceItemId' => $validated['sourceItemId'] ?? null,
            'sourceComment' => $this->nullableString($validated['sourceComment'] ?? null, 65535),
            'referrals' => max(0, (int) $validated['referrals']),
            'referralsComment' => $this->nullableString($validated['referralsComment'] ?? null, 65535),
            'items' => $items,
        ];
    }

    private function insertClosingFromPayload(array $payload, ?int $actorId, \DateTimeInterface $now): int
    {
        $record = $this->prepareClosingRecord($payload, $actorId, $now, $actorId);
        $closingId = DB::table('closings')->insertGetId($record);
        $catalogRiderFlags = $this->catalogRiderFlagsForPayloadItems($payload['items']);
        $insertedRootItems = $this->insertClosingItems($closingId, $payload['items'], $now, null, false, $catalogRiderFlags);
        if ($insertedRootItems <= 0) {
            throw ValidationException::withMessages([
                'items' => 'At least one valid closing item is required.',
            ]);
        }
        return (int) $closingId;
    }

    private function prepareClosingRecord(
        array $payload,
        ?int $actorId,
        \DateTimeInterface $now,
        ?int $createdBy,
        ?\DateTimeInterface $createdAt = null
    ): array {
        $submittedAt = $this->parseTimestamp($payload['timestamp'] ?? null);

        $owner = $this->resolveUserByFscCode((string) ($payload['fscCode'] ?? ''));
        if (!$owner) {
            throw ValidationException::withMessages([
                'fscCode' => 'Unknown FSC code.',
            ]);
        }

        $sharedCode = trim((string) ($payload['sharedFscCode'] ?? ''));
        $shared = null;
        if ($sharedCode !== '') {
            $shared = $this->resolveUserByFscCode($sharedCode);
            if (!$shared) {
                throw ValidationException::withMessages([
                    'sharedFscCode' => 'Unknown shared FSC code.',
                ]);
            }
        }

        $requestedIsShared = $this->nullableBool($payload['isShared'] ?? null);
        $hasSharedDetails = $shared !== null;
        if ($requestedIsShared === false && $hasSharedDetails) {
            throw ValidationException::withMessages([
                'isShared' => 'isShared cannot be false when shared FSC data is provided.',
            ]);
        }
        $isShared = $requestedIsShared ?? $hasSharedDetails;
        if ($isShared && !$hasSharedDetails) {
            throw ValidationException::withMessages([
                'isShared' => 'Shared closing requires a valid shared FSC.',
            ]);
        }
        if (!$isShared) {
            $shared = null;
        }

        $sourceId = substr((string) $payload['sourceId'], 0, 100);
        $sourceItemId = $this->resolveSourceItemIdForSource($sourceId, $payload['sourceItemId'] ?? null);

        return [
            'submitted_at' => $submittedAt,
            'fsc_user_id' => (int) $owner->id,
            'fsc_code' => substr((string) $owner->fsc_code, 0, 20),
            'fsc_agency_code' => $this->nullableString($owner->agency_code ?? null, 50),
            'is_shared' => $isShared,
            'shared_fsc_user_id' => $shared ? (int) $shared->id : null,
            'shared_fsc_code' => $shared ? substr((string) $shared->fsc_code, 0, 20) : null,
            'shared_fsc_agency_code' => $shared ? $this->nullableString($shared->agency_code ?? null, 50) : null,
            'source_id' => $sourceId,
            'source_item_id' => $sourceItemId,
            'source_comment' => $this->nullableString($payload['sourceComment'] ?? null, 65535),
            'referrals' => max(0, (int) ($payload['referrals'] ?? 0)),
            'referrals_comment' => $this->nullableString($payload['referralsComment'] ?? null, 65535),
            'created_by' => $createdBy,
            'updated_by' => $actorId,
            'created_at' => $createdAt ?? $now,
            'updated_at' => $now,
        ];
    }

    private function insertClosingItems(
        int $closingId,
        array $items,
        \DateTimeInterface $now,
        ?int $parentItemId = null,
        bool $isRider = false,
        array $catalogRiderFlags = []
    ): int {
        $inserted = 0;

        $items = $this->consolidateClosingItems($items, $isRider, $catalogRiderFlags);

        foreach (array_values($items) as $position => $item) {
            if (!is_array($item)) {
                continue;
            }

            $productId = trim((string) ($item['productId'] ?? ''));
            $fullName = trim((string) ($item['fullName'] ?? ''));
            if ($productId === '' || $fullName === '') {
                continue;
            }

            $requestedIsRider = $this->nullableBool($item['isRider'] ?? null) ?? false;
            $catalogIsRider = $catalogRiderFlags[$productId] ?? false;
            $legacyStandaloneRider = !$isRider && $this->isLegacyStandaloneAddonName($item['shortName'] ?? null);
            $effectiveIsRider = $isRider || $requestedIsRider || $catalogIsRider || $legacyStandaloneRider;

            $itemId = DB::table('closing_items')->insertGetId([
                'closing_id' => $closingId,
                'parent_item_id' => $parentItemId,
                'is_rider' => $effectiveIsRider,
                'product_id' => substr($productId, 0, 100),
                'full_name' => substr($fullName, 0, 200),
                'short_name' => $this->nullableString($item['shortName'] ?? null, 120),
                'premium_term_or_issue_age' => $this->nullableString($item['premiumTermOrIssueAge'] ?? null, 120),
                'type_key' => $this->nullableString($item['type'] ?? null, 50),
                'fyc_rate' => $this->toDecimal($item['fycRate'] ?? 0),
                'gst' => $this->toDecimal($item['gst'] ?? 0),
                'position' => $position,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $inserted++;

            $premiums = $this->consolidatePremiumRows(
                is_array($item['quantitiesAndPremiums'] ?? null) ? $item['quantitiesAndPremiums'] : []
            );
            foreach (array_values($premiums) as $premiumPosition => $premium) {
                $premiumValue = (float) ($premium['premium'] ?? 0);
                if ($premiumValue <= 0) {
                    continue;
                }

                DB::table('closing_item_premiums')->insert([
                    'closing_item_id' => $itemId,
                    'quantity' => max(1, (int) ($premium['quantity'] ?? 1)),
                    'premium' => $premiumValue,
                    'frequency' => $premium['frequency'] ?? null,
                    'position' => $premiumPosition,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            $riders = is_array($item['riders'] ?? null) ? $item['riders'] : [];
            $this->insertClosingItems($closingId, $riders, $now, (int) $itemId, true, $catalogRiderFlags);
        }

        return $inserted;
    }

    private function consolidateClosingItems(
        array $items,
        bool $isRider = false,
        array $catalogRiderFlags = []
    ): array {
        $consolidated = [];
        $indexesByKey = [];

        foreach (array_values($items) as $item) {
            if (!is_array($item)) {
                continue;
            }

            $productId = trim((string) ($item['productId'] ?? ''));
            $fullName = trim((string) ($item['fullName'] ?? ''));
            if ($productId === '' || $fullName === '') {
                continue;
            }

            $requestedIsRider = $this->nullableBool($item['isRider'] ?? null) ?? false;
            $catalogIsRider = $catalogRiderFlags[$productId] ?? false;
            $legacyStandaloneRider = !$isRider && $this->isLegacyStandaloneAddonName($item['shortName'] ?? null);
            $effectiveIsRider = $isRider || $requestedIsRider || $catalogIsRider || $legacyStandaloneRider;

            $normalizedShortName = $this->nullableString($item['shortName'] ?? null, 120);
            $normalizedPremiumTerm = $this->nullableString($item['premiumTermOrIssueAge'] ?? null, 120);
            $normalizedType = $this->nullableString($item['type'] ?? null, 50);
            $normalizedFycRate = $this->toDecimal($item['fycRate'] ?? 0);
            $normalizedGst = $this->toDecimal($item['gst'] ?? 0);
            $normalizedPremiums = $this->consolidatePremiumRows(
                is_array($item['quantitiesAndPremiums'] ?? null) ? $item['quantitiesAndPremiums'] : []
            );
            $normalizedRiders = $this->consolidateClosingItems(
                is_array($item['riders'] ?? null) ? $item['riders'] : [],
                true,
                $catalogRiderFlags
            );

            $key = implode('::', [
                $effectiveIsRider ? '1' : '0',
                substr($productId, 0, 100),
                substr($fullName, 0, 200),
                $normalizedShortName ?? '',
                $normalizedPremiumTerm ?? '',
                $normalizedType ?? '',
                number_format($normalizedFycRate, 4, '.', ''),
                number_format($normalizedGst, 2, '.', ''),
            ]);

            if (isset($indexesByKey[$key])) {
                $index = $indexesByKey[$key];
                $consolidated[$index]['quantitiesAndPremiums'] = $this->consolidatePremiumRows(
                    array_merge(
                        $consolidated[$index]['quantitiesAndPremiums'],
                        $normalizedPremiums
                    )
                );
                $consolidated[$index]['riders'] = $this->consolidateClosingItems(
                    array_merge($consolidated[$index]['riders'], $normalizedRiders),
                    true,
                    $catalogRiderFlags
                );
                continue;
            }

            $indexesByKey[$key] = count($consolidated);
            $consolidated[] = [
                'isRider' => $effectiveIsRider,
                'productId' => substr($productId, 0, 100),
                'fullName' => substr($fullName, 0, 200),
                'shortName' => $normalizedShortName ?? '',
                'premiumTermOrIssueAge' => $normalizedPremiumTerm,
                'type' => $normalizedType,
                'fycRate' => (float) $normalizedFycRate,
                'gst' => (float) $normalizedGst,
                'quantitiesAndPremiums' => $normalizedPremiums,
                'riders' => $normalizedRiders,
            ];
        }

        return $consolidated;
    }

    private function consolidatePremiumRows(array $premiums): array
    {
        $consolidated = [];
        $indexesByKey = [];

        foreach (array_values($premiums) as $premium) {
            if (!is_array($premium)) {
                continue;
            }

            $premiumValue = $this->toDecimal($premium['premium'] ?? 0);
            $quantity = max(1, (int) ($premium['quantity'] ?? 1));
            $frequency = $this->nullableString($premium['frequency'] ?? null, 30);
            $key = number_format($premiumValue, 2, '.', '') . '::' . ($frequency ?? '');

            if (isset($indexesByKey[$key])) {
                $index = $indexesByKey[$key];
                $consolidated[$index]['quantity'] += $quantity;
                continue;
            }

            $indexesByKey[$key] = count($consolidated);
            $consolidated[] = [
                'quantity' => $quantity,
                'premium' => $premiumValue,
                'frequency' => $frequency,
            ];
        }

        return $consolidated;
    }

    private function baseClosingsQuery()
    {
        return DB::table('closings as c')
            ->leftJoin('users as fu', 'fu.id', '=', 'c.fsc_user_id')
            ->leftJoin('users as su', 'su.id', '=', 'c.shared_fsc_user_id')
            ->leftJoin('users as uu', 'uu.id', '=', 'c.updated_by')
            ->leftJoin('sources as s', 's.id', '=', 'c.source_id')
            ->leftJoin('source_items as si', 'si.id', '=', 'c.source_item_id')
            ->select([
                'c.id',
                'c.submitted_at',
                'c.fsc_user_id',
                'c.shared_fsc_user_id',
                'c.fsc_code',
                'c.is_shared',
                'c.shared_fsc_code',
                'c.source_id',
                'c.source_item_id',
                'c.source_comment',
                'c.referrals',
                'c.referrals_comment',
                'c.updated_at',
                's.label as source_label',
                'si.label as source_item_label',
                'fu.fsc_code as owner_fsc_code',
                'fu.nickname as owner_nickname',
                'fu.full_name as owner_full_name',
                'su.fsc_code as shared_fsc_code_live',
                'su.nickname as shared_nickname',
                'su.full_name as shared_full_name',
                'uu.nickname as updated_by_nickname',
                'uu.full_name as updated_by_full_name',
            ]);
    }

    private function hydrateClosings(Collection $rows): Collection
    {
        if ($rows->isEmpty()) {
            return collect();
        }

        $closingIds = $rows->pluck('id')->map(static fn ($id): int => (int) $id)->all();
        $itemsByClosing = $this->loadItemsByClosingIds($closingIds);

        return $rows->map(function ($row) use ($itemsByClosing): array {
            $id = (int) $row->id;

            $fscCode = $this->firstNonEmpty([
                (string) ($row->fsc_code ?? ''),
                (string) ($row->owner_fsc_code ?? ''),
            ]) ?? '';
            $fscName = $this->displayName(
                (string) ($row->owner_nickname ?? ''),
                (string) ($row->owner_full_name ?? ''),
                $fscCode,
            );

            $sharedCode = $this->firstNonEmpty([
                (string) ($row->shared_fsc_code ?? ''),
                (string) ($row->shared_fsc_code_live ?? ''),
            ]);
            $sharedName = $this->firstNonEmpty([
                $sharedCode
                    ? $this->displayName((string) ($row->shared_nickname ?? ''), (string) ($row->shared_full_name ?? ''), $sharedCode)
                    : '',
            ]);
            $isShared = (bool) ($row->is_shared ?? false);
            if (!$isShared && ($sharedCode !== null || $sharedName !== null)) {
                $isShared = true;
            }
            if (!$isShared) {
                $sharedCode = null;
                $sharedName = null;
            }

            return [
                'id' => (string) $id,
                'timestamp' => $this->toIsoOrNull($row->submitted_at) ?? now()->toIso8601String(),
                'fscCode' => $fscCode,
                'fscName' => $fscName,
                'isShared' => $isShared,
                'sharedFscCode' => $sharedCode,
                'sharedFscName' => $sharedName,
                'sourceId' => (string) ($row->source_id ?? ''),
                'sourceLabel' => $this->firstNonEmpty([
                    (string) ($row->source_label ?? ''),
                    (string) ($row->source_id ?? ''),
                ]),
                'sourceItemId' => $this->firstNonEmpty([(string) ($row->source_item_id ?? '')]),
                'sourceItemLabel' => $this->firstNonEmpty([(string) ($row->source_item_label ?? '')]),
                'sourceComment' => $this->firstNonEmpty([(string) ($row->source_comment ?? '')]),
                'referrals' => max(0, (int) ($row->referrals ?? 0)),
                'referralsComment' => $this->firstNonEmpty([(string) ($row->referrals_comment ?? '')]),
                'updatedBy' => $this->firstNonEmpty([
                    (string) ($row->updated_by_nickname ?? ''),
                    (string) ($row->updated_by_full_name ?? ''),
                ]),
                'updatedAt' => $this->toIsoOrNull($row->updated_at),
                'items' => $itemsByClosing[$id] ?? [],
            ];
        });
    }

    private function loadItemsByClosingIds(array $closingIds): array
    {
        if (count($closingIds) === 0) {
            return [];
        }

        $itemRows = DB::table('closing_items')
            ->whereIn('closing_id', $closingIds)
            ->orderBy('closing_id')
            ->orderByRaw('parent_item_id IS NOT NULL')
            ->orderBy('parent_item_id')
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        $itemIds = $itemRows->pluck('id')->map(static fn ($id): int => (int) $id)->all();
        $catalogRiderFlags = $this->catalogRiderFlagsForProductIds(
            $itemRows
                ->pluck('product_id')
                ->map(static fn ($id): string => trim((string) $id))
                ->filter()
                ->unique()
                ->values()
                ->all()
        );
        $premiumRows = DB::table('closing_item_premiums')
            ->whereIn('closing_item_id', $itemIds ?: [0])
            ->orderBy('closing_item_id')
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        $premiumsByItemId = [];
        foreach ($premiumRows as $premium) {
            $itemId = (int) $premium->closing_item_id;
            if (!isset($premiumsByItemId[$itemId])) {
                $premiumsByItemId[$itemId] = [];
            }
            $premiumsByItemId[$itemId][] = [
                'quantity' => max(1, (int) ($premium->quantity ?? 1)),
                'premium' => (float) ($premium->premium ?? 0),
                'frequency' => $this->firstNonEmpty([(string) ($premium->frequency ?? '')]),
            ];
        }
        foreach ($premiumsByItemId as $itemId => $premiums) {
            $premiumsByItemId[$itemId] = $this->consolidatePremiumRows($premiums);
        }

        $itemsById = [];
        $rootsByClosing = [];

        foreach ($itemRows as $row) {
            $itemId = (int) $row->id;
            $closingId = (int) $row->closing_id;
            $parentId = $row->parent_item_id !== null ? (int) $row->parent_item_id : null;
            $productId = trim((string) ($row->product_id ?? ''));
            $catalogIsRider = $catalogRiderFlags[$productId] ?? false;
            $isRider =
                (bool) ($row->is_rider ?? false)
                || $catalogIsRider
                || ($parentId === null && $this->isLegacyStandaloneAddonName($row->short_name ?? null));
            $node = [
                'id' => (string) $itemId,
                'isRider' => $isRider,
                'productId' => $productId,
                'fullName' => (string) ($row->full_name ?? ''),
                'shortName' => (string) ($row->short_name ?? ''),
                'premiumTermOrIssueAge' => $this->firstNonEmpty([(string) ($row->premium_term_or_issue_age ?? '')]),
                'type' => $this->firstNonEmpty([(string) ($row->type_key ?? '')]),
                'fycRate' => (float) ($row->fyc_rate ?? 0),
                'gst' => (float) ($row->gst ?? 0),
                'quantitiesAndPremiums' => $premiumsByItemId[$itemId] ?? [],
                'riders' => [],
            ];

            $itemsById[$itemId] = $node;
            if ($parentId === null) {
                if (!isset($rootsByClosing[$closingId])) {
                    $rootsByClosing[$closingId] = [];
                }
                $rootsByClosing[$closingId][] = $itemId;
            } elseif (isset($itemsById[$parentId])) {
                $itemsById[$parentId]['riders'][] = $itemId;
            }
        }

        return $this->materializeItemTree($rootsByClosing, $itemsById);
    }

    private function materializeItemTree(array $rootsByClosing, array $itemsById): array
    {
        $resolveNode = function (int $itemId) use (&$resolveNode, &$itemsById): array {
            $node = $itemsById[$itemId] ?? [
                'isRider' => false,
                'productId' => '',
                'fullName' => '',
                'shortName' => '',
                'premiumTermOrIssueAge' => null,
                'type' => null,
                'fycRate' => 0,
                'gst' => 0,
                'quantitiesAndPremiums' => [],
                'riders' => [],
            ];

            $childIds = is_array($node['riders'] ?? null) ? $node['riders'] : [];
            $resolvedChildren = [];
            foreach ($childIds as $childId) {
                $resolvedChildren[] = $resolveNode((int) $childId);
            }
            $node['riders'] = $resolvedChildren;

            return $node;
        };

        $result = [];
        foreach ($rootsByClosing as $closingId => $rootIds) {
            $rootIds = array_map(
                static fn ($id) => (int) $id,
                is_array($rootIds) ? $rootIds : [],
            );
            $resolvedNodes = array_map($resolveNode, $rootIds);
            $result[$closingId] = $this->consolidateClosingItems($resolvedNodes);
        }

        return $result;
    }

    private function resolveUserByFscCode(string $fscCode): ?object
    {
        $trimmed = trim($fscCode);
        if ($trimmed === '') {
            return null;
        }

        return DB::table('users as u')
            ->leftJoin('agencies as a', 'a.id', '=', 'u.agency_id')
            ->where('u.fsc_code', $trimmed)
            ->first([
                'u.id',
                'u.fsc_code',
                'u.nickname',
                'u.full_name',
                'a.code as agency_code',
            ]);
    }

    private function canManageClosing(?int $actorId, string $accessLevel, object $closing): bool
    {
        if ($actorId === null) {
            return false;
        }

        $normalized = strtolower(trim($accessLevel));
        if (in_array($normalized, ['admin', 'editor'], true)) {
            return true;
        }

        return $actorId === (int) $closing->fsc_user_id
            || $actorId === (int) ($closing->shared_fsc_user_id ?? 0);
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

    private function exportMonthEntries(string $monthKey): array
    {
        [$start, $end] = $this->monthRange($monthKey);
        $rows = $this->baseClosingsQuery()
            ->where('c.submitted_at', '>=', $start)
            ->where('c.submitted_at', '<', $end)
            ->orderBy('c.submitted_at')
            ->orderBy('c.id')
            ->get();

        return $this->hydrateClosings($rows)
            ->map(static function (array $item): array {
                unset($item['id']);
                return $item;
            })
            ->values()
            ->all();
    }

    private function backupMonthData(string $monthKey, ?int $actorId): void
    {
        $data = json_encode($this->exportMonthEntries($monthKey), JSON_UNESCAPED_UNICODE);
        DB::table('closing_month_backups')->insert([
            'month_key' => $monthKey,
            'data' => $data === false ? '[]' : $data,
            'created_by' => $actorId,
            'expires_at' => now()->addDays(self::BACKUP_TTL_DAYS),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function normalizeImportedClosingPayload(array $entry, Carbon $monthStart, Carbon $monthEnd): ?array
    {
        $timestamp = $this->parseTimestamp($entry['timestamp'] ?? null);
        if ($timestamp->lt($monthStart) || $timestamp->gte($monthEnd)) {
            $timestamp = (clone $monthStart)->addHours(12);
        }

        $items = is_array($entry['items'] ?? null) ? $entry['items'] : [];
        if (count($items) === 0) {
            return null;
        }

        return [
            'timestamp' => $timestamp->toIso8601String(),
            'fscCode' => trim((string) ($entry['fscCode'] ?? '')),
            'sharedFscCode' => $this->nullableString($entry['sharedFscCode'] ?? null, 20),
            'isShared' => $this->nullableBool($entry['isShared'] ?? null),
            'sourceId' => trim((string) ($entry['sourceId'] ?? $entry['source'] ?? '')),
            'sourceItemId' => $entry['sourceItemId'] ?? ($entry['sourceDetail'] ?? null),
            'sourceComment' => $this->nullableString($entry['sourceComment'] ?? null, 65535),
            'referrals' => max(0, (int) ($entry['referrals'] ?? 0)),
            'referralsComment' => $this->nullableString($entry['referralsComment'] ?? null, 65535),
            'items' => $items,
        ];
    }

    private function resolveSourceItemIdForSource(string $sourceId, mixed $sourceItemId): ?int
    {
        if ($sourceItemId === null) {
            return null;
        }

        $raw = trim((string) $sourceItemId);
        if ($raw === '') {
            return null;
        }

        if (ctype_digit($raw)) {
            $itemId = (int) $raw;
            if ($itemId <= 0) {
                return null;
            }

            $exists = DB::table('source_items')
                ->where('id', $itemId)
                ->where('source_id', $sourceId)
                ->exists();
            if ($exists) {
                return $itemId;
            }
        } else {
            $itemId = DB::table('source_items')
                ->where('source_id', $sourceId)
                ->where('label', substr($raw, 0, 150))
                ->orderBy('is_deleted')
                ->orderBy('id')
                ->value('id');
            if ($itemId !== null) {
                return (int) $itemId;
            }
        }

        throw ValidationException::withMessages([
            'sourceItemId' => 'Invalid source item for selected source.',
        ]);
    }

    private function parseTimestamp(mixed $value): Carbon
    {
        if ($value instanceof Carbon) {
            return $value;
        }
        if ($value instanceof \DateTimeInterface) {
            return Carbon::instance(\DateTimeImmutable::createFromInterface($value));
        }
        try {
            return Carbon::parse((string) $value);
        } catch (\Throwable) {
            throw ValidationException::withMessages([
                'timestamp' => 'Invalid timestamp.',
            ]);
        }
    }

    private function parseClosingFilterStart(string $value): Carbon
    {
        if ($this->isDateOnlyFilter($value)) {
            return Carbon::createFromFormat('Y-m-d', $value, $this->closingFilterTimezone())
                ->startOfDay()
                ->utc();
        }

        return Carbon::parse($value);
    }

    private function parseClosingFilterEnd(string $value): Carbon
    {
        if ($this->isDateOnlyFilter($value)) {
            return Carbon::createFromFormat('Y-m-d', $value, $this->closingFilterTimezone())
                ->addDay()
                ->startOfDay()
                ->utc();
        }

        return Carbon::parse($value);
    }

    private function isDateOnlyFilter(string $value): bool
    {
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1;
    }

    private function closingFilterTimezone(): string
    {
        $configured = trim((string) config('app.closing_filter_timezone', ''));
        return $configured !== '' ? $configured : 'Asia/Singapore';
    }

    private function catalogRiderFlagsForPayloadItems(array $items): array
    {
        return $this->catalogRiderFlagsForProductIds($this->collectClosingProductIds($items));
    }

    private function collectClosingProductIds(array $items): array
    {
        $productIds = [];

        foreach (array_values($items) as $item) {
            if (!is_array($item)) {
                continue;
            }

            $productId = trim((string) ($item['productId'] ?? ''));
            if ($productId !== '') {
                $productIds[] = $productId;
            }

            $riders = is_array($item['riders'] ?? null) ? $item['riders'] : [];
            if (count($riders) > 0) {
                $productIds = array_merge($productIds, $this->collectClosingProductIds($riders));
            }
        }

        return array_values(array_unique($productIds));
    }

    private function catalogRiderFlagsForProductIds(array $productIds): array
    {
        $ids = array_values(array_filter(array_map(
            static fn ($id): string => trim((string) $id),
            $productIds
        )));

        if (count($ids) === 0) {
            return [];
        }

        /** @var array<string, mixed> $rows */
        $rows = DB::table('products')
            ->whereIn('id', $ids)
            ->pluck('is_rider', 'id')
            ->all();

        $flags = [];
        foreach ($rows as $id => $isRider) {
            $flags[(string) $id] = (bool) $isRider;
        }

        return $flags;
    }

    private function isLegacyStandaloneAddonName(mixed $value): bool
    {
        $text = strtolower(trim((string) ($value ?? '')));
        return str_starts_with($text, 'add on') || str_starts_with($text, 'add-on');
    }

    private function nullableString(mixed $value, int $maxLength): ?string
    {
        $text = trim((string) ($value ?? ''));
        if ($text === '') {
            return null;
        }
        return substr($text, 0, $maxLength);
    }

    private function nullableBool(mixed $value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value) || is_float($value)) {
            return (int) $value !== 0;
        }
        if (!is_string($value)) {
            return null;
        }

        $normalized = strtolower(trim($value));
        if ($normalized === '') {
            return null;
        }
        if (in_array($normalized, ['1', 'true', 'yes', 'on'], true)) {
            return true;
        }
        if (in_array($normalized, ['0', 'false', 'no', 'off'], true)) {
            return false;
        }

        return null;
    }

    private function toDecimal(mixed $value): float
    {
        $num = (float) $value;
        return is_finite($num) ? $num : 0.0;
    }

    private function toIsoOrNull(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse((string) $value)->toIso8601String();
        } catch (\Throwable) {
            return null;
        }
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

    private function displayName(string $nickname, string $fullName, string $fallbackCode): string
    {
        $picked = $this->firstNonEmpty([$nickname, $fullName, $fallbackCode]);
        return $picked ?? '';
    }
}
