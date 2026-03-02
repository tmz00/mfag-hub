<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ReportsControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_show_returns_empty_reports_when_not_configured(): void
    {
        $viewer = $this->createUser('standard');
        Sanctum::actingAs($viewer);

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

    public function test_show_logo_returns_not_found_when_not_configured(): void
    {
        $viewer = $this->createUser('standard');
        Sanctum::actingAs($viewer);
        Storage::fake('local');

        $this->get('/api/reports/logo')
            ->assertNotFound()
            ->assertJson([
                'message' => 'Report logo not found.',
            ]);
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
