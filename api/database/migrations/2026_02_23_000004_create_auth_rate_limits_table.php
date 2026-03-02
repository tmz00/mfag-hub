<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('auth_rate_limits', function (Blueprint $table): void {
            $table->id();
            $table->string('bucket_key', 255)->unique();
            $table->string('email')->index();
            $table->string('ip_address', 64)->index();
            $table->string('action', 40)->index();
            $table->timestamp('window_started_at');
            $table->timestamp('expires_at')->index();
            $table->unsignedInteger('count')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('auth_rate_limits');
    }
};
