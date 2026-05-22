<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('report_template_tables', function (Blueprint $table): void {
            $table->boolean('include_all_non_legacy_agencies')->default(false)->after('include_all_agencies');
        });
    }

    public function down(): void
    {
        Schema::table('report_template_tables', function (Blueprint $table): void {
            $table->dropColumn('include_all_non_legacy_agencies');
        });
    }
};
