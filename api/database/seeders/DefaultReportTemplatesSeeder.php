<?php

namespace Database\Seeders;

use App\Services\ReportTemplateStore;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class DefaultReportTemplatesSeeder extends Seeder
{
    private const SOURCE_LABEL_REFERRAL = 'Referral';
    private const SOURCE_LABEL_SOCIAL_MEDIA = 'Social Media';
    private const SOURCE_LABEL_ROADSHOW = 'Roadshow';
    private const SOURCE_LABEL_SEMINAR = 'Seminar';
    private const SOURCE_LABEL_AIA_CAMPAIGN = 'AIA Campaign';
    private const SOURCE_LABEL_OTHER_COLD = 'Other (Cold)';

    public function run(): void
    {
        $sources = DB::table('sources')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'label']);
        $sourceIdsByLabel = $this->mapSourceIdsByLabel($sources->all());

        $productTypes = DB::table('product_type_definitions')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'type_key']);

        app(ReportTemplateStore::class)->replace(
            $this->buildDefaultReports($sources->all(), $sourceIdsByLabel, $productTypes->all())
        );

        $this->command?->info(
            'Default report templates seeded: '
                . 'reports=3'
                . ', productTypeColumns=' . count($productTypes)
                . ', sourceColumns=' . count($sources)
                . '.'
        );
    }

    /**
     * @param array<int, object> $sources
     * @param array<string, string> $sourceIdsByLabel
     * @param array<int, object> $productTypes
     * @return array<int, array<string, mixed>>
     */
    private function buildDefaultReports(
        array $sources,
        array $sourceIdsByLabel,
        array $productTypes
    ): array {
        $mainSourceColumns = [];
        foreach (array_values($sources) as $index => $source) {
            $sourceId = trim((string) ($source->id ?? ''));
            if ($sourceId === '') {
                continue;
            }

            $label = strtoupper(trim((string) ($source->label ?? $sourceId)));
            $mainSourceColumns[] = [
                'id' => 40 + $index,
                'titleLines' => [$label, '(FYC)'],
                'valueLabel' => 'FYC ($)',
                'sources' => [$sourceId],
                'highlightMin' => false,
                'includeAllAgencies' => true,
                'includeAllAdvisors' => true,
                'rookieFilter' => 'all',
                'metric' => ['type' => 'fyc'],
            ];
        }

        $productTypeColumns = [];
        foreach (array_values($productTypes) as $index => $productType) {
            $productTypeId = (int) ($productType->id ?? 0);
            if ($productTypeId <= 0) {
                continue;
            }

            $typeKey = strtoupper(trim((string) ($productType->type_key ?? $productTypeId)));
            $productTypeColumns[] = [
                'id' => 10 + $index,
                'titleLines' => [$typeKey, '(FYC)'],
                'valueLabel' => 'FYC ($)',
                'productTypeIds' => [$productTypeId],
                'highlightMin' => false,
                'includeAllAgencies' => true,
                'includeAllAdvisors' => true,
                'rookieFilter' => 'all',
                'metric' => ['type' => 'fyc'],
            ];
        }

        return [
            [
                'id' => 1,
                'title' => 'Top Submission Stats',
                'filenameTemplate' => '{YYYYMMDD} Top Submission Stats',
                'tableGap' => 15,
                'tableWidth' => 170,
                'indexTableWidth' => 46,
                'includeIndexTable' => true,
                'bottomFootnote' => 'Note: Singlife Careshield is excluded from FYC here. All stats are derived from submissions in MFAG Hub.',
                'tables' => [
                    [
                        'id' => 1,
                        'titleLines' => ['TOP ADVISER', '(TOTAL FYC)', 'Minimum: $8,000'],
                        'valueLabel' => 'FYC ($)',
                        'excludeProductKeywords' => 'singlife',
                        'minValue' => 8000,
                        'highlightMin' => true,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'metric' => ['type' => 'fyc'],
                    ],
                    [
                        'id' => 2,
                        'titleLines' => ['TOP ADVISER', '(TOTAL AFYP)', 'Minimum: $15,000'],
                        'valueLabel' => 'AFYP ($)',
                        'minValue' => 15000,
                        'highlightMin' => true,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'metric' => ['type' => 'afyp'],
                    ],
                    [
                        'id' => 3,
                        'titleLines' => ['TOP REFERRALS', '(REF. NO)', 'Minimum: 40'],
                        'valueLabel' => 'Ref. No',
                        'minValue' => 40,
                        'highlightMin' => true,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'metric' => ['type' => 'referrals'],
                    ],
                    [
                        'id' => 6,
                        'titleLines' => ['TOP SALES', '(REFERRALS CLOSED)', 'Minimum: 10'],
                        'valueLabel' => 'Closings',
                        'minValue' => 10,
                        'highlightMin' => true,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'sources' => $this->resolveSourceIdsByLabels(
                            $sourceIdsByLabel,
                            [self::SOURCE_LABEL_REFERRAL]
                        ),
                        'metric' => ['type' => 'countClosings'],
                    ],
                    [
                        'id' => 7,
                        'titleLines' => ['TOP SALES', '(COLD)', 'Minimum: $3,000'],
                        'valueLabel' => 'FYC ($)',
                        'excludeProductKeywords' => 'singlife',
                        'minValue' => 3000,
                        'highlightMin' => true,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'sources' => $this->resolveSourceIdsByLabels(
                            $sourceIdsByLabel,
                            [
                                self::SOURCE_LABEL_ROADSHOW,
                                self::SOURCE_LABEL_SEMINAR,
                                self::SOURCE_LABEL_OTHER_COLD,
                                self::SOURCE_LABEL_AIA_CAMPAIGN,
                            ]
                        ),
                        'metric' => ['type' => 'fyc'],
                    ],
                    [
                        'id' => 8,
                        'titleLines' => ['TOP SALES', '(SOCIAL MEDIA)', 'Minimum: $3,000'],
                        'valueLabel' => 'FYC ($)',
                        'excludeProductKeywords' => 'singlife',
                        'minValue' => 3000,
                        'highlightMin' => true,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'sources' => $this->resolveSourceIdsByLabels(
                            $sourceIdsByLabel,
                            [self::SOURCE_LABEL_SOCIAL_MEDIA]
                        ),
                        'metric' => ['type' => 'fyc'],
                    ],
                    [
                        'id' => 9,
                        'titleLines' => ['TOP ROOKIE', 'Minimum: $5,000'],
                        'valueLabel' => 'FYC ($)',
                        'excludeProductKeywords' => 'singlife',
                        'minValue' => 5000,
                        'highlightMin' => true,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => false,
                        'rookieFilter' => 'rookies',
                        'rookieYears' => 2,
                        'metric' => ['type' => 'fyc'],
                        'footnote' => '* Rookie refers to FSCs contracted from 1 Jan {YYYY} onwards.',
                    ],
                ],
            ],
            [
                'id' => 2,
                'title' => 'Case Count Submissions',
                'filenameTemplate' => '{YYYYMMDD} Case Count Submissions',
                'tableGap' => 15,
                'tableWidth' => 170,
                'indexTableWidth' => 46,
                'includeIndexTable' => false,
                'bottomFootnote' => 'All stats are derived from submissions in MFAG Hub.',
                'tables' => [
                    [
                        'id' => 4,
                        'titleLines' => ['TOP CASE COUNT', '(TOTAL CASES)', ''],
                        'valueLabel' => 'Cases',
                        'includeFooterTotalRow' => true,
                        'highlightMin' => false,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'metric' => ['type' => 'countCases'],
                    ],
                    [
                        'id' => 5,
                        'titleLines' => ['TOP CASE COUNT', '(CARESHIELD)', ''],
                        'valueLabel' => 'Cases',
                        'includeProductKeywords' => 'singlife',
                        'includeFooterTotalRow' => true,
                        'highlightMin' => false,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'metric' => ['type' => 'countCases'],
                    ],
                ],
            ],
            [
                'id' => 3,
                'title' => 'Full Submission Stats',
                'filenameTemplate' => '{YYYYMMDD} Full Submission Stats',
                'tableGap' => 0,
                'tableWidth' => 70,
                'indexTableWidth' => 46,
                'includeIndexTable' => true,
                'singleTable' => true,
                'bottomFootnote' => 'All stats are derived from submissions in MFAG Hub.',
                'tables' => [
                    ...$productTypeColumns,
                    [
                        'id' => 30,
                        'titleLines' => ['REFERRALS', '(REF. NO)'],
                        'valueLabel' => 'Ref. No',
                        'highlightMin' => false,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'metric' => ['type' => 'referrals'],
                    ],
                    [
                        'id' => 31,
                        'titleLines' => ['REFERRAL', '(CLOSINGS)'],
                        'valueLabel' => 'Cases',
                        'sources' => $this->resolveSourceIdsByLabels(
                            $sourceIdsByLabel,
                            [self::SOURCE_LABEL_REFERRAL]
                        ),
                        'highlightMin' => false,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'metric' => ['type' => 'countClosings'],
                    ],
                    [
                        'id' => 100,
                        'titleLines' => ['TOTAL', '(FYC)'],
                        'valueLabel' => 'FYC ($)',
                        'highlightMin' => false,
                        'includeAllAgencies' => true,
                        'includeAllAdvisors' => true,
                        'rookieFilter' => 'all',
                        'metric' => ['type' => 'fyc'],
                    ],
                    ...$mainSourceColumns,
                ],
            ],
        ];
    }

    /**
     * @param array<int, object> $sources
     * @return array<string, string>
     */
    private function mapSourceIdsByLabel(array $sources): array
    {
        $idsByLabel = [];

        foreach ($sources as $source) {
            $sourceId = trim((string) ($source->id ?? ''));
            $sourceLabel = $this->normalizeSourceLabel($source->label ?? null);
            if ($sourceId === '' || $sourceLabel === '') {
                continue;
            }
            if (!isset($idsByLabel[$sourceLabel])) {
                $idsByLabel[$sourceLabel] = $sourceId;
            }
        }

        return $idsByLabel;
    }

    /**
     * @param array<string, string> $sourceIdsByLabel
     * @param array<int, string> $labels
     * @return array<int, string>
     */
    private function resolveSourceIdsByLabels(array $sourceIdsByLabel, array $labels): array
    {
        $resolved = [];
        $seen = [];

        foreach ($labels as $label) {
            $normalizedLabel = $this->normalizeSourceLabel($label);
            $sourceId = $sourceIdsByLabel[$normalizedLabel] ?? null;
            if ($sourceId === null || isset($seen[$sourceId])) {
                continue;
            }
            $seen[$sourceId] = true;
            $resolved[] = $sourceId;
        }

        return $resolved;
    }

    private function normalizeSourceLabel(mixed $value): string
    {
        $normalized = trim((string) preg_replace('/\s+/', ' ', (string) ($value ?? '')));
        if ($normalized === '') {
            return '';
        }

        return strtolower($normalized);
    }
}
