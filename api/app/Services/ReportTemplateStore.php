<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class ReportTemplateStore
{
    private const REPORT_TITLE_MAX = 150;
    private const FILENAME_TEMPLATE_MAX = 255;
    private const TABLE_LINE_MAX = 120;
    private const VALUE_LABEL_MAX = 120;
    private const FOOTNOTE_MAX = 2000;
    private const INCLUDE_PRODUCT_KEYWORDS_MAX = 1000;
    private const EXCLUDE_PRODUCT_KEYWORDS_MAX = 1000;

    private const ALLOWED_VALUE_FORMATS = ['currency', 'count', 'number'];
    private const ALLOWED_ROOKIE_FILTERS = ['rookies', 'nonRookies', 'all'];
    private const ALLOWED_LAYOUT_MODES = ['separateLeaderboards', 'combinedFsc', 'agencySummary'];
    private const ALLOWED_METRIC_TYPES = [
        'fyc',
        'afyc',
        'fyp',
        'afyp',
        'referrals',
        'countCases',
        'countClosings',
    ];

    public function list(): array
    {
        $reportRows = DB::table('report_templates')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get([
                'id',
                'title',
                'filename_template',
                'table_gap',
                'table_width',
                'index_table_width',
                'primary_column_header',
                'primary_column_width',
                'include_index_table',
                'single_table',
                'layout_mode',
                'agency_breakdown',
                'agency_table_gap',
                'bottom_footnote',
            ]);

        $reportIds = $reportRows
            ->map(static fn ($row): int => (int) $row->id)
            ->all();

        $tablesByReportId = [];
        if ($reportIds !== []) {
            $tableRows = DB::table('report_template_tables')
                ->whereIn('report_template_id', $reportIds)
                ->orderBy('report_template_id')
                ->orderBy('position')
                ->orderBy('id')
                ->get([
                    'id',
                    'report_template_id',
                    'title_lines',
                    'value_label',
                    'value_format',
                    'min_value',
                    'highlight_min',
                    'show_index',
                    'include_footer_total_row',
                    'include_all_agencies',
                    'include_all_non_legacy_agencies',
                    'agency_codes',
                    'agency_breakdown',
                    'include_all_advisors',
                    'rookie_filter',
                    'rookie_years',
                    'source_ids',
                    'source_item_ids',
                    'product_type_ids',
                    'include_product_keywords',
                    'exclude_product_keywords',
                    'metric_type',
                    'metric_field',
                    'footnote',
                ]);

            $productTypeKeysById = [];
            $productTypeIds = [];
            foreach ($tableRows as $row) {
                foreach ($this->decodePositiveIdList($row->product_type_ids ?? null, 100) as $id) {
                    $productTypeIds[$id] = true;
                }
            }

            if ($productTypeIds !== []) {
                $productTypeKeysById = DB::table('product_type_definitions')
                    ->whereIn('id', array_keys($productTypeIds))
                    ->pluck('type_key', 'id')
                    ->mapWithKeys(
                        static fn ($typeKey, $id): array => [(int) $id => trim((string) $typeKey)]
                    )
                    ->all();
            }

            foreach ($tableRows as $row) {
                $reportId = (int) $row->report_template_id;
                if (!isset($tablesByReportId[$reportId])) {
                    $tablesByReportId[$reportId] = [];
                }
                $tablesByReportId[$reportId][] = $this->mapTableRow($row, $productTypeKeysById);
            }
        }

        return $reportRows
            ->map(function ($row) use ($tablesByReportId): array {
                $reportId = (int) ($row->id ?? 0);
                $report = [
                    'id' => $reportId,
                    'title' => (string) ($row->title ?? ''),
                    'filenameTemplate' => (string) ($row->filename_template ?? ''),
                    'tableGap' => (int) ($row->table_gap ?? 0),
                    'tableWidth' => (int) ($row->table_width ?? 0),
                    'indexTableWidth' => (int) ($row->index_table_width ?? 0),
                    'includeIndexTable' => (bool) ($row->include_index_table ?? false),
                    'tables' => $tablesByReportId[$reportId] ?? [],
                ];

                $layoutMode = $this->enumValue(
                    $row->layout_mode ?? null,
                    self::ALLOWED_LAYOUT_MODES,
                    ((bool) ($row->single_table ?? false)) ? 'combinedFsc' : 'separateLeaderboards'
                );
                if ($layoutMode !== 'separateLeaderboards') {
                    $report['layoutMode'] = $layoutMode;
                    $report['singleTable'] = $layoutMode === 'combinedFsc';
                } elseif ((bool) ($row->single_table ?? false)) {
                    $report['singleTable'] = true;
                }
                $primaryColumnHeader = trim((string) ($row->primary_column_header ?? ''));
                if ($primaryColumnHeader !== '') {
                    $report['primaryColumnHeader'] = $primaryColumnHeader;
                }
                $primaryColumnWidth = (int) ($row->primary_column_width ?? 120);
                if ($primaryColumnWidth !== 120) {
                    $report['primaryColumnWidth'] = $primaryColumnWidth;
                }
                if ((bool) ($row->agency_breakdown ?? false)) {
                    $report['agencyBreakdown'] = true;
                }
                $agencyTableGap = (int) ($row->agency_table_gap ?? 30);
                if ($agencyTableGap !== 30) {
                    $report['agencyTableGap'] = $agencyTableGap;
                }

                $bottomFootnote = trim((string) ($row->bottom_footnote ?? ''));
                if ($bottomFootnote !== '') {
                    $report['bottomFootnote'] = $bottomFootnote;
                }

                return $report;
            })
            ->values()
            ->all();
    }

    public function normalize(array $reports): array
    {
        $normalized = [];
        $seenReportKeys = [];
        $usedReportIds = [];
        $nextReportId = 1;
        $usedTableIds = [];
        $nextTableId = 1;

        foreach (array_values($reports) as $report) {
            if (!is_array($report)) {
                continue;
            }

            $rawId = trim((string) ($report['id'] ?? ''));
            if ($rawId === '' || isset($seenReportKeys[$rawId])) {
                continue;
            }
            $seenReportKeys[$rawId] = true;

            $id = $this->normalizePositiveId(
                $report['id'] ?? null,
                $usedReportIds,
                $nextReportId
            );

            $title = $this->stringValue($report['title'] ?? null, self::REPORT_TITLE_MAX);
            $filenameTemplate = $this->stringValue(
                $report['filenameTemplate'] ?? null,
                self::FILENAME_TEMPLATE_MAX
            );

            $layoutMode = $this->enumValue(
                $report['layoutMode'] ?? null,
                self::ALLOWED_LAYOUT_MODES,
                $this->boolValue($report['singleTable'] ?? null, false)
                    ? 'combinedFsc'
                    : 'separateLeaderboards'
            );
            $isSingleTable = $layoutMode === 'combinedFsc';

            $normalizedReport = [
                'id' => $id,
                'title' => $title !== '' ? $title : (string) $id,
                'filenameTemplate' => $filenameTemplate !== '' ? $filenameTemplate : (string) $id,
                'tableGap' => $this->intValue($report['tableGap'] ?? null, 15, 0, 500),
                'tableWidth' => $this->intValue($report['tableWidth'] ?? null, 170, 1, 1000),
                'indexTableWidth' => $this->intValue($report['indexTableWidth'] ?? null, 46, 0, 1000),
                'includeIndexTable' => $this->boolValue($report['includeIndexTable'] ?? null, true),
                'layoutMode' => $layoutMode,
                'agencyTableGap' => $this->intValue($report['agencyTableGap'] ?? null, 30, 0, 500),
                'tables' => $this->normalizeTables(
                    is_array($report['tables'] ?? null) ? $report['tables'] : [],
                    $usedTableIds,
                    $nextTableId,
                    $isSingleTable
                ),
            ];

            if ($layoutMode === 'combinedFsc') {
                $normalizedReport['singleTable'] = true;
            }
            $primaryColumnHeader = $this->stringValue($report['primaryColumnHeader'] ?? null, 80);
            if ($primaryColumnHeader !== '') {
                $normalizedReport['primaryColumnHeader'] = $primaryColumnHeader;
            }
            $primaryColumnWidth = $this->intValue($report['primaryColumnWidth'] ?? null, 120, 40, 1000);
            if ($primaryColumnWidth !== 120) {
                $normalizedReport['primaryColumnWidth'] = $primaryColumnWidth;
            }
            if ($this->boolValue($report['agencyBreakdown'] ?? null, false)) {
                $normalizedReport['agencyBreakdown'] = true;
            }

            $bottomFootnote = $this->nullableString($report['bottomFootnote'] ?? null, self::FOOTNOTE_MAX);
            if ($bottomFootnote !== null) {
                $normalizedReport['bottomFootnote'] = $bottomFootnote;
            }

            $normalized[] = $normalizedReport;
        }

        return $normalized;
    }

    public function replace(array $reports, ?int $actorId = null): array
    {
        $normalized = $this->normalize($reports);
        $now = now();
        $incomingIds = [];
        $productTypeIdByKey = $this->loadProductTypeIdByKey();

        foreach (array_values($normalized) as $reportIndex => $report) {
            $reportId = (int) $report['id'];
            $incomingIds[] = $reportId;

            DB::table('report_templates')->updateOrInsert(
                ['id' => $reportId],
                [
                    'id' => $reportId,
                    'title' => $report['title'],
                    'filename_template' => $report['filenameTemplate'],
                    'table_gap' => $report['tableGap'],
                    'table_width' => $report['tableWidth'],
                    'index_table_width' => $report['indexTableWidth'],
                    'primary_column_header' => $report['primaryColumnHeader'] ?? null,
                    'primary_column_width' => $report['primaryColumnWidth'] ?? 120,
                    'include_index_table' => $report['includeIndexTable'],
                    'single_table' => ($report['singleTable'] ?? false) === true,
                    'layout_mode' => $report['layoutMode'] ?? 'separateLeaderboards',
                    'agency_breakdown' => ($report['agencyBreakdown'] ?? false) === true,
                    'agency_table_gap' => $report['agencyTableGap'] ?? 30,
                    'bottom_footnote' => $report['bottomFootnote'] ?? null,
                    'position' => $reportIndex,
                    'is_deleted' => false,
                    'updated_by' => $actorId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]
            );

            DB::table('report_template_tables')
                ->where('report_template_id', $reportId)
                ->delete();

            $tableRows = [];
            foreach (array_values($report['tables']) as $tableIndex => $table) {
                $productTypeIds = $this->resolveProductTypeIds($table, $productTypeIdByKey);
                $tableRows[] = [
                    'id' => $table['id'],
                    'report_template_id' => $reportId,
                    'title_lines' => $this->encodeJson($table['titleLines']),
                    'value_label' => $table['valueLabel'],
                    'value_format' => $table['valueFormat'] ?? null,
                    'min_value' => array_key_exists('minValue', $table)
                        ? $this->decimalValue($table['minValue'])
                        : null,
                    'highlight_min' => $table['highlightMin'],
                    'show_index' => $table['showIndex'],
                    'include_footer_total_row' => ($table['includeFooterTotalRow'] ?? false) === true,
                    'include_all_agencies' => $table['includeAllAgencies'],
                    'include_all_non_legacy_agencies' => $table['includeAllNonLegacyAgencies'] ?? false,
                    'agency_codes' => $this->encodeJson($table['agencyCodes'] ?? []),
                    'agency_breakdown' => ($table['agencyBreakdown'] ?? false) === true,
                    'include_all_advisors' => $table['includeAllAdvisors'],
                    'rookie_filter' => $table['rookieFilter'],
                    'rookie_years' => $table['rookieYears'],
                    'source_ids' => $this->encodeJson($table['sources'] ?? []),
                    'source_item_ids' => $this->encodeJson($table['sourceItemIds'] ?? []),
                    'product_type_ids' => $this->encodeJson($productTypeIds),
                    'include_product_keywords' => $table['includeProductKeywords'] ?? null,
                    'exclude_product_keywords' => $table['excludeProductKeywords'] ?? null,
                    'metric_type' => $table['metric']['type'],
                    'metric_field' => $table['metric']['field'] ?? null,
                    'footnote' => $table['footnote'] ?? null,
                    'position' => $tableIndex,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }

            if ($tableRows !== []) {
                DB::table('report_template_tables')->insert($tableRows);
            }
        }

        $staleReportIds = DB::table('report_templates')
            ->where('is_deleted', false)
            ->when(
                $incomingIds !== [],
                static fn ($query) => $query->whereNotIn('id', $incomingIds)
            )
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();

        if ($staleReportIds !== []) {
            DB::table('report_template_tables')
                ->whereIn('report_template_id', $staleReportIds)
                ->delete();
        }

        $staleQuery = DB::table('report_templates')->where('is_deleted', false);
        if ($incomingIds !== []) {
            $staleQuery->whereNotIn('id', $incomingIds);
        }
        $staleQuery->update([
            'is_deleted' => true,
            'updated_at' => $now,
        ]);

        return $normalized;
    }

    private function normalizeTables(
        array $tables,
        array &$usedTableIds,
        int &$nextTableId,
        bool $singleTable = false
    ): array
    {
        $normalized = [];
        $seenTableKeys = [];

        foreach (array_values($tables) as $table) {
            if (!is_array($table)) {
                continue;
            }

            $rawId = trim((string) ($table['id'] ?? ''));
            if ($rawId === '' || isset($seenTableKeys[$rawId])) {
                continue;
            }
            $seenTableKeys[$rawId] = true;

            $id = $this->normalizePositiveId(
                $table['id'] ?? null,
                $usedTableIds,
                $nextTableId
            );

            $titleLines = $this->stringList($table['titleLines'] ?? null, self::TABLE_LINE_MAX, false, 5);
            if ($titleLines === []) {
                $titleLines = ['TABLE'];
            }

            $valueFormat = $this->enumValue(
                $table['valueFormat'] ?? null,
                self::ALLOWED_VALUE_FORMATS,
            );
            $agencyCodes = $this->uniqueList(
                $this->stringList($table['agencyCodes'] ?? null, 50, true, 100)
            );
            $sources = $this->uniqueList(
                $this->stringList($table['sources'] ?? null, 50, true, 50)
            );
            $sourceItemIds = $this->uniqueList(
                $this->stringList($table['sourceItemIds'] ?? null, 50, true, 500)
            );
            $productTypeKeys = $this->uniqueList(
                $this->stringList($table['productTypeKeys'] ?? null, 50, true, 100)
            );
            $productTypeIds = $this->positiveIdList($table['productTypeIds'] ?? null, 100);
            $includeProductKeywords = $this->nullableString(
                $table['includeProductKeywords'] ?? null,
                self::INCLUDE_PRODUCT_KEYWORDS_MAX
            );
            $excludeProductKeywords = $this->nullableString(
                $table['excludeProductKeywords'] ?? null,
                self::EXCLUDE_PRODUCT_KEYWORDS_MAX
            );

            $metric = $this->normalizeMetric(
                is_array($table['metric'] ?? null) ? $table['metric'] : []
            );

            $includeAllAgencies = $this->boolValue($table['includeAllAgencies'] ?? null, true);
            $includeAllNonLegacyAgencies = !$includeAllAgencies
                && $this->boolValue($table['includeAllNonLegacyAgencies'] ?? null, false);

            $normalizedTable = [
                'id' => $id,
                'titleLines' => $titleLines,
                'valueLabel' => $singleTable
                    ? $this->stringValue($table['valueLabel'] ?? null, self::VALUE_LABEL_MAX)
                    : $this->fallbackString($table['valueLabel'] ?? null, 'Value', self::VALUE_LABEL_MAX),
                'highlightMin' => $this->boolValue($table['highlightMin'] ?? null, false),
                'showIndex' => $this->boolValue($table['showIndex'] ?? null, false),
                'includeAllAgencies' => $includeAllAgencies,
                'includeAllAdvisors' => $this->boolValue($table['includeAllAdvisors'] ?? null, true),
                'rookieFilter' => $this->enumValue(
                    $table['rookieFilter'] ?? null,
                    self::ALLOWED_ROOKIE_FILTERS,
                    'all',
                ),
                'rookieYears' => $this->intValue($table['rookieYears'] ?? null, 2, 1, 20),
                'metric' => $metric,
            ];

            if ($valueFormat !== null) {
                $normalizedTable['valueFormat'] = $valueFormat;
            }

            if ($includeAllNonLegacyAgencies) {
                $normalizedTable['includeAllNonLegacyAgencies'] = true;
            }

            $minValue = $this->decimalValue($table['minValue'] ?? null);
            if ($minValue !== null) {
                $normalizedTable['minValue'] = $minValue;
            }

            if ($agencyCodes !== []) {
                $normalizedTable['agencyCodes'] = $agencyCodes;
            }

            if ($this->boolValue($table['agencyBreakdown'] ?? null, false)) {
                $normalizedTable['agencyBreakdown'] = true;
            }

            if ($sources !== []) {
                $normalizedTable['sources'] = $sources;
            }

            if ($sourceItemIds !== []) {
                $normalizedTable['sourceItemIds'] = $sourceItemIds;
            }

            if ($productTypeKeys !== []) {
                $normalizedTable['productTypeKeys'] = $productTypeKeys;
            }

            if ($productTypeIds !== []) {
                $normalizedTable['productTypeIds'] = $productTypeIds;
            }

            if ($includeProductKeywords !== null) {
                $normalizedTable['includeProductKeywords'] = $includeProductKeywords;
            }

            if ($excludeProductKeywords !== null) {
                $normalizedTable['excludeProductKeywords'] = $excludeProductKeywords;
            }

            if ($this->boolValue($table['includeFooterTotalRow'] ?? null, false)) {
                $normalizedTable['includeFooterTotalRow'] = true;
            }

            $footnote = $this->nullableString($table['footnote'] ?? null, self::FOOTNOTE_MAX);
            if ($footnote !== null) {
                $normalizedTable['footnote'] = $footnote;
            }

            $normalized[] = $normalizedTable;
        }

        return $normalized;
    }

    private function normalizeMetric(array $metric): array
    {
        $type = $this->enumValue(
            $metric['type'] ?? null,
            self::ALLOWED_METRIC_TYPES,
            'countClosings',
        );

        return ['type' => $type];
    }

    private function mapTableRow(object $row, array $productTypeKeysById = []): array
    {
        $table = [
            'id' => (int) ($row->id ?? 0),
            'titleLines' => $this->decodeStringList($row->title_lines ?? null, self::TABLE_LINE_MAX, false, 5),
            'valueLabel' => (string) ($row->value_label ?? ''),
            'highlightMin' => (bool) ($row->highlight_min ?? false),
            'showIndex' => (bool) ($row->show_index ?? false),
            'includeAllAgencies' => (bool) ($row->include_all_agencies ?? true),
            'includeAllAdvisors' => (bool) ($row->include_all_advisors ?? true),
            'rookieFilter' => $this->enumValue(
                $row->rookie_filter ?? null,
                self::ALLOWED_ROOKIE_FILTERS,
                'all',
            ),
            'rookieYears' => $this->intValue($row->rookie_years ?? null, 2, 1, 20),
            'metric' => $this->normalizeMetric([
                'type' => $row->metric_type ?? null,
                'field' => $row->metric_field ?? null,
            ]),
        ];

        if ($table['titleLines'] === []) {
            $table['titleLines'] = ['TABLE'];
        }

        if ((bool) ($row->include_footer_total_row ?? false)) {
            $table['includeFooterTotalRow'] = true;
        }

        if ((bool) ($row->include_all_non_legacy_agencies ?? false)) {
            $table['includeAllNonLegacyAgencies'] = true;
        }

        $valueFormat = $this->enumValue(
            $row->value_format ?? null,
            self::ALLOWED_VALUE_FORMATS,
        );
        if ($valueFormat !== null) {
            $table['valueFormat'] = $valueFormat;
        }

        $minValue = $this->decimalValue($row->min_value ?? null);
        if ($minValue !== null) {
            $table['minValue'] = $minValue;
        }

        $agencyCodes = $this->decodeStringList($row->agency_codes ?? null, 50, true, 100);
        if ($agencyCodes !== []) {
            $table['agencyCodes'] = $agencyCodes;
        }

        if ((bool) ($row->agency_breakdown ?? false)) {
            $table['agencyBreakdown'] = true;
        }

        $sources = $this->decodeStringList($row->source_ids ?? null, 50, true, 50);
        if ($sources !== []) {
            $table['sources'] = $sources;
        }

        $sourceItemIds = $this->decodeStringList($row->source_item_ids ?? null, 50, true, 500);
        if ($sourceItemIds !== []) {
            $table['sourceItemIds'] = $sourceItemIds;
        }

        $productTypeKeys = [];
        foreach ($this->decodePositiveIdList($row->product_type_ids ?? null, 100) as $productTypeId) {
            $typeKey = trim((string) ($productTypeKeysById[$productTypeId] ?? ''));
            if ($typeKey === '') {
                continue;
            }
            $productTypeKeys[] = $typeKey;
        }
        $productTypeKeys = $this->uniqueList($productTypeKeys);
        if ($productTypeKeys !== []) {
            $table['productTypeKeys'] = $productTypeKeys;
        }

        $includeProductKeywords = $this->nullableString(
            $row->include_product_keywords ?? null,
            self::INCLUDE_PRODUCT_KEYWORDS_MAX
        );
        if ($includeProductKeywords !== null) {
            $table['includeProductKeywords'] = $includeProductKeywords;
        }

        $excludeProductKeywords = $this->nullableString(
            $row->exclude_product_keywords ?? null,
            self::EXCLUDE_PRODUCT_KEYWORDS_MAX
        );
        if ($excludeProductKeywords !== null) {
            $table['excludeProductKeywords'] = $excludeProductKeywords;
        }

        $footnote = $this->nullableString($row->footnote ?? null, self::FOOTNOTE_MAX);
        if ($footnote !== null) {
            $table['footnote'] = $footnote;
        }

        return $table;
    }

    private function encodeJson(array $value): string
    {
        return json_encode(array_values($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]';
    }

    private function loadProductTypeIdByKey(): array
    {
        return DB::table('product_type_definitions')
            ->pluck('id', 'type_key')
            ->mapWithKeys(
                static fn ($id, $typeKey): array => [trim((string) $typeKey) => (int) $id]
            )
            ->all();
    }

    private function resolveProductTypeIds(array $table, array $productTypeIdByKey): array
    {
        $explicitIds = $this->positiveIdList($table['productTypeIds'] ?? null, 100);
        if ($explicitIds !== []) {
            return $explicitIds;
        }

        $resolvedIds = [];
        foreach ($this->stringList($table['productTypeKeys'] ?? null, 50, true, 100) as $typeKey) {
            $id = $productTypeIdByKey[$typeKey] ?? null;
            if ($id === null || isset($resolvedIds[$id])) {
                continue;
            }
            $resolvedIds[$id] = true;
        }

        return array_keys($resolvedIds);
    }

    private function normalizePositiveId(
        mixed $value,
        array &$usedIds,
        int &$nextId
    ): int {
        $candidate = $this->intIdValue($value);
        if ($candidate !== null && !isset($usedIds[$candidate])) {
            $usedIds[$candidate] = true;
            if ($candidate >= $nextId) {
                $nextId = $candidate + 1;
            }

            return $candidate;
        }

        while (isset($usedIds[$nextId])) {
            $nextId++;
        }

        $assigned = $nextId;
        $usedIds[$assigned] = true;
        $nextId++;

        return $assigned;
    }

    private function intIdValue(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value > 0 ? $value : null;
        }

        if (is_float($value)) {
            if ($value <= 0 || floor($value) !== $value) {
                return null;
            }

            return (int) $value;
        }

        $candidate = trim((string) $value);
        if ($candidate === '' || preg_match('/^\d+$/', $candidate) !== 1) {
            return null;
        }

        $parsed = (int) $candidate;
        return $parsed > 0 ? $parsed : null;
    }

    private function stringValue(mixed $value, int $maxLength): string
    {
        return substr(trim((string) $value), 0, $maxLength);
    }

    private function fallbackString(mixed $value, string $default, int $maxLength): string
    {
        $text = $this->stringValue($value, $maxLength);
        return $text !== '' ? $text : $default;
    }

    private function nullableString(mixed $value, int $maxLength): ?string
    {
        $text = $this->stringValue($value, $maxLength);
        return $text !== '' ? $text : null;
    }

    private function intValue(mixed $value, int $default, int $min, int $max): int
    {
        if (!is_numeric($value)) {
            return $default;
        }

        $normalized = (int) round((float) $value);
        if ($normalized < $min) {
            return $min;
        }
        if ($normalized > $max) {
            return $max;
        }

        return $normalized;
    }

    private function decimalValue(mixed $value): ?float
    {
        if (!is_numeric($value)) {
            return null;
        }

        return (float) $value;
    }

    private function boolValue(mixed $value, bool $default): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_numeric($value)) {
            return (float) $value !== 0.0;
        }

        if (is_string($value)) {
            $normalized = strtolower(trim($value));
            if (in_array($normalized, ['1', 'true', 'yes', 'on'], true)) {
                return true;
            }
            if (in_array($normalized, ['0', 'false', 'no', 'off'], true)) {
                return false;
            }
        }

        return $default;
    }

    private function enumValue(mixed $value, array $allowed, ?string $default = null): ?string
    {
        $candidate = trim((string) $value);
        return in_array($candidate, $allowed, true) ? $candidate : $default;
    }

    private function stringList(
        mixed $value,
        int $maxLength,
        bool $filterEmpty,
        int $maxItems
    ): array {
        if (!is_array($value)) {
            return [];
        }

        $items = [];
        foreach (array_values($value) as $entry) {
            if (count($items) >= $maxItems) {
                break;
            }

            $text = substr(trim((string) $entry), 0, $maxLength);
            if ($filterEmpty && $text === '') {
                continue;
            }

            $items[] = $text;
        }

        return $items;
    }

    private function decodeStringList(
        mixed $value,
        int $maxLength,
        bool $filterEmpty,
        int $maxItems
    ): array {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (is_array($decoded)) {
                return $this->stringList($decoded, $maxLength, $filterEmpty, $maxItems);
            }
        }

        if (is_array($value)) {
            return $this->stringList($value, $maxLength, $filterEmpty, $maxItems);
        }

        return [];
    }

    private function positiveIdList(mixed $value, int $maxItems): array
    {
        if (!is_array($value)) {
            return [];
        }

        $ids = [];
        $seen = [];

        foreach (array_values($value) as $entry) {
            if (count($ids) >= $maxItems) {
                break;
            }

            $id = $this->intIdValue($entry);
            if ($id === null || isset($seen[$id])) {
                continue;
            }

            $seen[$id] = true;
            $ids[] = $id;
        }

        return $ids;
    }

    private function decodePositiveIdList(mixed $value, int $maxItems): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (is_array($decoded)) {
                return $this->positiveIdList($decoded, $maxItems);
            }
        }

        if (is_array($value)) {
            return $this->positiveIdList($value, $maxItems);
        }

        return [];
    }

    private function uniqueList(array $items): array
    {
        $unique = [];
        $seen = [];

        foreach ($items as $item) {
            if (isset($seen[$item])) {
                continue;
            }

            $seen[$item] = true;
            $unique[] = $item;
        }

        return $unique;
    }
}
