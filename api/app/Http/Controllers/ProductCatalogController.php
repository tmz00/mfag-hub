<?php

namespace App\Http\Controllers;

use App\Services\AdminUndoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProductCatalogController extends Controller
{
    private const FREQUENCY_SINGLE = 1;
    private const FREQUENCY_MONTHLY_1 = 2;
    private const FREQUENCY_MONTHLY_2 = 4;
    private const FREQUENCY_QUARTERLY = 8;
    private const FREQUENCY_SEMI_ANNUAL = 16;
    private const FREQUENCY_ANNUAL = 32;

    public function show(): JsonResponse
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

        $catalog = [
            'gst' => $setting?->gst !== null ? (float) $setting->gst : null,
            'types' => $types->mapWithKeys(static fn ($row): array => [
                (string) $row->type_key => (string) $row->label,
            ]),
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
                    ]),
                    'fycRate' => (string) ($row->fyc_rate ?? ''),
                    'frequencies' => $this->frequenciesFromMask($row->frequency_mask ?? 0),
                    'gst' => (string) ($row->gst ?? ''),
                    'attachableRiders' => $attachables
                        ->where('base_product_id', $id)
                        ->values()
                        ->map(static fn ($item): string => (string) $item->rider_id),
                ];
            }),
            'riders' => $riders->map(function ($row) use ($options): array {
                $id = (string) $row->id;
                return [
                    'id' => $id,
                    'category' => (string) ($row->category ?? ''),
                    'fullName' => (string) ($row->full_name ?? ''),
                    'shortName' => (string) ($row->short_name ?? ''),
                    'attachedSuffix' => (string) ($row->attached_suffix ?? ''),
                    'type' => (string) ($row->type_key ?? ''),
                    'notes' => (string) ($row->notes ?? ''),
                    'optionTitle' => (string) ($row->option_title ?? ''),
                    'options' => $options->where('product_id', $id)->values()->map(static fn ($item): array => [
                        'label' => (string) $item->label,
                        'fycRate' => (string) ($item->fyc_rate ?? ''),
                    ]),
                    'fycRate' => (string) ($row->fyc_rate ?? ''),
                    'frequencies' => $this->frequenciesFromMask($row->frequency_mask ?? 0),
                    'gst' => (string) ($row->gst ?? ''),
                ];
            }),
            'updatedBy' => null,
            'updatedAt' => $setting?->updated_at,
        ];

        return response()->json($catalog);
    }

    public function update(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'gst' => ['nullable', 'numeric'],
            'types' => ['nullable', 'array'],
            'basePlans' => ['nullable', 'array'],
            'riders' => ['nullable', 'array'],
            'snapshotTitle' => ['nullable', 'string', 'max:255'],
        ]);

        $types = is_array($payload['types'] ?? null) ? $payload['types'] : [];
        $basePlans = is_array($payload['basePlans'] ?? null) ? $payload['basePlans'] : [];
        $riders = is_array($payload['riders'] ?? null) ? $payload['riders'] : [];
        $actorId = $request->user()?->id;
        $now = now();
        $snapshotSummary = $this->resolveProductsSnapshotSummary($payload);

        DB::transaction(function () use ($payload, $types, $riders, $basePlans, $actorId, $now, $snapshotSummary): void {
            app(AdminUndoService::class)->recordProductsSnapshot($actorId, $snapshotSummary);

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
                    'attached_suffix' => $this->nullableString($rider['attachedSuffix'] ?? null, 120),
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
                    'gst' => isset($payload['gst']) ? (float) $payload['gst'] : null,
                    'updated_by' => $actorId,
                    'updated_at' => $now,
                    'created_at' => $now,
                ]
            );
        });

        return response()->json(['saved' => true]);
    }

    private function resolveProductsSnapshotSummary(array $payload): string
    {
        $customTitle = trim((string) ($payload['snapshotTitle'] ?? ''));
        if ($customTitle !== '') {
            return mb_substr($customTitle, 0, 255, 'UTF-8');
        }

        return $this->buildProductsSnapshotSummary($payload);
    }

    private function buildProductsSnapshotSummary(array $payload): string
    {
        $beforeProducts = DB::table('products')
            ->where('is_deleted', false)
            ->orderBy('is_rider')
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'short_name', 'full_name']);
        $beforeById = [];
        foreach ($beforeProducts as $row) {
            $id = trim((string) ($row->id ?? ''));
            if ($id === '') {
                continue;
            }
            $beforeById[$id] = [
                'id' => $id,
                'shortName' => trim((string) ($row->short_name ?? '')),
                'fullName' => trim((string) ($row->full_name ?? '')),
            ];
        }

        $incomingProducts = [];
        foreach (array_values(is_array($payload['basePlans'] ?? null) ? $payload['basePlans'] : []) as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $id = trim((string) ($entry['id'] ?? ''));
            if ($id === '') {
                continue;
            }
            $incomingProducts[$id] = [
                'id' => $id,
                'shortName' => trim((string) ($entry['shortName'] ?? '')),
                'fullName' => trim((string) ($entry['fullName'] ?? '')),
            ];
        }
        foreach (array_values(is_array($payload['riders'] ?? null) ? $payload['riders'] : []) as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $id = trim((string) ($entry['id'] ?? ''));
            if ($id === '') {
                continue;
            }
            $incomingProducts[$id] = [
                'id' => $id,
                'shortName' => trim((string) ($entry['shortName'] ?? '')),
                'fullName' => trim((string) ($entry['fullName'] ?? '')),
            ];
        }

        $addedProductIds = array_values(array_diff(array_keys($incomingProducts), array_keys($beforeById)));
        if (count($addedProductIds) === 1) {
            $product = $incomingProducts[$addedProductIds[0]] ?? null;
            if (is_array($product)) {
                return $this->isIncomingRider($payload, (string) $product['id'])
                    ? 'Add Rider / Top-up'
                    : 'Add Base Plan';
            }
        }

        $deletedProductIds = array_values(array_diff(array_keys($beforeById), array_keys($incomingProducts)));
        if (count($deletedProductIds) === 1) {
            $product = $beforeById[$deletedProductIds[0]] ?? null;
            if (is_array($product)) {
                return 'Edit Plan / Rider / Top-up';
            }
        }

        $beforeTypes = DB::table('product_type_definitions')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['type_key', 'label'])
            ->mapWithKeys(static fn ($row): array => [
                trim((string) ($row->type_key ?? '')) => trim((string) ($row->label ?? '')),
            ])
            ->filter(static fn ($label, $key): bool => $key !== '')
            ->all();
        $incomingTypes = [];
        foreach ((array) ($payload['types'] ?? []) as $typeKey => $label) {
            $normalizedKey = trim((string) $typeKey);
            $normalizedLabel = trim((string) $label);
            if ($normalizedKey === '' || $normalizedLabel === '') {
                continue;
            }
            $incomingTypes[$normalizedKey] = $normalizedLabel;
        }

        $addedTypeKeys = array_values(array_diff(array_keys($incomingTypes), array_keys($beforeTypes)));
        if (count($addedTypeKeys) === 1) {
            return 'Edit GST / Type Definitions';
        }

        $deletedTypeKeys = array_values(array_diff(array_keys($beforeTypes), array_keys($incomingTypes)));
        if (count($deletedTypeKeys) === 1) {
            return 'Edit GST / Type Definitions';
        }

        foreach ($incomingTypes as $typeKey => $label) {
            if (($beforeTypes[$typeKey] ?? null) !== $label) {
                return 'Edit GST / Type Definitions';
            }
        }

        $beforeGst = DB::table('product_settings')->where('id', 1)->value('gst');
        $incomingHasGst = array_key_exists('gst', $payload);
        $incomingGst = $incomingHasGst && $payload['gst'] !== null
            ? trim((string) $payload['gst'])
            : null;
        $beforeGstText = $beforeGst !== null ? trim((string) $beforeGst) : null;
        if (
            $incomingHasGst
            && $incomingGst !== $beforeGstText
            && $addedProductIds === []
            && $deletedProductIds === []
        ) {
            return 'Edit GST / Type Definitions';
        }

        if ($addedProductIds === [] && $deletedProductIds === []) {
            $beforeOrder = array_keys($beforeById);
            $incomingOrder = array_keys($incomingProducts);
            if ($beforeOrder !== $incomingOrder) {
                return 'Reorder Categories / Products';
            }
        }

        return 'Edit Plan / Rider / Top-up';
    }

    private function isIncomingRider(array $payload, string $productId): bool
    {
        foreach (array_values(is_array($payload['riders'] ?? null) ? $payload['riders'] : []) as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            if (trim((string) ($entry['id'] ?? '')) === $productId) {
                return true;
            }
        }

        return false;
    }

    private function nullableString(mixed $value, int $maxLength): ?string
    {
        $text = trim((string) ($value ?? ''));
        if ($text === '') {
            return null;
        }
        return mb_substr($text, 0, $maxLength, 'UTF-8');
    }

    private function frequenciesFromMask(mixed $rawMask): array
    {
        $mask = is_numeric($rawMask) ? (int) $rawMask : 0;
        $ordered = [
            self::FREQUENCY_SINGLE => 'Single',
            self::FREQUENCY_MONTHLY_1 => 'Mthly-1',
            self::FREQUENCY_MONTHLY_2 => 'Mthly-2',
            self::FREQUENCY_QUARTERLY => 'Quarterly',
            self::FREQUENCY_SEMI_ANNUAL => 'Semi-Annual',
            self::FREQUENCY_ANNUAL => 'Annual',
        ];

        $frequencies = [];
        foreach ($ordered as $bit => $label) {
            if (($mask & $bit) === $bit) {
                $frequencies[] = $label;
            }
        }

        return $frequencies;
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

}
