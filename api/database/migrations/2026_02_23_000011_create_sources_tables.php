<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('sources', function (Blueprint $table): void {
            $table->string('id', 100)->primary();
            $table->string('label', 150);
            $table->text('description')->nullable();
            $table->unsignedInteger('position')->default(0)->index();
            $table->boolean('is_deleted')->default(false)->index();
            $table->timestamps();
        });

        Schema::create('source_items', function (Blueprint $table): void {
            $table->id();
            $table->string('source_id', 100);
            $table->string('label', 150);
            $table->unsignedInteger('position')->default(0)->index();
            $table->boolean('is_deleted')->default(false)->index();
            $table->timestamps();

            $table->foreign('source_id')->references('id')->on('sources')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('source_items');
        Schema::dropIfExists('sources');
    }
};
