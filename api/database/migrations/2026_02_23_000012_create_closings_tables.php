<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('closings', function (Blueprint $table): void {
            $table->id();
            $table->dateTime('submitted_at')->index();
            $table->foreignId('fsc_user_id')->constrained('users')->restrictOnDelete();
            $table->string('fsc_code', 20)->nullable()->index();
            $table->string('fsc_agency_code', 50)->nullable()->index();
            $table->boolean('is_shared')->default(false)->index();
            $table->foreignId('shared_fsc_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('shared_fsc_code', 20)->nullable()->index();
            $table->string('shared_fsc_agency_code', 50)->nullable()->index();
            $table->string('source_id', 100)->index();
            $table->foreignId('source_item_id')->nullable()->constrained('source_items')->nullOnDelete();
            $table->text('source_comment')->nullable();
            $table->unsignedInteger('referrals')->default(0);
            $table->text('referrals_comment')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['fsc_user_id', 'submitted_at']);
            $table->index(['shared_fsc_user_id', 'submitted_at']);
            $table->index(['source_id', 'source_item_id']);

            $table->foreign('source_id')->references('id')->on('sources')->restrictOnDelete();
        });

        Schema::create('closing_items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('closing_id')->constrained('closings')->cascadeOnDelete();
            $table->foreignId('parent_item_id')->nullable()->constrained('closing_items')->cascadeOnDelete();
            $table->boolean('is_rider')->default(false)->index();
            $table->string('product_id', 100)->index();
            $table->string('full_name', 200);
            $table->string('short_name', 120)->nullable();
            $table->string('premium_term_or_issue_age', 120)->nullable();
            $table->string('type_key', 50)->nullable()->index();
            $table->decimal('fyc_rate', 8, 4)->default(0);
            $table->decimal('gst', 6, 2)->default(0);
            $table->unsignedInteger('position')->default(0)->index();
            $table->timestamps();

            $table->index(['closing_id', 'position']);
            $table->index(['closing_id', 'parent_item_id', 'position']);
        });

        Schema::create('closing_item_premiums', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('closing_item_id')->constrained('closing_items')->cascadeOnDelete();
            $table->unsignedInteger('quantity')->default(1);
            $table->decimal('premium', 14, 2);
            $table->string('frequency', 30)->nullable();
            $table->unsignedInteger('position')->default(0)->index();
            $table->timestamps();

            $table->index(['closing_item_id', 'position']);
        });

        Schema::create('closing_month_backups', function (Blueprint $table): void {
            $table->id();
            $table->string('month_key', 6)->index();
            $table->longText('data');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('expires_at')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('closing_month_backups');
        Schema::dropIfExists('closing_item_premiums');
        Schema::dropIfExists('closing_items');
        Schema::dropIfExists('closings');
    }
};
