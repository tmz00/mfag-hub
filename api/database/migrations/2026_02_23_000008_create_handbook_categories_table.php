<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('handbook_categories', function (Blueprint $table): void {
            $table->id();
            $table->string('category', 120);
            $table->unsignedInteger('position')->default(0);
            $table->longText('content')->nullable();
            $table->string('image_url', 500)->nullable();
            $table->string('image_path', 500)->nullable();
            $table->boolean('is_deleted')->default(false)->index();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['position', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('handbook_categories');
    }
};
