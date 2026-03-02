<?php

use App\Models\AuthRateLimit;
use App\Models\LoginOtp;
use Database\Seeders\DefaultReportTemplatesSeeder;
use Database\Seeders\LegacyImportClosingsSeeder;
use Database\Seeders\LegacyImportHandbookSeeder;
use Database\Seeders\LegacyImportProductsSeeder;
use Database\Seeders\LegacyImportUsersSeeder;
use Illuminate\Console\Command;
use Illuminate\Database\Seeder;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

/**
 * @param class-string<Seeder> $seederClass
 */
$runLegacyImport = static function (Command $command, string $seederClass): void {
    /** @var Seeder $seeder */
    $seeder = app($seederClass);
    $seeder->setContainer(app());
    $seeder->setCommand($command);
    $seeder->run();
};

$ensureLegacyImportCanRun = static function (Command $command): bool {
    if (!app()->isProduction() || (bool) $command->option('force')) {
        return true;
    }

    $command->error('This command is destructive and requires --force in production.');

    return false;
};

$clearLegacyImportStorage = static function (Command $command): void {
    $privateStoragePath = storage_path('app/private');
    if (!File::isDirectory($privateStoragePath)) {
        return;
    }

    $paths = File::glob($privateStoragePath . DIRECTORY_SEPARATOR . '*') ?: [];
    if ($paths === []) {
        return;
    }

    foreach ($paths as $path) {
        if (File::isDirectory($path)) {
            File::deleteDirectory($path);
            continue;
        }

        File::delete($path);
    }

    $command->line('Cleared storage/app/private/*');
};

$legacyImports = [
    'users' => LegacyImportUsersSeeder::class,
    'handbook' => LegacyImportHandbookSeeder::class,
    'products' => LegacyImportProductsSeeder::class,
    'closings' => LegacyImportClosingsSeeder::class,
    'reports' => DefaultReportTemplatesSeeder::class,
];
$backupScheduleTime = (string) env('BACKUP_SCHEDULE_TIME', '02:15');

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('auth:cleanup-expired', function () {
    $now = now();

    $expiredOtps = LoginOtp::query()
        ->where('expires_at', '<=', $now)
        ->delete();

    $expiredRateLimits = AuthRateLimit::query()
        ->where('expires_at', '<=', $now)
        ->delete();

    $this->info("Deleted {$expiredOtps} expired login OTPs and {$expiredRateLimits} expired rate-limit buckets.");

    return Command::SUCCESS;
})->purpose('Delete expired auth rate limits and login OTPs');

Schedule::command('auth:cleanup-expired')->everyTenMinutes();

Artisan::command('ops:backup-database {--name= : Optional snapshot directory name} {--root= : Optional backup root override}', function () {
    $command = ['bash', base_path('scripts/backup-database.sh')];

    $name = trim((string) $this->option('name'));
    if ($name !== '') {
        $command[] = '--name';
        $command[] = $name;
    }

    $root = trim((string) $this->option('root'));
    if ($root !== '') {
        $command[] = '--root';
        $command[] = $root;
    }

    $result = Process::path(base_path())
        ->forever()
        ->run($command);

    $output = trim((string) $result->output());
    if ($output !== '') {
        $this->output->write($output . PHP_EOL);
    }

    $errorOutput = trim((string) $result->errorOutput());
    if ($errorOutput !== '') {
        $this->output->write($errorOutput . PHP_EOL);
    }

    return $result->successful() ? Command::SUCCESS : Command::FAILURE;
})->purpose('Create a database snapshot backup using scripts/backup-database.sh');

Schedule::command('ops:backup-database')
    ->dailyAt($backupScheduleTime)
    ->withoutOverlapping();

Artisan::command('legacy:import:users {--force : Allow running in production}', function () use ($ensureLegacyImportCanRun, $runLegacyImport, $legacyImports) {
    if (!$ensureLegacyImportCanRun($this)) {
        return Command::FAILURE;
    }

    $runLegacyImport($this, $legacyImports['users']);

    return Command::SUCCESS;
})->purpose('Import the legacy users and agencies snapshot');

Artisan::command('legacy:import:handbook {--force : Allow running in production}', function () use ($ensureLegacyImportCanRun, $runLegacyImport, $legacyImports) {
    if (!$ensureLegacyImportCanRun($this)) {
        return Command::FAILURE;
    }

    $runLegacyImport($this, $legacyImports['handbook']);

    return Command::SUCCESS;
})->purpose('Import the legacy handbook snapshot');

Artisan::command('legacy:import:products {--force : Allow running in production}', function () use ($ensureLegacyImportCanRun, $runLegacyImport, $legacyImports) {
    if (!$ensureLegacyImportCanRun($this)) {
        return Command::FAILURE;
    }

    $runLegacyImport($this, $legacyImports['products']);

    return Command::SUCCESS;
})->purpose('Import the legacy products snapshot');

Artisan::command('legacy:import:closings {--force : Allow running in production}', function () use ($ensureLegacyImportCanRun, $runLegacyImport, $legacyImports) {
    if (!$ensureLegacyImportCanRun($this)) {
        return Command::FAILURE;
    }

    $runLegacyImport($this, $legacyImports['closings']);

    return Command::SUCCESS;
})->purpose('Import the legacy closings snapshot');

Artisan::command('legacy:import:reports {--force : Allow running in production}', function () use ($ensureLegacyImportCanRun, $runLegacyImport, $legacyImports) {
    if (!$ensureLegacyImportCanRun($this)) {
        return Command::FAILURE;
    }

    $runLegacyImport($this, $legacyImports['reports']);

    return Command::SUCCESS;
})->purpose('Seed default report templates from the imported sources and product types');

Artisan::command('legacy:import:all {--force : Allow running in production}', function () use ($clearLegacyImportStorage, $ensureLegacyImportCanRun, $runLegacyImport, $legacyImports) {
    if (!$ensureLegacyImportCanRun($this)) {
        return Command::FAILURE;
    }

    $clearLegacyImportStorage($this);

    $this->line('Resetting database schema with migrate:fresh');
    $migrationStatus = $this->call('migrate:fresh', ['--force' => true]);
    if ($migrationStatus !== Command::SUCCESS) {
        return $migrationStatus;
    }

    foreach ($legacyImports as $importName => $seederClass) {
        $this->line('Running legacy import: ' . $importName);
        $runLegacyImport($this, $seederClass);
    }

    return Command::SUCCESS;
})->purpose('Clear storage/app/private/*, reset the schema, and import the full legacy dataset snapshot');
