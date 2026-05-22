<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('report_templates', function (Blueprint $table): void {
            $table->boolean('agency_breakdown')->default(false)->after('single_table');
            $table->unsignedInteger('agency_table_gap')->default(30)->after('agency_breakdown');
        });
    }

    public function down(): void
    {
        Schema::table('report_templates', function (Blueprint $table): void {
            $table->dropColumn(['agency_breakdown', 'agency_table_gap']);
        });
    }
};
