<?php

namespace Tests\Feature;

use App\Services\ReportTemplateStore;
use Database\Seeders\DefaultReportTemplatesSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DefaultReportTemplatesSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_seeds_default_report_templates_using_source_and_product_type_ids(): void
    {
        DB::table('sources')->insert([
            ['id' => '11', 'label' => 'Warm', 'position' => 0, 'is_deleted' => false],
            ['id' => '12', 'label' => 'Existing', 'position' => 1, 'is_deleted' => false],
            ['id' => '13', 'label' => 'Assigned', 'position' => 2, 'is_deleted' => false],
            ['id' => '14', 'label' => 'Referral', 'position' => 3, 'is_deleted' => false],
            ['id' => '15', 'label' => 'Roadshow', 'position' => 4, 'is_deleted' => false],
            ['id' => '16', 'label' => 'Social Media', 'position' => 5, 'is_deleted' => false],
            ['id' => '17', 'label' => 'Seminar', 'position' => 6, 'is_deleted' => false],
            ['id' => '18', 'label' => 'AIA Campaign', 'position' => 7, 'is_deleted' => false],
            ['id' => '19', 'label' => 'Other (Cold)', 'position' => 8, 'is_deleted' => false],
        ]);

        DB::table('product_type_definitions')->insert([
            ['id' => 7, 'type_key' => 'protection', 'label' => 'Protection', 'position' => 0, 'is_deleted' => false],
            ['id' => 11, 'type_key' => 'savings', 'label' => 'Savings', 'position' => 1, 'is_deleted' => false],
        ]);

        $this->seed(DefaultReportTemplatesSeeder::class);

        $this->assertDatabaseHas('report_templates', [
            'id' => 3,
            'single_table' => true,
        ]);
        $this->assertDatabaseHas('report_template_tables', [
            'id' => 4,
            'report_template_id' => 2,
            'include_footer_total_row' => true,
        ]);
        $this->assertDatabaseHas('report_template_tables', [
            'id' => 10,
            'report_template_id' => 3,
            'product_type_ids' => json_encode([7]),
        ]);
        $this->assertDatabaseHas('report_template_tables', [
            'id' => 31,
            'report_template_id' => 3,
            'source_ids' => json_encode(['14']),
        ]);
        $this->assertDatabaseHas('report_template_tables', [
            'id' => 7,
            'report_template_id' => 1,
            'source_ids' => json_encode(['15', '17', '19', '18']),
        ]);
        $this->assertDatabaseHas('report_template_tables', [
            'id' => 8,
            'report_template_id' => 1,
            'source_ids' => json_encode(['16']),
        ]);

        $reports = app(ReportTemplateStore::class)->list();

        $this->assertCount(3, $reports);
        $this->assertSame('Top Submission Stats', $reports[0]['title']);
        $this->assertSame('Case Count Submissions', $reports[1]['title']);
        $this->assertTrue($reports[2]['singleTable']);
        $this->assertSame(['protection'], $reports[2]['tables'][0]['productTypeKeys']);
        $this->assertSame(['savings'], $reports[2]['tables'][1]['productTypeKeys']);
        $this->assertTrue($reports[1]['tables'][0]['includeFooterTotalRow']);
        $this->assertSame(['14'], $reports[0]['tables'][3]['sources']);
        $this->assertSame(
            ['15', '17', '19', '18'],
            $reports[0]['tables'][4]['sources']
        );
        $this->assertSame(['16'], $reports[0]['tables'][5]['sources']);
    }
}
