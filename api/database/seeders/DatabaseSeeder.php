<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // Keep the default seed path non-destructive. Run legacy dataset imports
        // through the explicit `legacy:import:*` Artisan commands instead.
        // Seed default report templates explicitly with DefaultReportTemplatesSeeder
        // after sources and product types have been populated.
    }
}
