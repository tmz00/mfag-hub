<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('report_templates', function (Blueprint $table) {
            $table->string('primary_column_header', 80)->nullable()->after('index_table_width');
            $table->unsignedInteger('primary_column_width')->default(120)->after('primary_column_header');
        });
    }

    public function down(): void
    {
        Schema::table('report_templates', function (Blueprint $table) {
            $table->dropColumn(['primary_column_header', 'primary_column_width']);
        });
    }
};
