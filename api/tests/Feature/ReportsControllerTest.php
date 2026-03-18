<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ReportsControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_view_empty_reports_when_not_configured(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);

        $response = $this->getJson('/api/reports');
        $response->assertOk()->assertJson([
            'reports' => [],
        ]);
    }

    public function test_show_returns_saved_reports_and_normalizes_invalid_entries(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);

        $this->putJson('/api/reports', [
            'reports' => [
                [
                    ...$this->buildReportPayload(' top-stats ', 'Top Stats', '{YYYYMMDD}_District_TOP'),
                    'tables' => [
                        [
                            'id' => ' leaderboard ',
                            'titleLines' => ['TOP ADVISER'],
                            'valueLabel' => 'FYC ($)',
                            'metric' => ['type' => 'fyc'],
                        ],
                    ],
                ],
                ['title' => 'Missing Id', 'tables' => []],
                'invalid-entry',
                $this->buildReportPayload(str_repeat('r', 120), 'Long Id', '{YYYYMM}_Long'),
            ],
        ])->assertOk();

        $response = $this->getJson('/api/reports');
        $response->assertOk();

        $reports = $response->json('reports');
        $this->assertCount(2, $reports);
        $this->assertSame(1, $reports[0]['id']);
        $this->assertSame(1, $reports[0]['tables'][0]['id']);
        $this->assertSame(2, $reports[1]['id']);
    }

    public function test_admin_can_update_reports_and_creates_backup_of_previous_payload(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);

        $existingReports = [
            $this->buildReportPayload(1, 'Top Stats', '{YYYYMMDD}_District_TOP'),
        ];

        $this->putJson('/api/reports', [
            'reports' => $existingReports,
        ])->assertOk();

        $updatedReports = [
            $this->buildReportPayload(2, 'Monthly Summary', '{YYYYMM}_Summary'),
        ];

        $response = $this->putJson('/api/reports', [
            'reports' => $updatedReports,
        ]);

        $response->assertOk()->assertJson(['saved' => true]);
        $this->assertDatabaseHas('report_templates', [
            'id' => 2,
            'updated_by' => $admin->id,
        ]);
        $this->assertDatabaseHas('report_template_tables', [
            'id' => 21,
            'report_template_id' => 2,
        ]);
        $this->assertDatabaseHas('report_templates', [
            'id' => 1,
            'is_deleted' => true,
        ]);

        $backup = DB::table('report_backups')->first();
        $this->assertNotNull($backup);
        $this->assertEquals($existingReports, json_decode((string) $backup->data, true));
        $this->assertSame($admin->id, $backup->created_by);

        $snapshot = DB::table('admin_restore_snapshots')
            ->where('feature', 'reports')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($snapshot);
        $this->assertSame($admin->id, $snapshot->created_by);
        $this->assertSame('after editing report templates', $snapshot->summary);
        $this->assertEquals(
            ['reports' => $existingReports],
            json_decode((string) $snapshot->payload, true)
        );
    }

    public function test_report_snapshot_summary_describes_the_added_template(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);

        $this->putJson('/api/reports', [
            'reports' => [
                $this->buildReportPayload(1, 'Monthly Winners', '{YYYYMM}_Winners'),
            ],
        ])->assertOk();

        $snapshot = DB::table('admin_restore_snapshots')
            ->where('feature', 'reports')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($snapshot);
        $this->assertSame('after adding Monthly Winners', $snapshot->summary);
        $this->assertEquals(
            ['reports' => []],
            json_decode((string) $snapshot->payload, true)
        );
    }

    public function test_admin_can_clear_all_reports_with_an_empty_array(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);

        $existingReports = [
            $this->buildReportPayload(1, 'Top Stats', '{YYYYMMDD}_District_TOP'),
        ];

        $this->putJson('/api/reports', [
            'reports' => $existingReports,
        ])->assertOk();

        $response = $this->putJson('/api/reports', [
            'reports' => [],
        ]);

        $response->assertOk()->assertJson([
            'saved' => true,
            'reports' => [],
        ]);

        $this->assertDatabaseHas('report_templates', [
            'id' => 1,
            'is_deleted' => true,
        ]);

        $backup = DB::table('report_backups')->orderByDesc('id')->first();
        $this->assertNotNull($backup);
        $this->assertEquals($existingReports, json_decode((string) $backup->data, true));
        $this->assertSame($admin->id, $backup->created_by);
    }

    public function test_non_admin_cannot_update_reports(): void
    {
        $viewer = $this->createUser('standard');
        Sanctum::actingAs($viewer);

        $response = $this->putJson('/api/reports', [
            'reports' => [],
        ]);

        $response->assertForbidden();
    }

    public function test_admin_can_render_report_pdf(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);
        Storage::fake('local');

        $response = $this->postJson('/api/reports/render-pdf', [
            'filename' => '20260214_Custom_TOP.pdf',
            'reportDate' => '2026-02-14T00:00:00.000Z',
            'reportRangeLabel' => '01 Feb 2026 - 14 Feb 2026',
            'maxRows' => 1,
            'report' => [
                'title' => 'District Top',
                'tableGap' => 15,
                'tableWidth' => 170,
                'indexTableWidth' => 46,
                'includeIndexTable' => true,
                'singleTable' => false,
                'bottomFootnote' => '',
            ],
            'tables' => [
                [
                    'id' => 10,
                    'titleLines' => ['TOP ADVISER', '(TOTAL FYC)'],
                    'valueLabel' => 'FYC ($)',
                    'rows' => [
                        ['key' => 'A123', 'name' => 'Alex Tan', 'value' => 1234.56],
                    ],
                    'showIndex' => false,
                    'highlightMin' => false,
                    'includeFooterTotalRow' => true,
                    'includeAllAdvisors' => true,
                    'rookieFilter' => 'all',
                    'rookieYears' => 2,
                    'metric' => ['type' => 'fyc'],
                ],
            ],
        ]);

        $response->assertOk();
        $this->assertSame('application/pdf', $response->headers->get('content-type'));
        $this->assertStringContainsString(
            'attachment;',
            (string) $response->headers->get('content-disposition')
        );
        $this->assertStringStartsWith('%PDF-', (string) $response->getContent());
    }

    public function test_admin_can_render_single_table_report_pdf(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);
        Storage::fake('local');

        $response = $this->postJson('/api/reports/render-pdf', [
            'filename' => 'single-table.pdf',
            'reportDate' => '2026-02-14T00:00:00.000Z',
            'reportRangeLabel' => '01 Feb 2026 - 14 Feb 2026',
            'maxRows' => 2,
            'report' => [
                'title' => 'Single Table',
                'tableGap' => 15,
                'tableWidth' => 120,
                'indexTableWidth' => 46,
                'includeIndexTable' => true,
                'singleTable' => true,
                'bottomFootnote' => '',
            ],
            'tables' => [
                [
                    'id' => 10,
                    'titleLines' => ['AFYP'],
                    'valueLabel' => 'AFYP ($)',
                    'rows' => [
                        ['key' => 'A101', 'name' => 'Alex Tan', 'value' => 1000],
                        ['key' => 'A202', 'name' => 'Blair Ong', 'value' => 2000],
                    ],
                    'showIndex' => false,
                    'highlightMin' => false,
                    'includeFooterTotalRow' => false,
                    'includeAllAdvisors' => true,
                    'rookieFilter' => 'all',
                    'rookieYears' => 2,
                    'metric' => ['type' => 'afyp'],
                ],
                [
                    'id' => 11,
                    'titleLines' => ['Cases'],
                    'valueLabel' => 'Cases',
                    'rows' => [
                        ['key' => 'A101', 'name' => 'Alex Tan', 'value' => 3],
                        ['key' => 'A202', 'name' => 'Blair Ong', 'value' => 2],
                    ],
                    'showIndex' => false,
                    'highlightMin' => false,
                    'includeFooterTotalRow' => true,
                    'includeAllAdvisors' => true,
                    'rookieFilter' => 'all',
                    'rookieYears' => 2,
                    'metric' => ['type' => 'countCases'],
                ],
            ],
        ]);

        $response->assertOk();
        $this->assertSame('application/pdf', $response->headers->get('content-type'));
        $this->assertStringStartsWith('%PDF-', (string) $response->getContent());
    }

    public function test_render_single_table_pdf_groups_adjacent_matching_column_labels(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);
        Storage::fake('local');

        $response = $this->postJson('/api/reports/render-pdf', [
            'filename' => 'single-table-grouped-columns.pdf',
            'reportDate' => '2026-02-14T00:00:00.000Z',
            'reportRangeLabel' => '01 Feb 2026 - 14 Feb 2026',
            'maxRows' => 1,
            'report' => [
                'title' => 'Grouped Labels',
                'tableGap' => 20,
                'tableWidth' => 80,
                'indexTableWidth' => 46,
                'includeIndexTable' => false,
                'singleTable' => true,
                'bottomFootnote' => '',
            ],
            'tables' => [
                [
                    'id' => 10,
                    'titleLines' => ['AFYP'],
                    'valueLabel' => 'Production',
                    'rows' => [
                        ['key' => 'A101', 'name' => 'Alex Tan', 'value' => 1000],
                    ],
                    'showIndex' => false,
                    'highlightMin' => false,
                    'includeFooterTotalRow' => false,
                    'includeAllAdvisors' => true,
                    'rookieFilter' => 'all',
                    'rookieYears' => 2,
                    'metric' => ['type' => 'afyp'],
                ],
                [
                    'id' => 11,
                    'titleLines' => ['Cases'],
                    'valueLabel' => 'Production',
                    'rows' => [
                        ['key' => 'A101', 'name' => 'Alex Tan', 'value' => 2],
                    ],
                    'showIndex' => false,
                    'highlightMin' => false,
                    'includeFooterTotalRow' => false,
                    'includeAllAdvisors' => true,
                    'rookieFilter' => 'all',
                    'rookieYears' => 2,
                    'metric' => ['type' => 'countCases'],
                ],
                [
                    'id' => 12,
                    'titleLines' => ['FYC'],
                    'valueLabel' => 'Production',
                    'rows' => [
                        ['key' => 'A101', 'name' => 'Alex Tan', 'value' => 500],
                    ],
                    'showIndex' => false,
                    'highlightMin' => false,
                    'includeFooterTotalRow' => false,
                    'includeAllAdvisors' => true,
                    'rookieFilter' => 'all',
                    'rookieYears' => 2,
                    'metric' => ['type' => 'fyc'],
                ],
            ],
        ]);

        $response->assertOk();
        $content = (string) $response->getContent();
        $matched = preg_match('/\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/', $content, $matches);
        $this->assertSame(1, $matched);

        $pageWidth = (float) ($matches[1] ?? 0);
        $this->assertEqualsWithDelta(460.0, $pageWidth, 0.01);
    }

    public function test_render_report_pdf_requires_required_payload_fields(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/reports/render-pdf', [
            'report' => ['title' => 'Incomplete'],
            'tables' => [],
        ]);

        $response->assertUnprocessable();
    }

    public function test_render_report_pdf_applies_page_aspect_ratio_guard(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);
        Storage::fake('local');

        $rows = [];
        for ($i = 1; $i <= 60; $i++) {
            $rows[] = [
                'key' => 'A' . $i,
                'name' => 'Advisor ' . $i,
                'value' => 100 + $i,
            ];
        }

        $response = $this->postJson('/api/reports/render-pdf', [
            'filename' => 'narrow-check.pdf',
            'reportDate' => '2026-02-14T00:00:00.000Z',
            'reportRangeLabel' => '01 Feb 2026 - 14 Feb 2026',
            'maxRows' => 60,
            'report' => [
                'title' => 'Narrow Width Guard',
                'tableGap' => 15,
                'tableWidth' => 90,
                'indexTableWidth' => 46,
                'includeIndexTable' => false,
                'singleTable' => false,
                'bottomFootnote' => '',
            ],
            'tables' => [
                [
                    'id' => 10,
                    'titleLines' => ['TOP ADVISER'],
                    'valueLabel' => 'Cases',
                    'rows' => $rows,
                    'showIndex' => false,
                    'highlightMin' => false,
                    'includeFooterTotalRow' => false,
                    'includeAllAdvisors' => true,
                    'rookieFilter' => 'all',
                    'rookieYears' => 2,
                    'metric' => ['type' => 'countCases'],
                ],
            ],
        ]);

        $response->assertOk();
        $content = (string) $response->getContent();
        $matched = preg_match('/\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/', $content, $matches);
        $this->assertSame(1, $matched);

        $pageWidth = (float) ($matches[1] ?? 0);
        $pageHeight = (float) ($matches[2] ?? 0);
        $this->assertGreaterThan(0.0, $pageWidth);
        $this->assertGreaterThan(0.0, $pageHeight);
        $this->assertGreaterThanOrEqual(($pageHeight * 0.8) - 0.01, $pageWidth);
    }

    public function test_admin_can_list_and_delete_non_expired_backups(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);

        $now = now();
        DB::table('report_backups')->insert([
            [
                'data' => json_encode([['id' => 1]]),
                'created_by' => $admin->id,
                'expires_at' => $now->copy()->addDays(2),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'data' => json_encode([['id' => 2]]),
                'created_by' => $admin->id,
                'expires_at' => $now->copy()->subDay(),
                'created_at' => $now->copy()->subDay(),
                'updated_at' => $now->copy()->subDay(),
            ],
        ]);

        $response = $this->getJson('/api/reports/backups');
        $response->assertOk();

        $backups = $response->json('backups');
        $this->assertCount(1, $backups);
        $this->assertSame(1, $backups[0]['data'][0]['id']);

        $backupId = (int) $backups[0]['id'];
        $delete = $this->deleteJson("/api/reports/backups/{$backupId}");
        $delete->assertOk()->assertJson(['deleted' => true]);
        $this->assertDatabaseMissing('report_backups', ['id' => $backupId]);
    }

    public function test_admin_can_view_default_logo_when_custom_logo_not_configured(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);
        Storage::fake('local');

        $response = $this->get('/api/reports/logo');
        $response->assertOk();
        $this->assertSame('default', $response->headers->get('X-Report-Logo-Source'));
        $this->assertStringStartsWith(
            'image/',
            (string) $response->headers->get('content-type')
        );
    }

    public function test_admin_logo_falls_back_to_public_html_when_public_logo_is_missing(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);
        Storage::fake('local');

        $sourceLogo = public_path('images/mfag_banner.png');
        $this->assertFileExists($sourceLogo);

        $originalPublicPath = public_path();
        $tmpBase = storage_path('framework/testing/public-html-logo-fallback-' . uniqid('', true));
        $tmpPublicPath = $tmpBase . DIRECTORY_SEPARATOR . 'public';
        $tmpPublicHtmlImagesPath = $tmpBase . DIRECTORY_SEPARATOR . 'public_html' . DIRECTORY_SEPARATOR . 'images';

        File::ensureDirectoryExists($tmpPublicPath);
        File::ensureDirectoryExists($tmpPublicHtmlImagesPath);
        File::copy($sourceLogo, $tmpPublicHtmlImagesPath . DIRECTORY_SEPARATOR . 'mfag_banner.png');
        $this->assertFileDoesNotExist($tmpPublicPath . DIRECTORY_SEPARATOR . 'images' . DIRECTORY_SEPARATOR . 'mfag_banner.png');

        $this->app->usePublicPath($tmpPublicPath);

        try {
            $response = $this->get('/api/reports/logo');
            $response->assertOk();
            $this->assertSame('default', $response->headers->get('X-Report-Logo-Source'));
            $this->assertStringStartsWith(
                'image/',
                (string) $response->headers->get('content-type')
            );
        } finally {
            $this->app->usePublicPath($originalPublicPath);
            File::deleteDirectory($tmpBase);
        }
    }

    public function test_admin_can_upload_show_and_delete_custom_report_logo(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);
        Storage::fake('local');

        $upload = $this->post('/api/reports/logo', [
            'file' => UploadedFile::fake()->image('team-banner.png', 800, 160),
        ]);

        $upload->assertOk()->assertJson([
            'saved' => true,
            'path' => 'report_logo.png',
        ]);
        Storage::disk('local')->assertExists('report_logo.png');

        $show = $this->get('/api/reports/logo');
        $show->assertOk();
        $this->assertSame('custom', $show->headers->get('X-Report-Logo-Source'));
        $this->assertStringStartsWith(
            'image/',
            (string) $show->headers->get('content-type')
        );

        $delete = $this->deleteJson('/api/reports/logo');
        $delete->assertOk()->assertJson(['deleted' => true]);
        Storage::disk('local')->assertMissing('report_logo.png');
    }

    public function test_non_admin_cannot_upload_or_delete_report_logo(): void
    {
        $viewer = $this->createUser('standard');
        Sanctum::actingAs($viewer);
        Storage::fake('local');

        $this->post('/api/reports/logo', [
            'file' => UploadedFile::fake()->image('team-banner.png', 800, 160),
        ])->assertForbidden();

        $this->deleteJson('/api/reports/logo')->assertForbidden();
    }

    public function test_non_admin_cannot_view_or_render_reports(): void
    {
        $viewer = $this->createUser('standard');
        Sanctum::actingAs($viewer);

        $this->getJson('/api/reports')->assertForbidden();
        $this->get('/api/reports/logo')->assertForbidden();
        $this->postJson('/api/reports/render-pdf', [
            'report' => ['title' => 'Blocked'],
            'tables' => [
                [
                    'id' => 1,
                    'titleLines' => ['Blocked'],
                    'valueLabel' => 'Cases',
                    'rows' => [],
                    'metric' => ['type' => 'countCases'],
                ],
            ],
            'reportDate' => '2026-02-14T00:00:00.000Z',
            'reportRangeLabel' => '01 Feb 2026 - 14 Feb 2026',
        ])->assertForbidden();
    }

    private function createUser(string $accessLevel): User
    {
        static $counter = 1;
        $index = $counter++;

        return User::query()->create([
            'email' => sprintf('reports-user%02d@example.test', $index),
            'fsc_code' => sprintf('R%05d', $index),
            'access_level' => $accessLevel,
            'nickname' => sprintf('Reports User %02d', $index),
            'full_name' => sprintf('Reports Test User %02d', $index),
            'is_active' => true,
        ]);
    }

    private function buildReportPayload(
        int|string $id,
        string $title,
        string $filenameTemplate
    ): array
    {
        $normalizedId = is_string($id) ? trim($id) : $id;
        $tableId = is_int($normalizedId)
            ? ($normalizedId * 10) + 1
            : $normalizedId . '-table';

        return [
            'id' => $id,
            'title' => $title,
            'filenameTemplate' => $filenameTemplate,
            'tableGap' => 15,
            'tableWidth' => 170,
            'indexTableWidth' => 46,
            'includeIndexTable' => true,
            'bottomFootnote' => 'All stats are derived from submissions in MFAG Hub.',
            'tables' => [
                [
                    'id' => $tableId,
                    'titleLines' => ['TOP ADVISER', '(TOTAL FYC)'],
                    'valueLabel' => 'FYC ($)',
                    'minValue' => 8000,
                    'highlightMin' => true,
                    'showIndex' => false,
                    'includeAllAgencies' => true,
                    'agencyCodes' => ['AG01'],
                    'includeAllAdvisors' => true,
                    'rookieFilter' => 'all',
                    'rookieYears' => 2,
                    'sources' => ['cold'],
                    'metric' => ['type' => 'fyc'],
                    'footnote' => 'Minimum threshold applies.',
                ],
            ],
        ];
    }
}
