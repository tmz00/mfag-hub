<?php

namespace App\Services\Reports;

use Carbon\CarbonImmutable;
use GdImage;
use InvalidArgumentException;
use RuntimeException;

class ReportPdfGenerator
{
    private const DEFAULT_SCALE = 4;
    private const FONT_SIZE_FACTOR = 0.73;
    private const HEADER_ROW_FONT_WEIGHT = 900;
    private const MIN_PAGE_ASPECT_RATIO = 0.8;
    private const MAX_PAGE_ASPECT_RATIO = 1.8;
    private const MAX_TABLES = 200;
    private const MAX_ROWS_PER_TABLE = 500;
    private const MAX_ROW_NAME_LENGTH = 80;
    private const MAX_VALUE_LABEL_LENGTH = 80;
    private const MAX_FOOTNOTE_LENGTH = 2000;
    private const MAX_TITLE_LENGTH = 200;
    private const MAX_RANGE_LABEL_LENGTH = 120;
    private const MAX_FILENAME_LENGTH = 255;

    private const COLOR_WHITE = '#ffffff';
    private const COLOR_BLACK = '#000000';
    private const COLOR_TEXT = '#0f172a';
    private const COLOR_MUTED = '#475569';
    private const COLOR_FOOTNOTE = '#1f2937';
    private const COLOR_PRIMARY = '#006a6b';
    private const COLOR_SECONDARY = '#32b3a3';
    private const COLOR_HIT = '#e3efef';

    private int $scale = self::DEFAULT_SCALE;
    private ?GdImage $image = null;
    private array $colors = [];

    /**
     * @var array<string, string>
     */
    private array $fontPaths;

    public function __construct(
        private readonly PngPdfDocument $pngPdfDocument
    ) {
        $fontRoot = resource_path('fonts/reports');
        $this->fontPaths = [
            'regular' => $fontRoot . '/Barlow-Regular.ttf',
            'italic' => $fontRoot . '/Barlow-Italic.ttf',
            'medium' => $fontRoot . '/Barlow-Medium.ttf',
            'mediumItalic' => $fontRoot . '/Barlow-MediumItalic.ttf',
            'semibold' => $fontRoot . '/Barlow-SemiBold.ttf',
            'semiboldItalic' => $fontRoot . '/Barlow-SemiBoldItalic.ttf',
            'bold' => $fontRoot . '/Barlow-Bold.ttf',
            'boldItalic' => $fontRoot . '/Barlow-BoldItalic.ttf',
        ];
    }

    private function normalizeLayoutMode(array $rawReport): string
    {
        $candidate = trim((string) ($rawReport['layoutMode'] ?? $rawReport['layout_mode'] ?? ''));
        if (in_array($candidate, ['separateLeaderboards', 'combinedFsc', 'agencySummary'], true)) {
            return $candidate;
        }

        return ((bool) ($rawReport['singleTable'] ?? false)) ? 'combinedFsc' : 'separateLeaderboards';
    }

