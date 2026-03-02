<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('product_settings', function (Blueprint $table): void {
            $table->unsignedTinyInteger('id')->primary();
            $table->decimal('gst', 6, 2)->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('product_type_definitions', function (Blueprint $table): void {
            $table->id();
            $table->string('type_key', 50)->unique();
            $table->string('label', 100);
            $table->unsignedInteger('position')->default(0)->index();
            $table->boolean('is_deleted')->default(false)->index();
            $table->timestamps();
        });

        Schema::create('products', function (Blueprint $table): void {
            $table->string('id', 100)->primary();
            $table->boolean('is_rider')->default(false)->index();
            $table->boolean('is_deleted')->default(false)->index();
            $table->string('category', 100)->nullable()->index();
            $table->string('full_name', 200)->nullable();
            $table->string('short_name', 120)->nullable();
            $table->string('type_key', 50)->nullable()->index();
            $table->text('notes')->nullable();
            $table->string('option_title', 150)->nullable();
            $table->string('fyc_rate', 20)->nullable();
            $table->unsignedSmallInteger('frequency_mask')->default(0);
            $table->string('gst', 20)->nullable();
            $table->unsignedInteger('position')->default(0)->index();
            $table->timestamps();

            $table->foreign('type_key')->references('type_key')->on('product_type_definitions')->nullOnDelete();
            $table->index(['is_rider', 'position']);
        });

        Schema::create('product_options', function (Blueprint $table): void {
            $table->id();
            $table->string('product_id', 100);
            $table->string('label', 150);
            $table->string('fyc_rate', 20)->nullable();
            $table->unsignedInteger('position')->default(0)->index();
            $table->timestamps();

            $table->foreign('product_id')->references('id')->on('products')->cascadeOnDelete();
        });

        Schema::create('product_attachable_riders', function (Blueprint $table): void {
            $table->id();
            $table->string('base_product_id', 100);
            $table->string('rider_id', 100);
            $table->unsignedInteger('position')->default(0)->index();
            $table->timestamps();

            $table->foreign('base_product_id')->references('id')->on('products')->cascadeOnDelete();
            $table->foreign('rider_id')->references('id')->on('products')->cascadeOnDelete();
            $table->unique(['base_product_id', 'rider_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_attachable_riders');
        Schema::dropIfExists('product_options');
        Schema::dropIfExists('products');
        Schema::dropIfExists('product_type_definitions');
        Schema::dropIfExists('product_settings');
    }
};
