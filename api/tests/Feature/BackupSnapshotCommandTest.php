<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Process;
use Tests\TestCase;

class BackupSnapshotCommandTest extends TestCase
{
    public function test_backup_database_command_runs_shell_script_with_optional_arguments(): void
    {
        Process::fake();

        $this->artisan('ops:backup-database', [
            '--name' => 'nightly-test',
            '--root' => '/tmp/mfag-backups',
        ])->assertSuccessful();

        Process::assertRan(function ($process, $result): bool {
            return $process->path === base_path()
                && $process->timeout === null
                && $process->command === [
                    'bash',
                    base_path('scripts/backup-database.sh'),
                    '--name',
                    'nightly-test',
                    '--root',
                    '/tmp/mfag-backups',
                ];
        });
    }
}