    private function primaryRowHeaderLabel(array $report): string
    {
        $custom = trim((string) ($report['primaryColumnHeader'] ?? ''));
        if ($custom !== '') {
            return $custom;
        }

        return ($report['layoutMode'] ?? '') === 'agencySummary' ? 'Agency' : 'Name';
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{content: string, filename: string}
     */
    public function generate(array $payload, ?string $logoPath = null): array
    {
        $this->assertFontsExist();
        $context = $this->normalizePayload($payload);

        [$pageWidth, $pageHeight, $tableTopY, $tableBlockHeight, $bottomPadding, $effectiveBottomTopPadding, $footnotesById] =
            $this->calculateLayout($context, $logoPath);

        $this->createCanvas($pageWidth, $pageHeight);
        $logo = $this->loadLogo($logoPath);
        $logoBottom = $this->drawHeader(
            $context['report']['title'],
            $context['reportRangeLabel'],
            $logo,
            $pageWidth,
            $pageHeight
        );
        if ($logo !== null) {
            imagedestroy($logo);
        }

        // Match the same vertical placement logic used during layout calculations.
        $computedTableTopY = max(40 + 150, $logoBottom + 70);
        if ($computedTableTopY !== $tableTopY) {
            $tableTopY = $computedTableTopY;
        }

        $this->drawTables(
            $context,
            $pageWidth,
            $tableTopY,
            $tableBlockHeight,
            $footnotesById,
            $effectiveBottomTopPadding,
            $bottomPadding
        );

        $pngData = $this->encodePng();
        $pdfData = $this->pngPdfDocument->buildFromPng($pngData, $pageWidth, $pageHeight);

        $this->destroyCanvas();

        return [
            'content' => $pdfData,
            'filename' => $context['filename'],
        ];
    }

    private function assertFontsExist(): void
    {
        foreach ($this->fontPaths as $path) {
            if (!is_file($path)) {
                throw new RuntimeException('Missing required report font file: ' . $path);
            }
        }
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{
     *   filename: string,
     *   reportDate: CarbonImmutable,
     *   reportRangeLabel: string,
     *   maxRows: int,
     *   report: array{
     *     title: string,
     *     tableGap: int,
     *     tableWidth: int,
     *     indexTableWidth: int,
     *     includeIndexTable: bool,
     *     singleTable: bool,
     *     bottomFootnote: string
     *   },
     *   tables: array<int, array{
     *     id: string,
     *     titleLines: array<int, string>,
     *     valueLabel: string,
     *     valueFormat: string,
     *     minValue: float,
     *     highlightMin: bool,
     *     showIndex: bool,
     *     indexOnly: bool,
     *     includeFooterTotalRow: bool,
     *     rookieFilter: string,
     *     includeAllAdvisors: bool,
     *     footnote: string,
     *     rookieYears: int,
     *     metricType: string,
     *     rows: array<int, array{key: string, name: string, value: float}>
     *   }>
     * }
     */
    private function normalizePayload(array $payload): array
    {
        $rawReport = is_array($payload['report'] ?? null) ? $payload['report'] : [];
        $rawTables = is_array($payload['tables'] ?? null) ? $payload['tables'] : [];
        if ($rawTables === []) {
            throw new InvalidArgumentException('At least one report table is required.');
        }

        if (count($rawTables) > self::MAX_TABLES) {
            throw new InvalidArgumentException('Too many report tables in a single request.');
        }

        $reportDate = $this->parseDate((string) ($payload['reportDate'] ?? 'now'));
        $rangeLabel = $this->truncateString(
            trim((string) ($payload['reportRangeLabel'] ?? '')),
            self::MAX_RANGE_LABEL_LENGTH
        );
        if ($rangeLabel === '') {
            $rangeLabel = $reportDate->format('d M Y');
        }

        $reportTitle = $this->truncateString(
            trim((string) ($rawReport['title'] ?? 'Report')),
            self::MAX_TITLE_LENGTH
        );
        if ($reportTitle === '') {
            $reportTitle = 'Report';
        }

        $report = [
            'title' => $reportTitle,
            'tableGap' => $this->clampInt($rawReport['tableGap'] ?? 15, 0, 80),
            'tableWidth' => $this->clampInt($rawReport['tableWidth'] ?? 170, 60, 500),
            'indexTableWidth' => $this->clampInt($rawReport['indexTableWidth'] ?? 46, 0, 200),
            'primaryColumnHeader' => $this->truncateString(
                trim((string) ($rawReport['primaryColumnHeader'] ?? '')),
                80
            ),
            'primaryColumnWidth' => $this->clampInt($rawReport['primaryColumnWidth'] ?? 120, 40, 500),
            'includeIndexTable' => (bool) ($rawReport['includeIndexTable'] ?? true),
            'layoutMode' => $this->normalizeLayoutMode($rawReport),
            'singleTable' => (bool) ($rawReport['singleTable'] ?? false)
                || $this->normalizeLayoutMode($rawReport) === 'combinedFsc',
            'agencyTableGap' => $this->clampInt($rawReport['agencyTableGap'] ?? 30, 0, 500),
            'bottomFootnote' => $this->truncateString(
                trim((string) ($rawReport['bottomFootnote'] ?? '')),
                self::MAX_FOOTNOTE_LENGTH
            ),
        ];

        $tables = [];
        $computedMaxRows = 1;
        foreach (array_values($rawTables) as $index => $rawTable) {
            if (!is_array($rawTable)) {
                continue;
            }
            $normalized = $this->normalizeTable($rawTable, $index);
            $computedMaxRows = max($computedMaxRows, count($normalized['rows']));
            $tables[] = $normalized;
        }

        if ($tables === []) {
            throw new InvalidArgumentException('No valid report tables were provided.');
        }

        $payloadMaxRows = $this->clampInt($payload['maxRows'] ?? 1, 1, self::MAX_ROWS_PER_TABLE);
        $maxRows = min(self::MAX_ROWS_PER_TABLE, max($payloadMaxRows, $computedMaxRows));

        $filenameInput = $this->truncateString(
            trim((string) ($payload['filename'] ?? '')),
            self::MAX_FILENAME_LENGTH
        );
        if ($filenameInput === '') {
            $template = trim((string) ($rawReport['filenameTemplate'] ?? 'report'));
            $filenameInput = $this->applyTemplate($template !== '' ? $template : 'report', $reportDate);
        }
        $filename = $this->sanitizeFilename($filenameInput);

        return [
            'filename' => $filename,
            'reportDate' => $reportDate,
            'reportRangeLabel' => $rangeLabel,
            'maxRows' => $maxRows,
            'report' => $report,
            'tables' => $tables,
        ];
    }

    /**
     * @param array<string, mixed> $rawTable
     * @return array{
     *   id: string,
     *   titleLines: array<int, string>,
     *   valueLabel: string,
     *   valueFormat: string,
     *   minValue: float,
     *   highlightMin: bool,
     *   showIndex: bool,
     *   indexOnly: bool,
     *   includeFooterTotalRow: bool,
     *   rookieFilter: string,
     *   includeAllAdvisors: bool,
     *   footnote: string,
     *   rookieYears: int,
     *   metricType: string,
     *   rows: array<int, array{key: string, name: string, value: float}>
     * }
     */
    private function normalizeTable(array $rawTable, int $index): array
    {
        $titleLines = is_array($rawTable['titleLines'] ?? null)
            ? array_slice(array_map(
                fn($line) => $this->truncateString((string) $line, 120),
                array_values($rawTable['titleLines'])
            ), 0, 3)
            : [];

        $rows = [];
        $rawRows = is_array($rawTable['rows'] ?? null) ? $rawTable['rows'] : [];
        $maxRows = min(self::MAX_ROWS_PER_TABLE, count($rawRows));
        for ($i = 0; $i < $maxRows; $i++) {
            $rawRow = $rawRows[$i] ?? null;
            if (!is_array($rawRow)) {
                continue;
            }

            $name = $this->truncateString(trim((string) ($rawRow['name'] ?? '')), self::MAX_ROW_NAME_LENGTH);
            $key = $this->truncateString(trim((string) ($rawRow['key'] ?? $name)), self::MAX_ROW_NAME_LENGTH);
            $value = $this->toFloat($rawRow['value'] ?? 0);
            if (!is_finite($value)) {
                $value = 0;
            }

            $rows[] = [
                'key' => $key,
                'name' => $name,
                'value' => $value,
            ];
        }

        $metric = is_array($rawTable['metric'] ?? null) ? $rawTable['metric'] : [];
        $metricType = trim((string) ($metric['type'] ?? 'countClosings'));
        if ($metricType === '') {
            $metricType = 'countClosings';
        }

        return [
            'id' => trim((string) ($rawTable['id'] ?? ('table-' . $index))),
            'titleLines' => $titleLines,
            'valueLabel' => $this->truncateString(
                trim((string) ($rawTable['valueLabel'] ?? 'Value')),
                self::MAX_VALUE_LABEL_LENGTH
            ),
            'valueFormat' => trim((string) ($rawTable['valueFormat'] ?? 'count')),
            'minValue' => $this->toFloat($rawTable['minValue'] ?? 0),
            'highlightMin' => (bool) ($rawTable['highlightMin'] ?? false),
            'showIndex' => (bool) ($rawTable['showIndex'] ?? false),
            'indexOnly' => (bool) ($rawTable['indexOnly'] ?? false),
            'includeFooterTotalRow' => (bool) ($rawTable['includeFooterTotalRow'] ?? false),
            'rookieFilter' => trim((string) ($rawTable['rookieFilter'] ?? 'all')),
            'includeAllAdvisors' => (bool) ($rawTable['includeAllAdvisors'] ?? true),
            'footnote' => $this->truncateString(
                trim((string) ($rawTable['footnote'] ?? '')),
                self::MAX_FOOTNOTE_LENGTH
            ),
            'rookieYears' => $this->clampInt($rawTable['rookieYears'] ?? 2, 1, 10),
            'metricType' => $metricType,
            'agencyGroupLabel' => $this->truncateString(
                trim((string) ($rawTable['agencyGroupLabel'] ?? '')),
                self::MAX_VALUE_LABEL_LENGTH
            ),
            'rows' => $rows,
        ];
    }

    /**
     * @param array{
     *   report: array{title: string, tableGap: int, tableWidth: int, indexTableWidth: int, includeIndexTable: bool, singleTable: bool, bottomFootnote: string},
     *   tables: array<int, array{
     *     id: string,
     *     titleLines: array<int, string>,
     *     valueLabel: string,
     *     minValue: float,
     *     highlightMin: bool,
     *     showIndex: bool,
     *     indexOnly: bool,
     *     includeFooterTotalRow: bool,
     *     rookieFilter: string,
     *     includeAllAdvisors: bool,
     *     footnote: string,
     *     rookieYears: int,
     *     rows: array<int, array{key: string, name: string, value: float}>
     *   }>,
     *   maxRows: int,
     *   reportDate: CarbonImmutable
     * } $context
     * @return array{
     *   0: float,
     *   1: float,
     *   2: float,
     *   3: float,
     *   4: float,
     *   5: float,
     *   6: array<string, array{text: string, lines: array<int, string>, height: float}>
     * }
     */
    private function calculateLayout(array $context, ?string $logoPath): array
    {
        $report = $context['report'];
        $tables = $context['tables'];
        $maxRows = $context['maxRows'];
        $reportDate = $context['reportDate'];

        $pagePadding = 40;
        $pageBottomPadding = 24;
        $headerHeight = 150;
        $tableWidth = $report['tableWidth'];
        $tableGap = $report['tableGap'];
        $titlePadding = 8;
        $titleLineHeight = 14;
        $titleTextBaselineInset = 20;
        $headerRowHeight = 28;
        $rowHeight = 24;
        $footnoteLineHeight = 12;
        $tableFootnoteTopPadding = 18;
        $footnoteBottomPadding = 2;
        $bottomFootnoteTopPaddingWithoutSiblingFooters = 24;
        $bottomFootnoteTopPaddingAfterTableFootnotes = 24;
        $bottomFootnoteTopPaddingAfterFooterRows = $tableFootnoteTopPadding + 4;
        $bottomFootnotePadding = 2;

        $tableWidthFor = function (array $table) use ($report, $tableWidth): int {
            if ($table['indexOnly']) {
                return $report['indexTableWidth'];
            }

            $indexWidth = $table['showIndex'] ? 32 : 0;
            $nameWidth = (int) ($report['primaryColumnWidth'] ?? 100);
            return $indexWidth + $nameWidth + $tableWidth + 16;
        };

        if ($report['singleTable']) {
            $singleTableNameColumnWidth = (int) ($report['primaryColumnWidth'] ?? 120);
            $metricTables = $this->singleTableMetricTables($tables);
            $agencySections = $this->singleTableAgencySections($metricTables);
            if ($agencySections !== []) {
                $sectionGap = $report['agencyTableGap'];
                $indexWidth = $report['includeIndexTable'] ? $report['indexTableWidth'] : 0;
                $maxSectionWidth = 0;
                $sectionsHeight = 0;
                foreach ($agencySections as $sectionIndex => $section) {
                    $sectionTables = $section['tables'];
                    [$orderedRows] = $this->buildSingleTableRowData($sectionTables);
                    $rowCount = max(1, count($orderedRows));
                    $maxHeaderLineCount = $report['includeIndexTable'] ? 1 : 0;
                    $maxHeaderLineCount = max($maxHeaderLineCount, 1);
                    $metricHeaderWrapWidth = max(20, $tableWidth - 8);
                    foreach ($sectionTables as $table) {
                        $headerLines = $this->singleTableHeaderLines($table, $metricHeaderWrapWidth);
                        $maxHeaderLineCount = max($maxHeaderLineCount, max(1, count($headerLines)));
                    }
                    $headerRowHeight = 8 + ($maxHeaderLineCount * $titleLineHeight);
                    $hasFooterTotals = false;
                    foreach ($sectionTables as $table) {
                        if ($table['includeFooterTotalRow']) {
                            $hasFooterTotals = true;
                            break;
                        }
                    }
                    $sectionWidth = $indexWidth + $singleTableNameColumnWidth + (count($sectionTables) * $tableWidth);
                    $agencyHeaderHeight = ($titlePadding * 2) + $titleLineHeight + 2;
                    $sectionHeight = $agencyHeaderHeight
                        + (($titlePadding * 2) + $titleLineHeight + 2)
                        + $headerRowHeight
                        + ($rowHeight * $rowCount)
                        + ($hasFooterTotals ? $rowHeight : 0);
                    $maxSectionWidth = max($maxSectionWidth, $sectionWidth);
                    $sectionsHeight += $sectionHeight + ($sectionIndex > 0 ? $sectionGap : 0);
                }

                $width = ($pagePadding * 2) + $maxSectionWidth;
                $bottomFootnoteText = $report['bottomFootnote'] !== ''
                    ? $this->applyTemplate($report['bottomFootnote'], $reportDate)
                    : '';
                $bottomFootnoteLineCount = $bottomFootnoteText !== ''
                    ? count($this->wrapText($bottomFootnoteText, $width - ($pagePadding * 2), 12, 400, true))
                    : 0;
                $effectiveBottomFootnoteTopPadding = $bottomFootnoteTopPaddingWithoutSiblingFooters;
                $bottomFootnoteHeight = $bottomFootnoteText !== ''
                    ? $effectiveBottomFootnoteTopPadding + $bottomFootnotePadding + ($bottomFootnoteLineCount * $footnoteLineHeight)
                    : 0;

                $logo = $this->loadLogo($logoPath);
                $preLogoBottom = $pagePadding;
                if ($logo !== null) {
                    [, $logoHeight] = $this->fitLogo(imagesx($logo), imagesy($logo), $width - ($pagePadding * 2), 120);
                    $preLogoBottom = $pagePadding + $logoHeight + 14;
                    imagedestroy($logo);
                }
                $tableTopY = max($pagePadding + $headerHeight, $preLogoBottom + 70);
                $height = $tableTopY + $sectionsHeight + $bottomFootnoteHeight + $pageBottomPadding;
                [$width, $height] = $this->stabilizePageAspectRatio($width, $height, $pagePadding, false);

                return [
                    $width,
                    $height,
                    $tableTopY,
                    $sectionsHeight,
                    $bottomFootnotePadding,
                    $effectiveBottomFootnoteTopPadding,
                    [],
                ];
            }
            $metricColumnGaps = $this->singleTableMetricColumnGaps($metricTables, $tableGap);
            $metricCount = max(1, count($metricTables));
            [$orderedRows] = $this->buildSingleTableRowData($metricTables);
            $rowCount = max(1, count($orderedRows));
            $hasFooterTotals = false;
            foreach ($metricTables as $table) {
                if ($table['includeFooterTotalRow']) {
                    $hasFooterTotals = true;
                    break;
                }
            }

            $tableBlockWidth =
                ($report['includeIndexTable'] ? $report['indexTableWidth'] : 0) +
                $singleTableNameColumnWidth +
                ($metricCount * $tableWidth) +
                array_sum($metricColumnGaps);
            $width = ($pagePadding * 2) + $tableBlockWidth;

            $singleFootnoteTexts = [];
            foreach ($metricTables as $table) {
                if ($table['footnote'] === '') {
                    continue;
                }
                $text = $this->resolveRenderedFootnote($table, $reportDate);
                if (trim($text) === '') {
                    continue;
                }
                $label = trim((string) ($table['valueLabel'] ?? ''));
                $singleFootnoteTexts[] = $label !== '' ? ($label . ': ' . $text) : $text;
            }

            $singleTitleRowMinHeight = ($titlePadding * 2) + $titleLineHeight + 2;
            $maxGroupTitleLineCount = 1;
            $hasGroupTitleRow = false;
            $groupStart = 0;
            while ($groupStart < count($metricTables)) {
                $groupLabel = trim((string) ($metricTables[$groupStart]['valueLabel'] ?? ''));
                if ($groupLabel !== '') {
                    $hasGroupTitleRow = true;
                }
                $groupEnd = $groupStart;
                while (
                    ($groupEnd + 1) < count($metricTables)
                    && trim((string) ($metricTables[$groupEnd + 1]['valueLabel'] ?? '')) === $groupLabel
                ) {
                    $groupEnd++;
                }

                $groupColumnCount = ($groupEnd - $groupStart) + 1;
                $groupWidth = $groupColumnCount * $tableWidth;
                $groupLines = $groupLabel === ''
                    ? ['']
                    : $this->wrapText(
                        $groupLabel,
                        max(20, $groupWidth - 8),
                        12,
                        self::HEADER_ROW_FONT_WEIGHT,
                        false
                    );
                $maxGroupTitleLineCount = max($maxGroupTitleLineCount, max(1, count($groupLines)));
                $groupStart = $groupEnd + 1;
            }
            $singleTitleRowHeight = $hasGroupTitleRow
                ? max(
                    $singleTitleRowMinHeight,
                    ($titlePadding * 2) + ($maxGroupTitleLineCount * $titleLineHeight) + 2
                )
                : 0;

            $maxSubHeaderLineCount = 1;
            if ($report['includeIndexTable']) {
                $indexLines = $this->wrapText(
                    'No',
                    max(20, $report['indexTableWidth'] - 8),
                    12,
                    self::HEADER_ROW_FONT_WEIGHT,
                    false
                );
                $maxSubHeaderLineCount = max($maxSubHeaderLineCount, max(1, count($indexLines)));
            }
            $nameLines = $this->wrapText(
                $this->primaryRowHeaderLabel($report),
                max(20, $singleTableNameColumnWidth - 8),
                12,
                self::HEADER_ROW_FONT_WEIGHT,
                false
            );
            $maxSubHeaderLineCount = max($maxSubHeaderLineCount, max(1, count($nameLines)));

            $metricHeaderWrapWidth = max(20, $tableWidth - 8);
            foreach ($metricTables as $table) {
                $headerLines = $this->singleTableHeaderLines($table, $metricHeaderWrapWidth);
                $maxSubHeaderLineCount = max($maxSubHeaderLineCount, max(1, count($headerLines)));
            }
            $singleSubHeaderRowHeight = 8 + ($maxSubHeaderLineCount * $titleLineHeight);

            $tableHeight = $singleTitleRowHeight
                + $singleSubHeaderRowHeight
                + ($rowHeight * $rowCount)
                + ($hasFooterTotals ? $rowHeight : 0);

            $bottomFootnoteText = $report['bottomFootnote'] !== ''
                ? $this->applyTemplate($report['bottomFootnote'], $reportDate)
                : '';

            $logo = $this->loadLogo($logoPath);
            $singleFootnoteHeight = 0.0;
            if ($singleFootnoteTexts !== []) {
                $lineCount = 0;
                $footnoteWrapWidth = max(40, $width - ($pagePadding * 2) - 12);
                foreach ($singleFootnoteTexts as $text) {
                    $lineCount += count($this->wrapText($text, $footnoteWrapWidth, 12, 400, true));
                }
                $singleFootnoteHeight = $tableFootnoteTopPadding
                    + $footnoteBottomPadding
                    + ($lineCount * $footnoteLineHeight);
            }

            $tableBlockHeight = $tableHeight + $singleFootnoteHeight;
            $effectiveBottomFootnoteTopPadding = $singleFootnoteHeight > 0
                ? $bottomFootnoteTopPaddingAfterTableFootnotes
                : ($hasFooterTotals
                    ? $bottomFootnoteTopPaddingAfterFooterRows
                    : $bottomFootnoteTopPaddingWithoutSiblingFooters);

            $bottomFootnoteLineCount = 0;
            if ($bottomFootnoteText !== '') {
                $bottomFootnoteLineCount = count($this->wrapText(
                    $bottomFootnoteText,
                    $width - ($pagePadding * 2),
                    12,
                    400,
                    true
                ));
            }
            $bottomFootnoteHeight = $bottomFootnoteText !== ''
                ? $effectiveBottomFootnoteTopPadding + $bottomFootnotePadding + ($bottomFootnoteLineCount * $footnoteLineHeight)
                : 0;

            $preLogoBottom = $pagePadding;
            if ($logo !== null) {
                [, $logoHeight] = $this->fitLogo(imagesx($logo), imagesy($logo), $width - ($pagePadding * 2), 120);
                $preLogoBottom = $pagePadding + $logoHeight + 14;
            }

            $tableTopY = max($pagePadding + $headerHeight, $preLogoBottom + 70);
            $height = $tableTopY + $tableBlockHeight + $bottomFootnoteHeight + $pageBottomPadding;
            [$width, $height] = $this->stabilizePageAspectRatio($width, $height, $pagePadding);

            if ($logo !== null) {
                imagedestroy($logo);
            }

            return [
                $width,
                $height,
                $tableTopY,
                $tableBlockHeight,
                $bottomFootnotePadding,
                $effectiveBottomFootnoteTopPadding,
                [],
            ];
        }

        $standardAgencySections = $this->singleTableAgencySections($tables);
        $standardAgencySectionGap = $report['agencyTableGap'];
        $tableBlockWidth = $standardAgencySections !== []
            ? max(array_map(
                fn(array $section): float => $this->tableBlockWidth($section['tables'], $tableWidthFor, $tableGap),
                $standardAgencySections
            ))
            : $this->tableBlockWidth($tables, $tableWidthFor, $tableGap);
        $width = ($pagePadding * 2) + $tableBlockWidth;

        $footnotesById = [];
        foreach ($tables as $table) {
            if ($table['footnote'] === '') {
                continue;
            }
            $text = $this->resolveRenderedFootnote($table, $reportDate);
            $lineWidth = $tableWidthFor($table) - 12;
            $lines = $this->wrapText($text, $lineWidth, 12, 400, true);
            $height = $tableFootnoteTopPadding + $footnoteBottomPadding + (count($lines) * $footnoteLineHeight);
            $footnotesById[$table['id']] = [
                'text' => $text,
                'lines' => $lines,
                'height' => $height,
            ];
        }

        $maxTitleLines = 3;
        $maxTitleBlockHeight = ($titlePadding * 2) + ($maxTitleLines * $titleLineHeight) + 2;
        $sectionsForHeight = $standardAgencySections !== []
            ? $standardAgencySections
            : [['label' => '', 'tables' => $tables]];

        $maxTableBlockHeight = 0;
        $bottomAdjacentContent = 'none';
        $priority = [
            'none' => 0,
            'footnote' => 1,
            'footer-row' => 2,
        ];
        $sectionRowCapacity = function (array $sectionTables) use ($standardAgencySections, $maxRows): int {
            if ($standardAgencySections === []) {
                return $maxRows;
            }

            $rowCount = 1;
            foreach ($sectionTables as $table) {
                $rowCount = max($rowCount, count($table['rows'] ?? []));
            }

            return $rowCount;
        };
        $sectionBlockHeight = function (array $sectionTables) use (
            $sectionRowCapacity,
            $maxTitleBlockHeight,
            $headerRowHeight,
            $rowHeight,
            $footnotesById,
            $priority,
            &$maxTableBlockHeight,
            &$bottomAdjacentContent
        ): int {
            $rowCapacity = $sectionRowCapacity($sectionTables);
            $baseHeight = $maxTitleBlockHeight + $headerRowHeight + ($rowHeight * $rowCapacity);
            $height = $baseHeight;
            $sectionBottomType = 'none';

            foreach ($sectionTables as $table) {
                $collapseRows = $table['rookieFilter'] === 'rookies' && $table['includeAllAdvisors'] === false;
                $rowCount = $collapseRows ? max(1, count($table['rows'])) : $rowCapacity;
                $rowsBottom = $maxTitleBlockHeight + $headerRowHeight + ($rowHeight * $rowCount);
                $tableBottom = $rowsBottom;
                $tableBottomType = 'none';

                if ($table['includeFooterTotalRow']) {
                    $footerBottom = $rowsBottom + $rowHeight;
                    if ($footerBottom > $tableBottom) {
                        $tableBottom = $footerBottom;
                        $tableBottomType = 'footer-row';
                    }
                }

                if (isset($footnotesById[$table['id']])) {
                    $footnoteBottom = $rowsBottom
                        + ($table['includeFooterTotalRow'] ? $rowHeight : 0)
                        + $footnotesById[$table['id']]['height'];
                    if ($footnoteBottom > $tableBottom) {
                        $tableBottom = $footnoteBottom;
                        $tableBottomType = 'footnote';
                    }
                }

                if ($tableBottom > $height) {
                    $height = $tableBottom;
                    $sectionBottomType = $tableBottomType;
                } elseif (
                    $tableBottom === $height
                    && ($priority[$tableBottomType] ?? 0) > ($priority[$sectionBottomType] ?? 0)
                ) {
                    $sectionBottomType = $tableBottomType;
                }
            }

            if (
                $height > $maxTableBlockHeight
                || (
                    $height === $maxTableBlockHeight
                    && ($priority[$sectionBottomType] ?? 0) > ($priority[$bottomAdjacentContent] ?? 0)
                )
            ) {
                $maxTableBlockHeight = $height;
                $bottomAdjacentContent = $sectionBottomType;
            }

            return $height;
        };
        $standardSectionHeights = array_map(
            fn(array $section): int => $sectionBlockHeight($section['tables']),
            $sectionsForHeight
        );
        $tableBlockHeight = $maxTableBlockHeight;

        $effectiveBottomFootnoteTopPadding = match ($bottomAdjacentContent) {
            'footnote' => $bottomFootnoteTopPaddingAfterTableFootnotes,
            'footer-row' => $bottomFootnoteTopPaddingAfterFooterRows,
            default => $bottomFootnoteTopPaddingWithoutSiblingFooters,
        };

        $bottomFootnoteText = $report['bottomFootnote'] !== ''
            ? $this->applyTemplate($report['bottomFootnote'], $reportDate)
            : '';
        $renderedTableBlockHeight = $standardAgencySections !== []
            ? array_sum($standardSectionHeights)
                + (count($standardAgencySections) * (($titlePadding * 2) + $titleLineHeight + 2))
                + ((count($standardAgencySections) - 1) * $standardAgencySectionGap)
            : $tableBlockHeight;
        $logo = $this->loadLogo($logoPath);
        $bottomFootnoteLineCount = 0;
        if ($bottomFootnoteText !== '') {
            $bottomFootnoteLineCount = count($this->wrapText(
                $bottomFootnoteText,
                $width - ($pagePadding * 2),
                12,
                400,
                true
            ));
        }
        $bottomFootnoteHeight = $bottomFootnoteText !== ''
            ? $effectiveBottomFootnoteTopPadding + $bottomFootnotePadding + ($bottomFootnoteLineCount * $footnoteLineHeight)
            : 0;

        $preLogoBottom = $pagePadding;
        if ($logo !== null) {
            [, $logoHeight] = $this->fitLogo(imagesx($logo), imagesy($logo), $width - ($pagePadding * 2), 120);
            $preLogoBottom = $pagePadding + $logoHeight + 14;
        }

        $tableTopY = max($pagePadding + $headerHeight, $preLogoBottom + 70);
        $height = $tableTopY + $renderedTableBlockHeight + $bottomFootnoteHeight + $pageBottomPadding;
        [$width, $height] = $this->stabilizePageAspectRatio(
            $width,
            $height,
            $pagePadding,
            $standardAgencySections === []
        );

        if ($logo !== null) {
            imagedestroy($logo);
        }

        return [
            $width,
            $height,
            $tableTopY,
            $tableBlockHeight,
            $bottomFootnotePadding,
            $effectiveBottomFootnoteTopPadding,
            $footnotesById,
        ];
    }

    /**
     * @param array{
     *   report: array{title: string, tableGap: int, tableWidth: int, indexTableWidth: int, includeIndexTable: bool, singleTable: bool, bottomFootnote: string},
     *   tables: array<int, array{
     *     id: string,
     *     titleLines: array<int, string>,
     *     valueLabel: string,
     *     valueFormat: string,
     *     minValue: float,
     *     highlightMin: bool,
     *     showIndex: bool,
     *     indexOnly: bool,
     *     includeFooterTotalRow: bool,
     *     rookieFilter: string,
     *     includeAllAdvisors: bool,
     *     footnote: string,
     *     rookieYears: int,
     *     metricType: string,
     *     rows: array<int, array{key: string, name: string, value: float}>
     *   }>,
     *   maxRows: int,
     *   reportDate: CarbonImmutable
     * } $context
     * @param array<string, array{text: string, lines: array<int, string>, height: float}> $footnotesById
     */
    private function drawTables(
        array $context,
        float $pageWidth,
        float $tableTopY,
        float $tableBlockHeight,
        array $footnotesById,
        float $effectiveBottomTopPadding,
        float $bottomPadding
    ): void {
        $report = $context['report'];
        $tables = $context['tables'];
        $maxRows = $context['maxRows'];
        $reportDate = $context['reportDate'];

        if ($report['singleTable']) {
            $this->drawSingleTable(
                $context,
                $pageWidth,
                $tableTopY,
                $tableBlockHeight,
                $effectiveBottomTopPadding,
                $bottomPadding
            );
            return;
        }

        $pagePadding = 40;
        $tableWidth = $report['tableWidth'];
        $tableGap = $report['tableGap'];
        $titlePadding = 8;
        $titleLineHeight = 14;
        $titleTextBaselineInset = 20;
        $headerRowHeight = 28;
        $rowHeight = 24;
        $footnoteLineHeight = 12;
        $tableFootnoteTopPadding = 18;

        $maxTitleLines = 3;
        $maxTitleBlockHeight = ($titlePadding * 2) + ($maxTitleLines * $titleLineHeight) + 2;
        $tableWidthFor = function (array $table) use ($report, $tableWidth): int {
            if ($table['indexOnly']) {
                return $report['indexTableWidth'];
            }

            $indexWidth = $table['showIndex'] ? 32 : 0;
            $nameWidth = (int) ($report['primaryColumnWidth'] ?? 100);
            return $indexWidth + $nameWidth + $tableWidth + 16;
        };

        $standardAgencySections = $this->singleTableAgencySections($tables);
        $sectionsToRender = $standardAgencySections !== []
            ? $standardAgencySections
            : [['label' => '', 'tables' => $tables]];
        $standardAgencySectionGap = $report['agencyTableGap'];
        $agencyHeaderHeight = ($titlePadding * 2) + $titleLineHeight + 2;
        $sectionRowCapacity = function (array $sectionTables) use ($standardAgencySections, $maxRows): int {
            if ($standardAgencySections === []) {
                return $maxRows;
            }

            $rowCount = 1;
            foreach ($sectionTables as $table) {
                $rowCount = max($rowCount, count($table['rows'] ?? []));
            }

            return $rowCount;
        };
        $sectionBlockHeight = function (array $sectionTables) use (
            $sectionRowCapacity,
            $maxTitleBlockHeight,
            $headerRowHeight,
            $rowHeight,
            $footnotesById,
            $tableFootnoteTopPadding
        ): int {
            $rowCapacity = $sectionRowCapacity($sectionTables);
            $height = $maxTitleBlockHeight + $headerRowHeight + ($rowHeight * $rowCapacity);

            foreach ($sectionTables as $table) {
                $collapseRows = $table['rookieFilter'] === 'rookies' && $table['includeAllAdvisors'] === false;
                $rowCount = $collapseRows ? max(1, count($table['rows'])) : $rowCapacity;
                $rowsBottom = $maxTitleBlockHeight + $headerRowHeight + ($rowHeight * $rowCount);
                $tableBottom = $rowsBottom;

                if ($table['includeFooterTotalRow']) {
                    $tableBottom = max($tableBottom, $rowsBottom + $rowHeight);
                }

                if (isset($footnotesById[$table['id']])) {
                    $tableBottom = max(
                        $tableBottom,
                        $rowsBottom
                            + ($table['includeFooterTotalRow'] ? $rowHeight : 0)
                            + ($footnotesById[$table['id']]['height'] ?? $tableFootnoteTopPadding)
                    );
                }

                $height = max($height, $tableBottom);
            }

            return $height;
        };
        $sectionBlockHeights = array_map(
            fn(array $section): int => $sectionBlockHeight($section['tables']),
            $sectionsToRender
        );
        $currentSectionY = $tableTopY;
        foreach ($sectionsToRender as $sectionIndex => $section) {
            $sectionTables = $section['tables'];
            $sectionRowCapacityValue = $sectionRowCapacity($sectionTables);
            $sectionBlockHeightValue = $sectionBlockHeights[$sectionIndex] ?? $tableBlockHeight;
            $tableBlockWidth = $this->tableBlockWidth($sectionTables, $tableWidthFor, $tableGap);
            $currentX = max($pagePadding, ($pageWidth - $tableBlockWidth) / 2);
            $tablesY = $currentSectionY;
            if ($standardAgencySections !== []) {
                $this->fillRect($currentX, $currentSectionY, $tableBlockWidth, $agencyHeaderHeight, self::COLOR_PRIMARY);
                $this->strokeRect($currentX, $currentSectionY, $tableBlockWidth, $agencyHeaderHeight, self::COLOR_BLACK);
                $this->drawTextCenter(
                    (string) ($section['label'] ?? ''),
                    $currentX + ($tableBlockWidth / 2),
                    $currentSectionY + $titleTextBaselineInset,
                    12,
                    self::HEADER_ROW_FONT_WEIGHT,
                    false,
                    self::COLOR_WHITE
                );
                $tablesY += $agencyHeaderHeight;
            }
            foreach ($sectionTables as $index => $table) {
            if ($index > 0) {
                $prev = $sectionTables[$index - 1];
                $currentX += $tableWidthFor($prev);
                $currentX += $prev['id'] === 'index-only' ? 0 : $tableGap;
            }

            $x = $currentX;
            $y = $tablesY;
            $activeTableWidth = $tableWidthFor($table);
            $collapseRows = $table['rookieFilter'] === 'rookies' && $table['includeAllAdvisors'] === false;
            $rowCount = $collapseRows ? max(1, count($table['rows'])) : $sectionRowCapacityValue;
            $tableHeight = $maxTitleBlockHeight
                + $headerRowHeight
                + ($rowHeight * $rowCount)
                + ($table['includeFooterTotalRow'] ? $rowHeight : 0);

            $this->fillRect($x, $y, $activeTableWidth, $tableHeight, self::COLOR_WHITE);
            $this->strokeRect($x, $y, $activeTableWidth, $tableHeight, self::COLOR_BLACK);

            $titleLines = $this->getRenderedTitleLines($table['titleLines']);
            $titleOffset = (($maxTitleLines - count($titleLines)) * $titleLineHeight) / 2;
            $titleY = $y + $titleTextBaselineInset + $titleOffset;

            $this->fillRect($x, $y, $activeTableWidth, $maxTitleBlockHeight, self::COLOR_PRIMARY);
            $this->strokeRect($x, $y, $activeTableWidth, $maxTitleBlockHeight, self::COLOR_BLACK);
            foreach ($titleLines as $line) {
                $this->drawTextCenter(
                    $line['text'],
                    $x + ($activeTableWidth / 2),
                    $titleY,
                    12,
                    self::HEADER_ROW_FONT_WEIGHT,
                    $line['italic'],
                    self::COLOR_WHITE
                );
                $titleY += $titleLineHeight;
            }

            $headerTop = $y + $maxTitleBlockHeight;
            $this->fillRect($x, $headerTop, $activeTableWidth, $headerRowHeight, self::COLOR_SECONDARY);
            $this->strokeRect($x, $headerTop, $activeTableWidth, $headerRowHeight, self::COLOR_BLACK);

            $indexWidth = $table['indexOnly']
                ? max(0, $activeTableWidth - 16)
                : ($table['showIndex'] ? 32 : 0);
            $namePadding = 2;
            $nameWidth = $table['indexOnly'] ? 0 : (int) ($report['primaryColumnWidth'] ?? 100);
            $valueWidth = $table['indexOnly'] ? 0 : $tableWidth;
            $colStart = $x + 8;
            $col1X = $colStart + $indexWidth;
            $col2X = $colStart + $indexWidth + $nameWidth;

            if ($table['showIndex']) {
                $this->drawTextCenter('No', $colStart + ($indexWidth / 2), $headerTop + 18, 12, self::HEADER_ROW_FONT_WEIGHT, false, self::COLOR_WHITE);
            }
            if (!$table['indexOnly']) {
                $this->drawTextLeft($this->primaryRowHeaderLabel($report), $colStart + $indexWidth + $namePadding, $headerTop + 18, 12, self::HEADER_ROW_FONT_WEIGHT, false, self::COLOR_WHITE);
                $this->drawTextRight($table['valueLabel'], $colStart + $indexWidth + $nameWidth + $valueWidth, $headerTop + 18, 12, self::HEADER_ROW_FONT_WEIGHT, false, self::COLOR_WHITE);
            }

            if ($table['showIndex'] && !$table['indexOnly']) {
                $this->drawLine($col1X, $headerTop, $col1X, $headerTop + $headerRowHeight, self::COLOR_BLACK);
            }
            if (!$table['indexOnly']) {
                $this->drawLine($col2X, $headerTop, $col2X, $headerTop + $headerRowHeight, self::COLOR_BLACK);
            }

            for ($i = 0; $i < $rowCount; $i++) {
                $rowTop = $headerTop + $headerRowHeight + ($i * $rowHeight);
                $row = $table['rows'][$i] ?? null;
                $shouldDrawRow = $row !== null || !$collapseRows;

                if ($row !== null && !$table['indexOnly'] && $table['highlightMin'] && $row['value'] >= $table['minValue']) {
                    $this->fillRect($x, $rowTop, $activeTableWidth, $rowHeight, self::COLOR_HIT);
                }

                if ($shouldDrawRow) {
                    $this->strokeRect($x, $rowTop, $activeTableWidth, $rowHeight, self::COLOR_BLACK);
                    if ($table['showIndex'] && !$table['indexOnly']) {
                        $this->drawLine($col1X, $rowTop, $col1X, $rowTop + $rowHeight, self::COLOR_BLACK);
                    }
                    if (!$table['indexOnly']) {
                        $this->drawLine($col2X, $rowTop, $col2X, $rowTop + $rowHeight, self::COLOR_BLACK);
                    }
                }

                if ($row === null) {
                    continue;
                }

                $value = $this->formatValue($row['value'], $this->formatForMetric($table['metricType']));
                if ($table['showIndex']) {
                    $this->drawTextCenter((string) ($i + 1), $colStart + ($indexWidth / 2), $rowTop + 16, 12, 700, false, self::COLOR_TEXT);
                }
                if (!$table['indexOnly']) {
                    $this->drawTextLeft($row['name'], $colStart + $indexWidth + $namePadding, $rowTop + 16, 12, 700, false, self::COLOR_TEXT);
                    $this->drawTextRight(
                        $value,
                        $colStart + $indexWidth + $nameWidth + $valueWidth,
                        $rowTop + 16,
                        12,
                        700,
                        false,
                        self::COLOR_TEXT
                    );
                }
            }

            $footerRowTop = $headerTop + $headerRowHeight + ($rowHeight * $rowCount);
            if ($table['includeFooterTotalRow']) {
                $this->fillRect($x, $footerRowTop, $activeTableWidth, $rowHeight, self::COLOR_SECONDARY);
                $this->strokeRect($x, $footerRowTop, $activeTableWidth, $rowHeight, self::COLOR_BLACK);
                if ($table['showIndex'] && !$table['indexOnly']) {
                    $this->drawLine($col1X, $footerRowTop, $col1X, $footerRowTop + $rowHeight, self::COLOR_BLACK);
                }
                if (!$table['indexOnly']) {
                    $this->drawLine($col2X, $footerRowTop, $col2X, $footerRowTop + $rowHeight, self::COLOR_BLACK);
                    $totalValue = array_reduce(
                        $table['rows'],
                        fn(float $carry, array $row): float => $carry + ($row['value'] ?? 0.0),
                        0.0
                    );
                    $this->drawTextLeft('Total', $colStart + $indexWidth + $namePadding, $footerRowTop + 16, 12, 800, false, self::COLOR_WHITE);
                    $this->drawTextRight(
                        $this->formatValue($totalValue, $this->formatForMetric($table['metricType'])),
                        $colStart + $indexWidth + $nameWidth + $valueWidth,
                        $footerRowTop + 16,
                        12,
                        800,
                        false,
                        self::COLOR_WHITE
                    );
                }
            }

            if (isset($footnotesById[$table['id']])) {
                $footnote = $footnotesById[$table['id']];
                $footerY = $footerRowTop + ($table['includeFooterTotalRow'] ? $rowHeight : 0) + $tableFootnoteTopPadding;
                foreach ($footnote['lines'] as $line) {
                    $this->drawTextLeft($line, $x + 6, $footerY, 12, 400, true, self::COLOR_FOOTNOTE);
                    $footerY += $footnoteLineHeight;
                }
            }
            }
            $currentSectionY += ($standardAgencySections !== [] ? $agencyHeaderHeight : 0)
                + $sectionBlockHeightValue
                + ($sectionIndex < count($sectionsToRender) - 1 ? $standardAgencySectionGap : 0);
        }

        $bottomFootnote = $report['bottomFootnote'] !== ''
            ? $this->applyTemplate($report['bottomFootnote'], $reportDate)
            : '';
        if ($bottomFootnote !== '') {
            $pagePadding = 40;
            $footnoteLineHeight = 12;
            $lines = $this->wrapText($bottomFootnote, $pageWidth - ($pagePadding * 2), 12, 400, true);
            $renderedTableBlockHeight = $standardAgencySections !== []
                ? array_sum($sectionBlockHeights)
                    + (count($standardAgencySections) * $agencyHeaderHeight)
                    + ((count($standardAgencySections) - 1) * $standardAgencySectionGap)
                : $tableBlockHeight;
            $bottomY = $tableTopY + $renderedTableBlockHeight + $effectiveBottomTopPadding;
            foreach ($lines as $line) {
                $this->drawTextCenter($line, $pageWidth / 2, $bottomY, 12, 400, true, self::COLOR_FOOTNOTE);
                $bottomY += $footnoteLineHeight;
            }
            $bottomY += $bottomPadding;
        }
    }

    private function drawSingleTable(
        array $context,
        float $pageWidth,
        float $tableTopY,
        float $tableBlockHeight,
        float $effectiveBottomTopPadding,
        float $bottomPadding
    ): void {
        $report = $context['report'];
        $reportDate = $context['reportDate'];
        $tableWidth = $report['tableWidth'];
        $tableGap = $report['tableGap'];
        $pagePadding = 40;
        $titlePadding = 8;
        $titleLineHeight = 14;
        $titleTextBaselineInset = 20;
        $headerRowBasePadding = 8;
        $rowHeight = 24;
        $footnoteLineHeight = 12;
        $tableFootnoteTopPadding = 18;
        $singleTableNameColumnWidth = (int) ($report['primaryColumnWidth'] ?? 120);

        $metricTables = $this->singleTableMetricTables($context['tables']);
        if ($metricTables === []) {
            return;
        }
        $agencySections = $this->singleTableAgencySections($metricTables);
        if ($agencySections !== []) {
            $this->drawAgencySingleTables(
                $context,
                $agencySections,
                $pageWidth,
                $tableTopY,
                $tableBlockHeight,
                $effectiveBottomTopPadding,
                $bottomPadding
            );
            return;
        }

        [$orderedRows, $valueMaps, $columnTotals] = $this->buildSingleTableRowData($metricTables);
        $rowCount = max(1, count($orderedRows));
        $hasFooterTotals = false;
        foreach ($metricTables as $table) {
            if ($table['includeFooterTotalRow']) {
                $hasFooterTotals = true;
                break;
            }
        }

        $indexWidth = $report['includeIndexTable'] ? $report['indexTableWidth'] : 0;
        $metricCount = count($metricTables);
        $metricColumnGaps = $this->singleTableMetricColumnGaps($metricTables, $tableGap);
        $tableBlockWidth = $indexWidth
            + $singleTableNameColumnWidth
            + ($metricCount * $tableWidth)
            + array_sum($metricColumnGaps);

        $metricGroups = [];
        $maxGroupTitleLineCount = 1;
        $hasGroupTitleRow = false;
        $groupStart = 0;
        while ($groupStart < $metricCount) {
            $groupLabel = trim((string) ($metricTables[$groupStart]['valueLabel'] ?? ''));
            if ($groupLabel !== '') {
                $hasGroupTitleRow = true;
            }
            $groupEnd = $groupStart;
            while (
                ($groupEnd + 1) < $metricCount
                && trim((string) ($metricTables[$groupEnd + 1]['valueLabel'] ?? '')) === $groupLabel
            ) {
                $groupEnd++;
            }

            $groupColumnCount = ($groupEnd - $groupStart) + 1;
            $groupWidth = $groupColumnCount * $tableWidth;
            $labelLines = $groupLabel === ''
                ? ['']
                : $this->wrapText(
                    $groupLabel,
                    max(20, $groupWidth - 8),
                    12,
                    self::HEADER_ROW_FONT_WEIGHT,
                    false
                );

            $metricGroups[] = [
                'start' => $groupStart,
                'end' => $groupEnd,
                'lines' => $labelLines === [] ? [''] : $labelLines,
            ];
            $maxGroupTitleLineCount = max(
                $maxGroupTitleLineCount,
                max(1, count($labelLines))
            );

            $groupStart = $groupEnd + 1;
        }

        $singleTitleRowMinHeight = ($titlePadding * 2) + $titleLineHeight + 2;
        $singleTitleRowHeight = $hasGroupTitleRow
            ? max(
                $singleTitleRowMinHeight,
                ($titlePadding * 2) + ($maxGroupTitleLineCount * $titleLineHeight) + 2
            )
            : 0;

        $maxSubHeaderLineCount = 1;
        $indexHeaderLines = [];
        if ($report['includeIndexTable']) {
            $indexHeaderLines = $this->wrapText(
                'No',
                max(20, $indexWidth - 8),
                12,
                self::HEADER_ROW_FONT_WEIGHT,
                false
            );
            $maxSubHeaderLineCount = max($maxSubHeaderLineCount, max(1, count($indexHeaderLines)));
        }

        $nameHeaderLines = $this->wrapText(
            $this->primaryRowHeaderLabel($report),
            max(20, $singleTableNameColumnWidth - 8),
            12,
            self::HEADER_ROW_FONT_WEIGHT,
            false
        );
        $maxSubHeaderLineCount = max($maxSubHeaderLineCount, max(1, count($nameHeaderLines)));

        $metricHeaderLinesByIndex = [];
        $metricHeaderWrapWidth = max(20, $tableWidth - 8);
        foreach ($metricTables as $index => $table) {
            $headerLines = $this->singleTableHeaderLines($table, $metricHeaderWrapWidth);
            $metricHeaderLinesByIndex[$index] = $headerLines;
            $maxSubHeaderLineCount = max($maxSubHeaderLineCount, max(1, count($headerLines)));
        }

        $singleSubHeaderRowHeight = $headerRowBasePadding + ($maxSubHeaderLineCount * $titleLineHeight);

        $tableHeight = $singleTitleRowHeight
            + $singleSubHeaderRowHeight
            + ($rowHeight * $rowCount)
            + ($hasFooterTotals ? $rowHeight : 0);

        $x = max($pagePadding, ($pageWidth - $tableBlockWidth) / 2);
        $y = $tableTopY;

        $this->fillRect($x, $y, $tableBlockWidth, $tableHeight, self::COLOR_WHITE);

        $leadingWidth = $indexWidth + $singleTableNameColumnWidth;
        $this->fillRect($x, $y, $leadingWidth, $singleTitleRowHeight, self::COLOR_PRIMARY);
        $this->strokeRect($x, $y, $leadingWidth, $singleTitleRowHeight, self::COLOR_BLACK);

        $metricColumnXs = [];
        $metricX = $x + $leadingWidth;
        foreach ($metricTables as $index => $table) {
            $metricX += $metricColumnGaps[$index] ?? 0;
            $metricColumnXs[] = $metricX;
            $metricX += $tableWidth;
        }

        foreach ($metricGroups as $group) {
            $startIndex = (int) ($group['start'] ?? 0);
            $endIndex = (int) ($group['end'] ?? $startIndex);
            $groupStartX = $metricColumnXs[$startIndex] ?? ($x + $leadingWidth);
            $groupEndX = ($metricColumnXs[$endIndex] ?? $groupStartX) + $tableWidth;
            $groupWidth = max(0.0, $groupEndX - $groupStartX);

            $this->fillRect($groupStartX, $y, $groupWidth, $singleTitleRowHeight, self::COLOR_PRIMARY);
            $this->strokeRect($groupStartX, $y, $groupWidth, $singleTitleRowHeight, self::COLOR_BLACK);

            $groupLines = is_array($group['lines'] ?? null) ? $group['lines'] : [''];
            $labelOffset = (($maxGroupTitleLineCount - count($groupLines)) * $titleLineHeight) / 2;
            $labelY = $y + $titleTextBaselineInset + $labelOffset;
            foreach ($groupLines as $line) {
                $text = trim((string) $line);
                if ($text !== '') {
                    $this->drawTextCenter(
                        $text,
                        $groupStartX + ($groupWidth / 2),
                        $labelY,
                        12,
                        self::HEADER_ROW_FONT_WEIGHT,
                        false,
                        self::COLOR_WHITE
                    );
                }
                $labelY += $titleLineHeight;
            }
        }

        $headerTop = $y + $singleTitleRowHeight;
        if ($report['includeIndexTable']) {
            $this->fillRect($x, $headerTop, $indexWidth, $singleSubHeaderRowHeight, self::COLOR_SECONDARY);
            $this->strokeRect($x, $headerTop, $indexWidth, $singleSubHeaderRowHeight, self::COLOR_BLACK);
            $indexTextY = $headerTop + (($singleSubHeaderRowHeight - (count($indexHeaderLines) * $titleLineHeight)) / 2) + 10;
            foreach ($indexHeaderLines as $line) {
                $text = trim((string) $line);
                if ($text !== '') {
                    $this->drawTextCenter(
                        $text,
                        $x + ($indexWidth / 2),
                        $indexTextY,
                        12,
                        self::HEADER_ROW_FONT_WEIGHT,
                        false,
                        self::COLOR_WHITE
                    );
                }
                $indexTextY += $titleLineHeight;
            }
        }

        $nameX = $x + $indexWidth;
        $this->fillRect($nameX, $headerTop, $singleTableNameColumnWidth, $singleSubHeaderRowHeight, self::COLOR_SECONDARY);
        $this->strokeRect($nameX, $headerTop, $singleTableNameColumnWidth, $singleSubHeaderRowHeight, self::COLOR_BLACK);
        $nameTextY = $headerTop + (($singleSubHeaderRowHeight - (count($nameHeaderLines) * $titleLineHeight)) / 2) + 10;
        foreach ($nameHeaderLines as $line) {
            $text = trim((string) $line);
            if ($text !== '') {
                $this->drawTextLeft(
                    $text,
                    $nameX + 4,
                    $nameTextY,
                    12,
                    self::HEADER_ROW_FONT_WEIGHT,
                    false,
                    self::COLOR_WHITE
                );
            }
            $nameTextY += $titleLineHeight;
        }

        foreach ($metricTables as $index => $table) {
            $cellX = $metricColumnXs[$index] ?? ($x + $leadingWidth);
            $this->fillRect($cellX, $headerTop, $tableWidth, $singleSubHeaderRowHeight, self::COLOR_SECONDARY);
            $this->strokeRect($cellX, $headerTop, $tableWidth, $singleSubHeaderRowHeight, self::COLOR_BLACK);

            $headerLines = $metricHeaderLinesByIndex[$index] ?? [['text' => '', 'italic' => false]];
            $headerTextY = $headerTop + (($singleSubHeaderRowHeight - (count($headerLines) * $titleLineHeight)) / 2) + 10;
            foreach ($headerLines as $line) {
                $text = trim((string) ($line['text'] ?? ''));
                if ($text !== '') {
                    $this->drawTextCenter(
                        $text,
                        $cellX + ($tableWidth / 2),
                        $headerTextY,
                        12,
                        self::HEADER_ROW_FONT_WEIGHT,
                        (bool) ($line['italic'] ?? false),
                        self::COLOR_WHITE
                    );
                }
                $headerTextY += $titleLineHeight;
            }
        }

        for ($i = 0; $i < $rowCount; $i++) {
            $rowTop = $headerTop + $singleSubHeaderRowHeight + ($i * $rowHeight);
            $row = $orderedRows[$i] ?? null;
            $rowKey = $row['key'] ?? '';
            $rowName = $row['name'] ?? '';

            if ($report['includeIndexTable']) {
                $this->strokeRect($x, $rowTop, $indexWidth, $rowHeight, self::COLOR_BLACK);
                if ($row !== null) {
                    $this->drawTextCenter((string) ($i + 1), $x + ($indexWidth / 2), $rowTop + 16, 12, 700, false, self::COLOR_TEXT);
                }
            }

            $this->strokeRect($nameX, $rowTop, $singleTableNameColumnWidth, $rowHeight, self::COLOR_BLACK);
            if ($row !== null) {
                $this->drawTextLeft($rowName, $nameX + 4, $rowTop + 16, 12, 700, false, self::COLOR_TEXT);
            }

            foreach ($metricTables as $index => $table) {
                $cellX = $metricColumnXs[$index] ?? ($x + $leadingWidth);
                $value = ($valueMaps[(string) ($table['id'] ?? '')][$rowKey] ?? 0.0);

                if (
                    $row !== null
                    && $table['highlightMin']
                    && $value >= $table['minValue']
                ) {
                    $this->fillRect($cellX, $rowTop, $tableWidth, $rowHeight, self::COLOR_HIT);
                }

                $this->strokeRect($cellX, $rowTop, $tableWidth, $rowHeight, self::COLOR_BLACK);

                if ($row !== null) {
                    $this->drawTextRight(
                        $this->formatValue($value, $this->formatForMetric($table['metricType'])),
                        $cellX + $tableWidth - 4,
                        $rowTop + 16,
                        12,
                        700,
                        false,
                        self::COLOR_TEXT
                    );
                }
            }
        }

        if ($hasFooterTotals) {
            $footerTop = $headerTop + $singleSubHeaderRowHeight + ($rowHeight * $rowCount);
            if ($report['includeIndexTable']) {
                $this->fillRect($x, $footerTop, $indexWidth, $rowHeight, self::COLOR_SECONDARY);
                $this->strokeRect($x, $footerTop, $indexWidth, $rowHeight, self::COLOR_BLACK);
            }

            $this->fillRect($nameX, $footerTop, $singleTableNameColumnWidth, $rowHeight, self::COLOR_SECONDARY);
            $this->strokeRect($nameX, $footerTop, $singleTableNameColumnWidth, $rowHeight, self::COLOR_BLACK);
            $this->drawTextLeft('Total', $nameX + 4, $footerTop + 16, 12, 800, false, self::COLOR_WHITE);

            foreach ($metricTables as $index => $table) {
                $cellX = $metricColumnXs[$index] ?? ($x + $leadingWidth);
                $this->fillRect($cellX, $footerTop, $tableWidth, $rowHeight, self::COLOR_SECONDARY);
                $this->strokeRect($cellX, $footerTop, $tableWidth, $rowHeight, self::COLOR_BLACK);
                if ($table['includeFooterTotalRow']) {
                    $this->drawTextRight(
                        $this->formatValue(
                            $columnTotals[(string) ($table['id'] ?? '')] ?? 0.0,
                            $this->formatForMetric($table['metricType'])
                        ),
                        $cellX + $tableWidth - 4,
                        $footerTop + 16,
                        12,
                        800,
                        false,
                        self::COLOR_WHITE
                    );
                }
            }
        }

        $singleFootnoteTexts = [];
        foreach ($metricTables as $table) {
            if ($table['footnote'] === '') {
                continue;
            }
            $text = $this->resolveRenderedFootnote($table, $reportDate);
            if (trim($text) === '') {
                continue;
            }
            $label = trim((string) ($table['valueLabel'] ?? ''));
            $singleFootnoteTexts[] = $label !== '' ? ($label . ': ' . $text) : $text;
        }

        if ($singleFootnoteTexts !== []) {
            $footerY = $y + $tableHeight + $tableFootnoteTopPadding;
            $footnoteWrapWidth = max(40, $pageWidth - ($pagePadding * 2) - 12);
            foreach ($singleFootnoteTexts as $text) {
                $lines = $this->wrapText($text, $footnoteWrapWidth, 12, 400, true);
                foreach ($lines as $line) {
                    $this->drawTextLeft($line, $x + 6, $footerY, 12, 400, true, self::COLOR_FOOTNOTE);
                    $footerY += $footnoteLineHeight;
                }
            }
        }

        $bottomFootnote = $report['bottomFootnote'] !== ''
            ? $this->applyTemplate($report['bottomFootnote'], $reportDate)
            : '';
        if ($bottomFootnote !== '') {
            $lines = $this->wrapText($bottomFootnote, $pageWidth - ($pagePadding * 2), 12, 400, true);
            $bottomY = $tableTopY + $tableBlockHeight + $effectiveBottomTopPadding;
            foreach ($lines as $line) {
                $this->drawTextCenter($line, $pageWidth / 2, $bottomY, 12, 400, true, self::COLOR_FOOTNOTE);
                $bottomY += $footnoteLineHeight;
            }
            $bottomY += $bottomPadding;
        }
    }

    private function drawHeader(
        string $title,
        string $rangeLabel,
        ?GdImage $logo,
        float $pageWidth,
        float $pageHeight
    ): float {
        $pagePadding = 40;
        $logoBottom = $pagePadding;

        if ($logo !== null) {
            $maxWidth = $pageWidth - ($pagePadding * 2);
            [$drawWidth, $drawHeight] = $this->fitLogo(imagesx($logo), imagesy($logo), $maxWidth, 120);
            $logoX = $pagePadding + (($maxWidth - $drawWidth) / 2);
            $logoY = $pagePadding;
            imagecopyresampled(
                $this->mustImage(),
                $logo,
                $this->sx($logoX),
                $this->sy($logoY),
                0,
                0,
                max(1, $this->sx($drawWidth)),
                max(1, $this->sy($drawHeight)),
                imagesx($logo),
                imagesy($logo)
            );
            $logoBottom = $logoY + $drawHeight + 14;
        }

        $this->drawTextCenter($title, $pageWidth / 2, $logoBottom + 24, 26, 600, false, self::COLOR_TEXT);
        $this->drawTextCenter($rangeLabel, $pageWidth / 2, $logoBottom + 48, 16, 400, false, self::COLOR_MUTED);

        return $logoBottom;
    }

    /**
     * @param array<int, array{label: string, tables: array<int, array<string, mixed>>}> $agencySections
     */
    private function drawAgencySingleTables(
        array $context,
        array $agencySections,
        float $pageWidth,
        float $tableTopY,
        float $tableBlockHeight,
        float $effectiveBottomTopPadding,
        float $bottomPadding
    ): void {
        $report = $context['report'];
        $reportDate = $context['reportDate'];
        $tableWidth = $report['tableWidth'];
        $tableGap = $report['tableGap'];
        $pagePadding = 40;
        $titlePadding = 8;
        $titleLineHeight = 14;
        $titleTextBaselineInset = 20;
        $rowHeight = 24;
        $footnoteLineHeight = 12;
        $singleTableNameColumnWidth = (int) ($report['primaryColumnWidth'] ?? 120);
        $singleTitleRowHeight = ($titlePadding * 2) + $titleLineHeight + 2;
        $sectionGap = $report['agencyTableGap'];
        $indexWidth = $report['includeIndexTable'] ? $report['indexTableWidth'] : 0;
        $leadingWidth = $indexWidth + $singleTableNameColumnWidth;
        $sectionY = $tableTopY;

        foreach ($agencySections as $sectionIndex => $section) {
            $sectionTables = $section['tables'];
            [$orderedRows, $valueMaps, $columnTotals] = $this->buildSingleTableRowData($sectionTables);
            $rowCount = max(1, count($orderedRows));
            $metricHeaderLinesByIndex = [];
            $maxHeaderLineCount = $report['includeIndexTable'] ? 1 : 0;
            $maxHeaderLineCount = max($maxHeaderLineCount, 1);
            $metricHeaderWrapWidth = max(20, $tableWidth - 8);
            foreach ($sectionTables as $index => $table) {
                $headerLines = $this->singleTableHeaderLines($table, $metricHeaderWrapWidth);
                $metricHeaderLinesByIndex[$index] = $headerLines;
                $maxHeaderLineCount = max($maxHeaderLineCount, max(1, count($headerLines)));
            }

            $headerRowHeight = 8 + ($maxHeaderLineCount * $titleLineHeight);
            $hasFooterTotals = false;
            foreach ($sectionTables as $table) {
                if ($table['includeFooterTotalRow']) {
                    $hasFooterTotals = true;
                    break;
                }
            }

            $sectionWidth = $leadingWidth + (count($sectionTables) * $tableWidth);
            $sectionHeight = $singleTitleRowHeight
                + $headerRowHeight
                + ($rowHeight * $rowCount)
                + ($hasFooterTotals ? $rowHeight : 0);
            $x = max($pagePadding, ($pageWidth - $sectionWidth) / 2);
            $headerTop = $sectionY + $singleTitleRowHeight;
            $nameX = $x + $indexWidth;

            $this->fillRect($x, $sectionY, $sectionWidth, $singleTitleRowHeight, self::COLOR_PRIMARY);
            $this->strokeRect($x, $sectionY, $sectionWidth, $singleTitleRowHeight, self::COLOR_BLACK);
            $this->drawTextCenter(
                $section['label'],
                $x + ($sectionWidth / 2),
                $sectionY + $titleTextBaselineInset,
                12,
                self::HEADER_ROW_FONT_WEIGHT,
                false,
                self::COLOR_WHITE
            );

            if ($report['includeIndexTable']) {
                $this->drawAgencyHeaderCell($x, $headerTop, $indexWidth, $headerRowHeight, [['text' => 'No', 'italic' => false]], $titleLineHeight);
            }
            $this->drawAgencyHeaderCell($nameX, $headerTop, $singleTableNameColumnWidth, $headerRowHeight, [['text' => $this->primaryRowHeaderLabel($report), 'italic' => false]], $titleLineHeight);

            foreach ($sectionTables as $index => $table) {
                $cellX = $x + $leadingWidth + ($index * $tableWidth);
                $this->drawAgencyHeaderCell(
                    $cellX,
                    $headerTop,
                    $tableWidth,
                    $headerRowHeight,
                    $metricHeaderLinesByIndex[$index] ?? [['text' => '', 'italic' => false]],
                    $titleLineHeight
                );
            }

            foreach ($orderedRows as $rowIndex => $row) {
                $rowTop = $headerTop + $headerRowHeight + ($rowIndex * $rowHeight);
                $rowKey = (string) ($row['key'] ?? '');
                if ($report['includeIndexTable']) {
                    $this->strokeRect($x, $rowTop, $indexWidth, $rowHeight, self::COLOR_BLACK);
                    $this->drawTextCenter((string) ($rowIndex + 1), $x + ($indexWidth / 2), $rowTop + 16, 12, 700, false, self::COLOR_TEXT);
                }

                $this->strokeRect($nameX, $rowTop, $singleTableNameColumnWidth, $rowHeight, self::COLOR_BLACK);
                $this->drawTextLeft((string) ($row['name'] ?? ''), $nameX + 4, $rowTop + 16, 12, 700, false, self::COLOR_TEXT);

                foreach ($sectionTables as $index => $table) {
                    $cellX = $x + $leadingWidth + ($index * $tableWidth);
                    $value = ($valueMaps[(string) ($table['id'] ?? '')][$rowKey] ?? 0.0);
                    if ($table['highlightMin'] && $value >= $table['minValue']) {
                        $this->fillRect($cellX, $rowTop, $tableWidth, $rowHeight, self::COLOR_HIT);
                    }
                    $this->strokeRect($cellX, $rowTop, $tableWidth, $rowHeight, self::COLOR_BLACK);
                    $this->drawTextRight(
                        $this->formatValue($value, $this->formatForMetric($table['metricType'])),
                        $cellX + $tableWidth - 4,
                        $rowTop + 16,
                        12,
                        700,
                        false,
                        self::COLOR_TEXT
                    );
                }
            }

            if ($hasFooterTotals) {
                $footerTop = $headerTop + $headerRowHeight + ($rowHeight * $rowCount);
                if ($report['includeIndexTable']) {
                    $this->fillRect($x, $footerTop, $indexWidth, $rowHeight, self::COLOR_SECONDARY);
                    $this->strokeRect($x, $footerTop, $indexWidth, $rowHeight, self::COLOR_BLACK);
                }
                $this->fillRect($nameX, $footerTop, $singleTableNameColumnWidth, $rowHeight, self::COLOR_SECONDARY);
                $this->strokeRect($nameX, $footerTop, $singleTableNameColumnWidth, $rowHeight, self::COLOR_BLACK);
                $this->drawTextLeft('Total', $nameX + 4, $footerTop + 16, 12, 800, false, self::COLOR_WHITE);

                foreach ($sectionTables as $index => $table) {
                    $cellX = $x + $leadingWidth + ($index * $tableWidth);
                    $this->fillRect($cellX, $footerTop, $tableWidth, $rowHeight, self::COLOR_SECONDARY);
                    $this->strokeRect($cellX, $footerTop, $tableWidth, $rowHeight, self::COLOR_BLACK);
                    if ($table['includeFooterTotalRow']) {
                        $this->drawTextRight(
                            $this->formatValue(
                                $columnTotals[(string) ($table['id'] ?? '')] ?? 0.0,
                                $this->formatForMetric($table['metricType'])
                            ),
                            $cellX + $tableWidth - 4,
                            $footerTop + 16,
                            12,
                            800,
                            false,
                            self::COLOR_WHITE
                        );
                    }
                }
            }

            $sectionY += $sectionHeight + ($sectionIndex < count($agencySections) - 1 ? $sectionGap : 0);
        }

        $bottomFootnote = $report['bottomFootnote'] !== ''
            ? $this->applyTemplate($report['bottomFootnote'], $reportDate)
            : '';
        if ($bottomFootnote !== '') {
            $lines = $this->wrapText($bottomFootnote, $pageWidth - ($pagePadding * 2), 12, 400, true);
            $bottomY = $tableTopY + $tableBlockHeight + $effectiveBottomTopPadding;
            foreach ($lines as $line) {
                $this->drawTextCenter($line, $pageWidth / 2, $bottomY, 12, 400, true, self::COLOR_FOOTNOTE);
                $bottomY += $footnoteLineHeight;
            }
            $bottomY += $bottomPadding;
        }
    }

    /**
     * @param array<int, array{text: string, italic: bool}> $lines
     */
    private function drawAgencyHeaderCell(
        float $x,
        float $y,
        float $width,
        float $height,
        array $lines,
        float $lineHeight
    ): void {
        $this->fillRect($x, $y, $width, $height, self::COLOR_SECONDARY);
        $this->strokeRect($x, $y, $width, $height, self::COLOR_BLACK);
        $contentHeight = count($lines) * $lineHeight;
        $textY = $y + (($height - $contentHeight) / 2) + 10;
        foreach ($lines as $line) {
            $text = trim((string) ($line['text'] ?? ''));
            if ($text !== '') {
                $this->drawTextCenter(
                    $text,
                    $x + ($width / 2),
                    $textY,
                    12,
                    self::HEADER_ROW_FONT_WEIGHT,
                    (bool) ($line['italic'] ?? false),
                    self::COLOR_WHITE
                );
            }
            $textY += $lineHeight;
        }
    }

    private function createCanvas(float $pageWidth, float $pageHeight): void
    {
        $width = max(1, $this->sx($pageWidth));
        $height = max(1, $this->sy($pageHeight));
        $image = imagecreatetruecolor($width, $height);
        if ($image === false) {
            throw new RuntimeException('Unable to create report image canvas.');
        }

        $this->image = $image;
        $this->colors = [];
        imagealphablending($this->image, true);
        imagesavealpha($this->image, false);
        imagefill($this->image, 0, 0, $this->allocateColor(self::COLOR_WHITE));
        imagesetthickness($this->image, max(1, $this->scale));
    }

    private function destroyCanvas(): void
    {
        if ($this->image !== null) {
            imagedestroy($this->image);
            $this->image = null;
        }
        $this->colors = [];
    }

    private function encodePng(): string
    {
        ob_start();
        imagepng($this->mustImage(), null, 6);
        $png = ob_get_clean();
        if (!is_string($png) || $png === '') {
            throw new RuntimeException('Unable to encode report image.');
        }
        return $png;
    }

    private function mustImage(): GdImage
    {
        if ($this->image === null) {
            throw new RuntimeException('Report image canvas has not been initialized.');
        }
        return $this->image;
    }

    private function loadLogo(?string $logoPath): ?GdImage
    {
        $path = trim((string) $logoPath);
        if ($path === '' || !is_file($path)) {
            return null;
        }

        $binary = @file_get_contents($path);
        if (!is_string($binary) || $binary === '') {
            return null;
        }

        $image = @imagecreatefromstring($binary);
        return $image instanceof GdImage ? $image : null;
    }

    /**
     * @return array{0: float, 1: float}
     */
    private function fitLogo(int $rawWidth, int $rawHeight, float $maxWidth, float $preferredHeight): array
    {
        if ($rawWidth <= 0 || $rawHeight <= 0) {
            return [0.0, 0.0];
        }

        $ratio = $rawWidth / $rawHeight;
        $drawHeight = $preferredHeight;
        $drawWidth = $drawHeight * $ratio;

        if ($drawWidth > $maxWidth) {
            $drawWidth = $maxWidth;
            $drawHeight = $drawWidth / $ratio;
        }

        return [$drawWidth, $drawHeight];
    }

    /**
     * @return array{0: float, 1: float}
     */
    private function stabilizePageAspectRatio(
        float $width,
        float $height,
        int $pagePadding,
        bool $enforceMinimumWidth = true
    ): array
    {
        $safeWidth = max(1.0, $width);
        $safeHeight = max(1.0, $height);

        if ($enforceMinimumWidth) {
            $minimumWidth = (float) max(
                ($pagePadding * 2) + 1,
                ceil($safeHeight * self::MIN_PAGE_ASPECT_RATIO)
            );
            if ($safeWidth < $minimumWidth) {
                $safeWidth = $minimumWidth;
            }
        }

        $maximumWidth = (float) floor($safeHeight * self::MAX_PAGE_ASPECT_RATIO);
        if ($maximumWidth > 0.0 && $safeWidth > $maximumWidth) {
            $safeHeight = (float) ceil($safeWidth / self::MAX_PAGE_ASPECT_RATIO);
        }

        return [$safeWidth, $safeHeight];
    }

    /**
     * @return array<int, array{text: string, italic: bool}>
     */
    private function getRenderedTitleLines(array $titleLines): array
    {
        $lines = [];
        foreach (array_slice($titleLines, 0, 3) as $index => $line) {
            $text = trim((string) $line);
            if ($index > 0 && $text === '') {
                continue;
            }
            if ($index === 2) {
                $lines[] = [
                    'text' => $this->stripBrackets($text),
                    'italic' => true,
                ];
                continue;
            }
            $lines[] = [
                'text' => $text,
                'italic' => false,
            ];
        }

        return $lines;
    }

    private function stripBrackets(string $value): string
    {
        $trimmed = trim($value);
        if (str_starts_with($trimmed, '(') && str_ends_with($trimmed, ')')) {
            return trim(substr($trimmed, 1, -1));
        }
        return $trimmed;
    }

    /**
     * @param array{
     *   footnote: string,
     *   rookieYears: int,
     *   rookieFilter: string
     * } $table
     */
    private function resolveRenderedFootnote(array $table, CarbonImmutable $reportDate): string
    {
        $footnote = trim((string) ($table['footnote'] ?? ''));
        if ($footnote === '') {
            return '';
        }
        $rookieYears = max(1, (int) ($table['rookieYears'] ?? 2));
        $rookieStartYear = $reportDate->year - $rookieYears + 1;
        if (($table['rookieFilter'] ?? '') === 'rookies') {
            return str_replace('{YYYY}', (string) $rookieStartYear, $footnote);
        }
        return $this->applyTemplate($footnote, $reportDate);
    }

    private function formatForMetric(string $metricType): string
    {
        if (in_array($metricType, ['fyc', 'afyc', 'fyp', 'afyp'], true)) {
            return 'currency';
        }
        return 'count';
    }

    private function formatValue(float $value, string $format): string
    {
        if ($format === 'currency') {
            return number_format($value, 2, '.', ',');
        }
        if ($format === 'number') {
            return number_format($value, 2, '.', '');
        }

        if (abs($value - round($value)) < 0.0000001) {
            return number_format($value, 0, '.', ',');
        }
        return number_format($value, 1, '.', ',');
    }

    /**
     * @return array<int, string>
     */
    private function wrapText(
        string $text,
        float $maxWidth,
        int $fontSize,
        int $fontWeight,
        bool $italic
    ): array {
        if ($text === '') {
            return [''];
        }

        $words = preg_split('/\s+/', trim($text)) ?: [];
        if ($words === []) {
            return [''];
        }

        $lines = [];
        $current = '';
        foreach ($words as $word) {
            $testLine = $current === '' ? $word : ($current . ' ' . $word);
            $testWidth = $this->measureTextWidth($testLine, $fontSize, $fontWeight, $italic);

            if ($testWidth > $maxWidth && $current !== '') {
                $lines[] = $current;
                $current = $word;
                continue;
            }

            if ($testWidth > $maxWidth && $current === '') {
                $lines = array_merge($lines, $this->splitLongWord($word, $maxWidth, $fontSize, $fontWeight, $italic));
                $current = '';
                continue;
            }

            $current = $testLine;
        }

        if ($current !== '') {
            $lines[] = $current;
        }

        return $lines === [] ? [''] : $lines;
    }

    /**
     * @return array<int, string>
     */
    private function splitLongWord(
        string $word,
        float $maxWidth,
        int $fontSize,
        int $fontWeight,
        bool $italic
    ): array {
        $segments = [];
        $current = '';
        $chars = preg_split('//u', $word, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($chars as $char) {
            $test = $current . $char;
            $width = $this->measureTextWidth($test, $fontSize, $fontWeight, $italic);
            if ($width > $maxWidth && $current !== '') {
                $segments[] = $current;
                $current = $char;
                continue;
            }
            $current = $test;
        }
        if ($current !== '') {
            $segments[] = $current;
        }
        return $segments === [] ? [$word] : $segments;
    }

    private function measureTextWidth(
        string $text,
        int $fontSize,
        int $fontWeight,
        bool $italic
    ): float {
        if ($text === '') {
            return 0.0;
        }

        $fontPath = $this->fontPath($fontWeight, $italic);
        $bbox = imagettfbbox($this->fontPixelSize($fontSize), 0, $fontPath, $text);
        if ($bbox === false) {
            return 0.0;
        }

        $minX = min($bbox[0], $bbox[2], $bbox[4], $bbox[6]);
        $maxX = max($bbox[0], $bbox[2], $bbox[4], $bbox[6]);
        return ($maxX - $minX) / $this->scale;
    }

    private function drawTextLeft(
        string $text,
        float $x,
        float $baselineY,
        int $fontSize,
        int $fontWeight,
        bool $italic,
        string $colorHex
    ): void {
        $this->drawText($text, $x, $baselineY, $fontSize, $fontWeight, $italic, $colorHex);
    }

    private function drawTextCenter(
        string $text,
        float $centerX,
        float $baselineY,
        int $fontSize,
        int $fontWeight,
        bool $italic,
        string $colorHex
    ): void {
        $width = $this->measureTextWidth($text, $fontSize, $fontWeight, $italic);
        $x = $centerX - ($width / 2);
        $this->drawText($text, $x, $baselineY, $fontSize, $fontWeight, $italic, $colorHex);
    }

    private function drawTextRight(
        string $text,
        float $rightX,
        float $baselineY,
        int $fontSize,
        int $fontWeight,
        bool $italic,
        string $colorHex
    ): void {
        $width = $this->measureTextWidth($text, $fontSize, $fontWeight, $italic);
        $x = $rightX - $width;
        $this->drawText($text, $x, $baselineY, $fontSize, $fontWeight, $italic, $colorHex);
    }

    private function drawText(
        string $text,
        float $x,
        float $baselineY,
        int $fontSize,
        int $fontWeight,
        bool $italic,
        string $colorHex
    ): void {
        if ($text === '') {
            return;
        }
        imagettftext(
            $this->mustImage(),
            $this->fontPixelSize($fontSize),
            0,
            $this->sx($x),
            $this->sy($baselineY),
            $this->allocateColor($colorHex),
            $this->fontPath($fontWeight, $italic),
            $text
        );
    }

    private function fontPixelSize(int $fontSize): int
    {
        return max(1, (int) round($fontSize * self::FONT_SIZE_FACTOR * $this->scale));
    }

    /**
     * @param array<int, array<string, mixed>> $tables
     * @return array<int, array<string, mixed>>
     */
    private function singleTableMetricTables(array $tables): array
    {
        return array_values(array_filter(
            $tables,
            static fn(array $table): bool => ($table['indexOnly'] ?? false) !== true
        ));
    }

    /**
     * @param array<int, array<string, mixed>> $tables
     * @return array<int, array{label: string, tables: array<int, array<string, mixed>>}>
     */
    private function singleTableAgencySections(array $tables): array
    {
        $sections = [];
        foreach ($tables as $table) {
            $label = trim((string) ($table['agencyGroupLabel'] ?? ''));
            if ($label === '') {
                continue;
            }
            $lastIndex = count($sections) - 1;
            if ($lastIndex >= 0 && $sections[$lastIndex]['label'] === $label) {
                $sections[$lastIndex]['tables'][] = $table;
                continue;
            }
            $sections[] = [
                'label' => $label,
                'tables' => [$table],
            ];
        }

        return $sections;
    }

    /**
     * @param array<int, array<string, mixed>> $tables
     * @return array{
     *   0: array<int, array{key: string, name: string}>,
     *   1: array<string, array<string, float>>,
     *   2: array<string, float>
     * }
     */
    private function buildSingleTableRowData(array $tables): array
    {
        $rowNamesByKey = [];
        $valueMaps = [];
        $columnTotals = [];

        foreach ($tables as $table) {
            $tableId = (string) ($table['id'] ?? '');
            $map = [];
            $total = 0.0;
            $rows = is_array($table['rows'] ?? null) ? $table['rows'] : [];
            foreach ($rows as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $name = trim((string) ($row['name'] ?? ''));
                $key = trim((string) ($row['key'] ?? ''));
                if ($key === '') {
                    $key = $name;
                }
                if ($key === '') {
                    continue;
                }

                if (!isset($rowNamesByKey[$key])) {
                    $rowNamesByKey[$key] = $name !== '' ? $name : $key;
                }

                $value = is_numeric($row['value'] ?? null) ? (float) $row['value'] : 0.0;
                $map[$key] = $value;
                $total += $value;
            }

            $valueMaps[$tableId] = $map;
            $columnTotals[$tableId] = $total;
        }

        $orderedRows = [];
        foreach ($rowNamesByKey as $key => $name) {
            $orderedRows[] = [
                'key' => (string) $key,
                'name' => (string) $name,
            ];
        }

        usort(
            $orderedRows,
            static fn(array $left, array $right): int => strcasecmp(
                (string) ($left['name'] ?? ''),
                (string) ($right['name'] ?? '')
            )
        );

        return [$orderedRows, $valueMaps, $columnTotals];
    }

    /**
     * @param array<string, mixed> $table
     * @return array<int, array{text: string, italic: bool}>
     */
    private function singleTableHeaderLines(array $table, float $maxWidth): array
    {
        $titleLines = is_array($table['titleLines'] ?? null) ? $table['titleLines'] : [];
        $rendered = $this->getRenderedTitleLines($titleLines);
        $wrapped = [];
        foreach ($rendered as $line) {
            $text = trim((string) ($line['text'] ?? ''));
            if ($text === '') {
                continue;
            }
            $italic = (bool) ($line['italic'] ?? false);
            $parts = $this->wrapText(
                $text,
                max(20, $maxWidth),
                12,
                self::HEADER_ROW_FONT_WEIGHT,
                $italic
            );
            foreach ($parts as $part) {
                $wrapped[] = [
                    'text' => $part,
                    'italic' => $italic,
                ];
            }
        }

        if ($wrapped !== []) {
            return $wrapped;
        }

        $fallback = trim((string) ($table['valueLabel'] ?? ''));
        if ($fallback === '') {
            return [
                ['text' => '', 'italic' => false],
            ];
        }

        return array_map(
            static fn(string $part): array => ['text' => $part, 'italic' => false],
            $this->wrapText(
                $fallback,
                max(20, $maxWidth),
                12,
                self::HEADER_ROW_FONT_WEIGHT,
                false
            )
        );
    }

    /**
     * @param array<int, array<string, mixed>> $tables
     * @return array<int, int>
     */
    private function singleTableMetricColumnGaps(array $tables, int $tableGap): array
    {
        $gaps = [];
        $labels = array_map(
            static fn(array $table): string => trim((string) ($table['valueLabel'] ?? '')),
            $tables
        );

        foreach ($labels as $index => $label) {
            $previous = $index > 0 ? ($labels[$index - 1] ?? '') : null;
            $gaps[] = $index === 0 || $label !== $previous ? $tableGap : 0;
        }

        return $gaps;
    }

    /**
     * @param array<int, array{
     *   id: string,
     *   indexOnly: bool
     * }> $tables
     * @param callable(array<string, mixed>): int $tableWidthFor
     */
    private function tableBlockWidth(array $tables, callable $tableWidthFor, int $tableGap): float
    {
        $width = 0.0;
        foreach ($tables as $index => $table) {
            if ($index > 0) {
                $prev = $tables[$index - 1];
                if (($prev['id'] ?? '') !== 'index-only') {
                    $width += $tableGap;
                }
            }
            $width += $tableWidthFor($table);
        }

        return $width;
    }

    private function fillRect(float $x, float $y, float $w, float $h, string $colorHex): void
    {
        imagefilledrectangle(
            $this->mustImage(),
            $this->sx($x),
            $this->sy($y),
            max($this->sx($x), $this->sx($x + $w) - 1),
            max($this->sy($y), $this->sy($y + $h) - 1),
            $this->allocateColor($colorHex)
        );
    }

    private function strokeRect(float $x, float $y, float $w, float $h, string $colorHex): void
    {
        imagerectangle(
            $this->mustImage(),
            $this->sx($x),
            $this->sy($y),
            max($this->sx($x), $this->sx($x + $w) - 1),
            max($this->sy($y), $this->sy($y + $h) - 1),
            $this->allocateColor($colorHex)
        );
    }

    private function drawLine(float $x1, float $y1, float $x2, float $y2, string $colorHex): void
    {
        imageline(
            $this->mustImage(),
            $this->sx($x1),
            $this->sy($y1),
            $this->sx($x2),
            $this->sy($y2),
            $this->allocateColor($colorHex)
        );
    }

    private function allocateColor(string $hex): int
    {
        if (isset($this->colors[$hex])) {
            return $this->colors[$hex];
        }

        $clean = ltrim($hex, '#');
        if (strlen($clean) !== 6) {
            $clean = '000000';
        }
        $r = hexdec(substr($clean, 0, 2));
        $g = hexdec(substr($clean, 2, 2));
        $b = hexdec(substr($clean, 4, 2));

        $color = imagecolorallocate($this->mustImage(), $r, $g, $b);
        if ($color === false) {
            $color = imagecolorallocate($this->mustImage(), 0, 0, 0);
        }

        $this->colors[$hex] = $color;
        return $color;
    }

    private function fontPath(int $weight, bool $italic): string
    {
        if ($italic) {
            if ($weight >= 800) {
                return $this->fontPaths['boldItalic'];
            }
            if ($weight >= 700) {
                return $this->fontPaths['semiboldItalic'];
            }
            if ($weight >= 600) {
                return $this->fontPaths['mediumItalic'];
            }
            return $this->fontPaths['italic'];
        }

        if ($weight >= 800) {
            return $this->fontPaths['bold'];
        }
        if ($weight >= 700) {
            return $this->fontPaths['semibold'];
        }
        if ($weight >= 600) {
            return $this->fontPaths['medium'];
        }
        return $this->fontPaths['regular'];
    }

    private function sx(float $value): int
    {
        return (int) round($value * $this->scale);
    }

    private function sy(float $value): int
    {
        return (int) round($value * $this->scale);
    }

    private function parseDate(string $value): CarbonImmutable
    {
        try {
            return CarbonImmutable::parse($value);
        } catch (\Throwable) {
            return CarbonImmutable::now();
        }
    }

    private function clampInt(mixed $value, int $min, int $max): int
    {
        $parsed = is_numeric($value) ? (int) round((float) $value) : $min;
        return min($max, max($min, $parsed));
    }

    private function toFloat(mixed $value): float
    {
        if (is_numeric($value)) {
            return (float) $value;
        }
        return 0.0;
    }

    private function truncateString(string $value, int $maxLength): string
    {
        if (mb_strlen($value) <= $maxLength) {
            return $value;
        }
        return mb_substr($value, 0, $maxLength);
    }

    private function applyTemplate(string $template, CarbonImmutable $date): string
    {
        $year = (string) $date->year;
        $month = str_pad((string) $date->month, 2, '0', STR_PAD_LEFT);
        $day = str_pad((string) $date->day, 2, '0', STR_PAD_LEFT);
        return str_replace(
            ['{YYYY}', '{MM}', '{DD}', '{YYYYMM}', '{YYYYMMDD}'],
            [$year, $month, $day, $year . $month, $year . $month . $day],
            $template
        );
    }

    private function sanitizeFilename(string $filename): string
    {
        $trimmed = trim($filename);
        $safe = preg_replace('/[^\w.\-() ]+/u', '_', $trimmed) ?: 'report';
        $safe = trim($safe);
        if ($safe === '') {
            $safe = 'report';
        }
        if (!str_ends_with(strtolower($safe), '.pdf')) {
            $safe .= '.pdf';
        }
        if (strlen($safe) > self::MAX_FILENAME_LENGTH) {
            $base = substr($safe, 0, self::MAX_FILENAME_LENGTH - 4);
            $safe = rtrim($base, '.') . '.pdf';
        }
        return $safe;
    }
}
