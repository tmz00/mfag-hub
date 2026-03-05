<?php

namespace Tests\Unit;

use App\Services\ReportTemplateStore;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ReportTemplateStoreTest extends TestCase
{
    use RefreshDatabase;

    public function test_replace_persists_reports_in_normalized_tables_and_list_restores_api_shape(): void
    {
        $store = app(ReportTemplateStore::class);

        DB::table('product_type_definitions')->insert([
            ['id' => 7, 'type_key' => 'protection', 'label' => 'Protection', 'position' => 0, 'is_deleted' => false],
            ['id' => 11, 'type_key' => 'savings', 'label' => 'Savings', 'position' => 1, 'is_deleted' => false],
        ]);

        $normalized = $store->replace([
            [
                'id' => ' report-1 ',
                'title' => ' Report 1 ',
                'filenameTemplate' => ' {YYYYMM}_Report ',
                'tableGap' => '14',
                'tableWidth' => '190',
                'indexTableWidth' => '50',
                'includeIndexTable' => '1',
                'singleTable' => '1',
                'bottomFootnote' => ' Footer ',
                'tables' => [
                    [
                        'id' => ' table-1 ',
                        'titleLines' => [' TOP ', ''],
                        'valueLabel' => ' FYC ',
                        'minValue' => '1000.5',
                        'highlightMin' => 'true',
                        'showIndex' => '1',
                        'includeAllAgencies' => '0',
                        'agencyCodes' => [' AG01 ', '', 'AG01'],
                        'includeAllAdvisors' => false,
                        'rookieFilter' => 'rookies',
                        'rookieYears' => '3',
                        'sources' => [' cold ', 'cold', 'seminar'],
                        'sourceItemIds' => [' item-1 ', 'item-1', 'item-2'],
                        'productTypeKeys' => [' protection ', 'protection', 'savings'],
                        'includeProductKeywords' => ' alpha , protect ',
                        'excludeProductKeywords' => ' legacy , shield ',
                        'includeFooterTotalRow' => '1',
                        'metric' => ['type' => 'field', 'field' => ' stats.value '],
                        'footnote' => ' note ',
                    ],
                    [
                        'id' => ' table-1 ',
                        'titleLines' => ['DUPLICATE'],
                        'valueLabel' => 'Ignored',
                        'metric' => ['type' => 'countClosings'],
                    ],
                ],
            ],
            [
                'id' => ' report-1 ',
                'title' => 'Duplicate Report',
                'tables' => [],
            ],
            'invalid-entry',
        ]);

        $this->assertCount(1, $normalized);
        $this->assertSame(1, $normalized[0]['id']);
        $this->assertSame('Report 1', $normalized[0]['title']);
        $this->assertSame('{YYYYMM}_Report', $normalized[0]['filenameTemplate']);
        $this->assertTrue($normalized[0]['singleTable']);
        $this->assertSame(1, $normalized[0]['tables'][0]['id']);
        $this->assertSame(['TOP', ''], $normalized[0]['tables'][0]['titleLines']);
        $this->assertSame(['AG01'], $normalized[0]['tables'][0]['agencyCodes']);
        $this->assertSame(['cold', 'seminar'], $normalized[0]['tables'][0]['sources']);
        $this->assertSame(['item-1', 'item-2'], $normalized[0]['tables'][0]['sourceItemIds']);
        $this->assertSame(['protection', 'savings'], $normalized[0]['tables'][0]['productTypeKeys']);
        $this->assertSame('alpha , protect', $normalized[0]['tables'][0]['includeProductKeywords']);
        $this->assertSame('legacy , shield', $normalized[0]['tables'][0]['excludeProductKeywords']);
        $this->assertTrue($normalized[0]['tables'][0]['includeFooterTotalRow']);
        $this->assertSame('countClosings', $normalized[0]['tables'][0]['metric']['type']);
        $this->assertArrayNotHasKey('field', $normalized[0]['tables'][0]['metric']);

        $this->assertDatabaseHas('report_templates', [
            'id' => 1,
            'title' => 'Report 1',
            'filename_template' => '{YYYYMM}_Report',
            'table_gap' => 14,
            'table_width' => 190,
            'index_table_width' => 50,
            'include_index_table' => true,
            'single_table' => true,
        ]);
        $this->assertDatabaseHas('report_template_tables', [
            'id' => 1,
            'report_template_id' => 1,
            'value_label' => 'FYC',
            'show_index' => true,
            'include_footer_total_row' => true,
            'include_all_agencies' => false,
            'include_all_advisors' => false,
            'rookie_filter' => 'rookies',
            'rookie_years' => 3,
            'source_ids' => json_encode(['cold', 'seminar']),
            'source_item_ids' => json_encode(['item-1', 'item-2']),
            'product_type_ids' => json_encode([7, 11]),
            'include_product_keywords' => 'alpha , protect',
            'exclude_product_keywords' => 'legacy , shield',
            'metric_type' => 'countClosings',
            'metric_field' => null,
        ]);

        $this->assertEquals($normalized, $store->list());
    }

    public function test_replace_keeps_blank_value_label_for_single_table_reports(): void
    {
        $store = app(ReportTemplateStore::class);

        $normalized = $store->replace([
            [
                'id' => 2,
                'title' => 'Single Table',
                'singleTable' => true,
                'tables' => [
                    [
                        'id' => 21,
                        'titleLines' => ['TOP'],
                        'valueLabel' => '   ',
                        'metric' => ['type' => 'countClosings'],
                    ],
                ],
            ],
        ]);

        $this->assertSame('', $normalized[0]['tables'][0]['valueLabel']);

        $this->assertDatabaseHas('report_template_tables', [
            'id' => 21,
            'report_template_id' => 2,
            'value_label' => '',
        ]);

        $this->assertSame('', $store->list()[0]['tables'][0]['valueLabel']);
    }
}
