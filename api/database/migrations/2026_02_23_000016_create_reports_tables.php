<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('report_templates', function (Blueprint $table): void {
            $table->id();
            $table->string('title', 150);
            $table->string('filename_template', 255);
            $table->unsignedInteger('table_gap')->default(12);
            $table->unsignedInteger('table_width')->default(180);
            $table->unsignedInteger('index_table_width')->default(46);
            $table->boolean('include_index_table')->default(true);
            $table->boolean('single_table')->default(false);
            $table->text('bottom_footnote')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->boolean('is_deleted')->default(false)->index();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('report_template_tables', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('report_template_id')
                ->constrained('report_templates')
                ->cascadeOnDelete();
            $table->json('title_lines');
            $table->string('value_label', 120);
            $table->string('value_format', 20)->nullable();
            $table->decimal('min_value', 14, 2)->nullable();
            $table->boolean('highlight_min')->default(false);
            $table->boolean('show_index')->default(false);
            $table->boolean('include_footer_total_row')->default(false);
            $table->boolean('include_all_agencies')->default(true);
            $table->json('agency_codes')->nullable();
            $table->boolean('include_all_advisors')->default(true);
            $table->string('rookie_filter', 20)->default('all');
            $table->unsignedInteger('rookie_years')->default(2);
            $table->json('source_ids')->nullable();
            $table->json('source_item_ids')->nullable();
            $table->json('product_type_ids')->nullable();
            $table->text('include_product_keywords')->nullable();
            $table->text('exclude_product_keywords')->nullable();
            $table->string('metric_type', 30)->default('countClosings');
            $table->string('metric_field', 255)->nullable();
            $table->text('footnote')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

        });

        Schema::create('report_backups', function (Blueprint $table): void {
            $table->id();
            $table->longText('data');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_backups');
        Schema::dropIfExists('report_template_tables');
        Schema::dropIfExists('report_templates');
    }
};
