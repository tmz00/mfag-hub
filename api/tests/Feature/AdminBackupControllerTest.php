<?php

namespace Tests\Feature;

use App\Models\Agency;
use App\Models\User;
use App\Services\AdminUndoService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminBackupControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_list_recent_snapshots_with_team_summaries(): void
    {
        $adminAgency = $this->createAgency('ADM');
        $admin = $this->createUser('admin', [
            'agency_id' => $adminAgency->id,
            'nickname' => 'Admin',
        ]);

        Sanctum::actingAs($admin);

        $createResponse = $this->postJson('/api/team/users', [
            'email' => 'tarmizi@example.test',
            'fscCode' => '54321',
            'agencyCode' => 'N07',
            'accessLevel' => 'editor',
            'nickname' => 'Tarmizi',
            'fullName' => 'Tarmizi Test',
        ]);
        $createResponse->assertCreated();

        $userId = (int) $createResponse->json('uid');
        $createdSummary = sprintf(
            'after adding Tarmizi / tarmizi@example.test (ID#%d)',
            $userId
        );

        $this->putJson("/api/team/users/{$userId}", [
            'email' => 'tarmizi@example.test',
            'fscCode' => '54321',
            'agencyCode' => 'N07',
            'accessLevel' => 'editor',
            'nickname' => 'Tarmizi Updated',
            'fullName' => 'Tarmizi Test',
            'birthDate' => '1990-01-01',
            'contractDate' => '2020-01-01',
        ])->assertOk();

        $this->deleteJson("/api/team/users/{$userId}")->assertOk();

        $this->putJson('/api/agencies', [
            'agencies' => [
                [
                    'code' => 'AGX',
                    'name' => 'Agency X',
                    'position' => 2,
                    'isActive' => true,
                ],
            ],
        ])->assertOk();

        $this->deleteJson('/api/agencies/AGX')->assertOk();

        $history = $this->getJson('/api/backups/snapshots');
        $history->assertOk();

        $summaries = collect($history->json('snapshots'))->pluck('summary')->all();

        $this->assertContains($createdSummary, $summaries);
        $this->assertContains(
            "after editing Tarmizi Updated / tarmizi@example.test (ID#{$userId})",
            $summaries
        );
        $this->assertContains(
            "after deleting Tarmizi Updated / tarmizi@example.test (ID#{$userId})",
            $summaries
        );
        $this->assertContains('after adding agency Agency X (AGX)', $summaries);
        $this->assertContains('after deleting agency Agency X (AGX)', $summaries);
    }

    public function test_editor_only_sees_supported_snapshot_features(): void
    {
        $agency = $this->createAgency('ED1');
        $admin = $this->createUser('admin', [
            'agency_id' => $agency->id,
            'nickname' => 'Admin',
        ]);
        $editor = $this->createUser('editor', [
            'agency_id' => $agency->id,
            'nickname' => 'Editor',
            'email' => 'editor@example.test',
            'fsc_code' => '20001',
        ]);

        Sanctum::actingAs($admin);
        $this->postJson('/api/team/users', [
            'email' => 'admin-created@example.test',
            'fscCode' => '50001',
            'agencyCode' => 'ED1',
            'accessLevel' => 'standard',
            'nickname' => 'Admin Made',
            'fullName' => 'Admin Made User',
        ])->assertCreated();

        Sanctum::actingAs($editor);
        $this->putJson('/api/sources', [
            'sources' => [
                [
                    'id' => 'warm',
                    'label' => 'Warm',
                    'children' => [],
                ],
            ],
        ])->assertOk();

        Sanctum::actingAs($admin);
        $this->putJson('/api/reports', [
            'reports' => [
                [
                    'id' => 1,
                    'title' => 'Team Summary',
                    'filenameTemplate' => '{YYYYMM}_Team_Summary',
                    'tableGap' => 12,
                    'tableWidth' => 180,
                    'indexTableWidth' => 46,
                    'includeIndexTable' => false,
                    'tables' => [],
                ],
            ],
        ])->assertOk();

        $history = $this->getJson('/api/backups/snapshots');
        $history->assertOk();

        $adminFeatures = collect($history->json('snapshots'))
            ->pluck('feature')
            ->unique()
            ->values()
            ->all();
        $this->assertContains('reports', $adminFeatures);

        Sanctum::actingAs($editor);
        $history = $this->getJson('/api/backups/snapshots');
        $history->assertOk();

        $features = collect($history->json('snapshots'))->pluck('feature')->unique()->values()->all();

        $this->assertContains('sources', $features);
        $this->assertNotContains('reports', $features);
        $this->assertNotContains('team', $features);
    }

    public function test_admin_can_restore_a_team_snapshot(): void
    {
        $agency = $this->createAgency('ADM');
        $admin = $this->createUser('admin', [
            'agency_id' => $agency->id,
            'nickname' => 'Admin',
        ]);

        Sanctum::actingAs($admin);

        $createResponse = $this->postJson('/api/team/users', [
            'email' => 'undo-target@example.test',
            'fscCode' => '65432',
            'agencyCode' => 'ADM',
            'accessLevel' => 'standard',
            'nickname' => 'Undo Target',
            'fullName' => 'Undo Target',
        ]);
        $createResponse->assertCreated();

        $userId = (int) $createResponse->json('uid');
        $restoredSummary =
            "after deleting Undo Target / undo-target@example.test (ID#{$userId})";
        $this->deleteJson("/api/team/users/{$userId}")
            ->assertOk()
            ->assertJson(['uid' => (string) $userId]);

        $snapshot = $this->findSnapshotBySummary(
            $this->getJson('/api/backups/snapshots')->json('snapshots'),
            $restoredSummary
        );

        $this->assertNotNull($snapshot);

        $this->postJson('/api/backups/snapshots/' . $snapshot['id'] . '/restore')
            ->assertOk()
            ->assertJson(['restored' => true]);

        $this->assertDatabaseHas('users', [
            'id' => $userId,
            'is_active' => true,
        ]);
        $this->assertDatabaseMissing('admin_restore_snapshots', [
            'id' => (int) $snapshot['id'],
        ]);

        $historyAfterRestore = $this->getJson('/api/backups/snapshots');
        $historyAfterRestore->assertOk();

        $snapshots = $historyAfterRestore->json('snapshots');
        $this->assertNull($this->findSnapshotBySummary($snapshots, $restoredSummary));
        $this->assertNotNull($this->findSnapshotBySummary($snapshots, 'Before restore: ' . $restoredSummary));
    }

    public function test_admin_can_access_up_to_fifty_snapshots_per_feature(): void
    {
        $agency = $this->createAgency('ADM');
        $admin = $this->createUser('admin', [
            'agency_id' => $agency->id,
            'nickname' => 'Admin',
        ]);

        Sanctum::actingAs($admin);

        $undoService = app(AdminUndoService::class);
        for ($i = 1; $i <= 55; $i++) {
            $undoService->recordProductsSnapshot($admin->id, "Products snapshot {$i}");
            $undoService->recordSourcesSnapshot($admin->id, "Sources snapshot {$i}");
        }

        $this->assertSame(
            50,
            DB::table('admin_restore_snapshots')->where('feature', 'products')->count()
        );
        $this->assertSame(
            50,
            DB::table('admin_restore_snapshots')->where('feature', 'sources')->count()
        );
        $this->assertDatabaseMissing('admin_restore_snapshots', [
            'feature' => 'products',
            'summary' => 'after Products snapshot 1',
        ]);
        $this->assertDatabaseMissing('admin_restore_snapshots', [
            'feature' => 'sources',
            'summary' => 'Sources snapshot 1',
        ]);

        $history = $this->getJson('/api/backups/snapshots');
        $history->assertOk();

        $snapshots = collect($history->json('snapshots'));
        $this->assertSame(100, $snapshots->count());
        $this->assertSame(50, $snapshots->where('feature', 'products')->count());
        $this->assertSame(50, $snapshots->where('feature', 'sources')->count());
    }

    public function test_admin_database_import_passes_current_php_binary_to_shell_script(): void
    {
        $agency = $this->createAgency('ADM');
        $admin = $this->createUser('admin', [
            'agency_id' => $agency->id,
            'nickname' => 'Admin',
        ]);

        Sanctum::actingAs($admin);
        Process::fake();

        $this->post('/api/backups/database/import', [
            'file' => UploadedFile::fake()->create('backup.sql.gz', 1, 'application/gzip'),
        ])->assertOk()->assertJson(['restored' => true]);

        Process::assertRan(function ($process, $result): bool {
            $command = is_array($process->command) ? $process->command : [];
            $uploadedPath = is_string($command[2] ?? null) ? $command[2] : '';

            return $process->path === base_path()
                && $process->timeout === null
                && ($process->environment['PHP_BIN'] ?? null) === PHP_BINARY
                && $command[0] === 'bash'
                && $command[1] === base_path('scripts/import-database.sh')
                && str_starts_with($uploadedPath, sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'mfag-database-import-')
                && ($command[3] ?? null) === '--yes';
        });
    }

    public function test_editor_can_import_uploaded_files_backup(): void
    {
        $agency = $this->createAgency('ED1');
        $editor = $this->createUser('editor', [
            'agency_id' => $agency->id,
            'nickname' => 'Editor',
        ]);

        Sanctum::actingAs($editor);
        Process::fake();

        $this->post('/api/backups/files/import', [
            'file' => UploadedFile::fake()->create('uploaded-files.tar.gz', 1, 'application/gzip'),
        ])->assertOk()->assertJson(['restored' => true]);

        Process::assertRan(function ($process, $result): bool {
            $command = is_array($process->command) ? $process->command : [];
            $uploadedPath = is_string($command[2] ?? null) ? $command[2] : '';

            return $process->path === base_path()
                && $process->timeout === null
                && ($process->environment['PHP_BIN'] ?? null) === PHP_BINARY
                && $command[0] === 'bash'
                && $command[1] === base_path('scripts/import-uploaded-files.sh')
                && str_starts_with($uploadedPath, sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'mfag-uploaded-files-import-')
                && ($command[3] ?? null) === '--yes';
        });
    }

    public function test_editor_cannot_import_database_backup(): void
    {
        $agency = $this->createAgency('ED1');
        $editor = $this->createUser('editor', [
            'agency_id' => $agency->id,
            'nickname' => 'Editor',
        ]);

        Sanctum::actingAs($editor);
        Process::fake();

        $this->post('/api/backups/database/import', [
            'file' => UploadedFile::fake()->create('backup.sql.gz', 1, 'application/gzip'),
        ])->assertForbidden();

        Process::assertNothingRan();
    }

    private function findSnapshotBySummary(?array $snapshots, string $summary): ?array
    {
        $collection = collect($snapshots ?: []);
        $found = $collection->first(fn ($row): bool => ($row['summary'] ?? null) === $summary);
        return is_array($found) ? $found : null;
    }

    private function createUser(string $accessLevel = 'standard', array $overrides = []): User
    {
        static $counter = 1;
        $index = $counter++;

        return User::query()->create([
            'email' => $overrides['email'] ?? sprintf('backup-user%02d@example.test', $index),
            'fsc_code' => $overrides['fsc_code'] ?? sprintf('%05d', $index),
            'access_level' => $overrides['access_level'] ?? $accessLevel,
            'agency_id' => $overrides['agency_id'] ?? null,
            'nickname' => $overrides['nickname'] ?? sprintf('BackupUser%02d', $index),
            'full_name' => $overrides['full_name'] ?? sprintf('Backup Test User %02d', $index),
            'is_active' => $overrides['is_active'] ?? true,
        ]);
    }

    private function createAgency(string $code, ?string $name = null): Agency
    {
        return Agency::query()->create([
            'code' => $code,
            'name' => $name ?? $code,
            'position' => 0,
            'is_delete' => false,
        ]);
    }
}
