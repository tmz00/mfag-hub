<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('admin_restore_snapshots', function (Blueprint $table): void {
            $table->id();
            $table->string('feature', 50)->index();
            $table->string('summary', 255)->nullable();
            $table->string('scope_key', 120)->nullable();
            $table->longText('payload');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['feature', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_restore_snapshots');
    }
};
