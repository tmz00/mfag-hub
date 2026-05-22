<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('report_template_tables', function (Blueprint $table): void {
            $table->boolean('agency_breakdown')->default(false)->after('agency_codes');
        });
    }

    public function down(): void
    {
        Schema::table('report_template_tables', function (Blueprint $table): void {
            $table->dropColumn('agency_breakdown');
        });
    }
};
