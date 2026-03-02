<?php

namespace Tests\Feature;

use App\Models\AuthRateLimit;
use App\Models\LoginOtp;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthCleanupCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_cleanup_command_deletes_only_expired_rows(): void
    {
        $expiredUser = $this->createUser('expired@example.test');
        $activeUser = $this->createUser('active@example.test');

        LoginOtp::query()->create([
            'user_id' => $expiredUser->id,
            'otp_hash' => str_repeat('a', 128),
            'attempts' => 0,
            'expires_at' => now()->subMinute(),
        ]);

        LoginOtp::query()->create([
            'user_id' => $activeUser->id,
            'otp_hash' => str_repeat('b', 128),
            'attempts' => 0,
            'expires_at' => now()->addMinute(),
        ]);

        AuthRateLimit::query()->create([
            'bucket_key' => 'expired-bucket',
            'email' => 'expired@example.test',
            'ip_address' => '127.0.0.1',
            'action' => 'request-otp',
            'window_started_at' => now()->subMinutes(5),
            'expires_at' => now()->subMinute(),
            'count' => 5,
        ]);

        AuthRateLimit::query()->create([
            'bucket_key' => 'active-bucket',
            'email' => 'active@example.test',
            'ip_address' => '127.0.0.2',
            'action' => 'request-otp',
            'window_started_at' => now(),
            'expires_at' => now()->addMinute(),
            'count' => 1,
        ]);

        $this->artisan('auth:cleanup-expired')
            ->expectsOutput('Deleted 1 expired login OTPs and 1 expired rate-limit buckets.')
            ->assertSuccessful();

        $this->assertDatabaseMissing('login_otps', [
            'user_id' => $expiredUser->id,
        ]);
        $this->assertDatabaseHas('login_otps', [
            'user_id' => $activeUser->id,
        ]);
        $this->assertDatabaseMissing('auth_rate_limits', [
            'bucket_key' => 'expired-bucket',
        ]);
        $this->assertDatabaseHas('auth_rate_limits', [
            'bucket_key' => 'active-bucket',
        ]);
    }

    private function createUser(string $email): User
    {
        return User::query()->create([
            'email' => $email,
            'fsc_code' => '12345',
            'access_level' => 'standard',
            'is_active' => true,
        ]);
    }
}
