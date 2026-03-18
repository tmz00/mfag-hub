<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('auth_refresh_tokens', function (Blueprint $table): void {
            $table->string('session_key', 64)->nullable()->after('token_hash');
            $table->index(['user_id', 'session_key']);
        });
    }

    public function down(): void
    {
        Schema::table('auth_refresh_tokens', function (Blueprint $table): void {
            $table->dropIndex(['user_id', 'session_key']);
            $table->dropColumn('session_key');
        });
    }
};
