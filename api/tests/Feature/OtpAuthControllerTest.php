<?php

namespace Tests\Feature;

use App\Models\AuthRefreshToken;
use App\Models\LoginOtp;
use App\Models\User;
use App\Services\Auth\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class OtpAuthControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_request_otp_creates_code_for_active_user(): void
    {
        Mail::fake();
        $user = $this->createUser([
            'email' => 'agent@example.test',
            'fsc_code' => '12345',
            'is_active' => true,
        ]);

        $response = $this->postJson('/api/auth/request-otp', [
            'email' => 'agent@example.test',
            'fscCode' => '12345',
        ]);

        $response->assertOk()->assertJson([
            'sent' => true,
            'expiresIn' => 300,
        ]);
        $this->assertDatabaseHas('login_otps', [
            'user_id' => $user->id,
            'attempts' => 0,
        ]);
    }

    public function test_request_otp_rejects_invalid_or_inactive_user(): void
    {
        Mail::fake();
        $inactive = $this->createUser([
            'email' => 'inactive@example.test',
            'fsc_code' => '54321',
            'is_active' => false,
        ]);

        $response = $this->postJson('/api/auth/request-otp', [
            'email' => 'inactive@example.test',
            'fscCode' => '54321',
        ]);

        $response->assertStatus(403)->assertJson([
            'message' => 'Invalid email or FSC code.',
        ]);
        $this->assertDatabaseMissing('login_otps', [
            'user_id' => $inactive->id,
        ]);
    }

    public function test_request_otp_is_rate_limited_after_five_attempts(): void
    {
        $payload = [
            'email' => 'missing@example.test',
            'fscCode' => '11111',
        ];

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/request-otp', $payload)
                ->assertStatus(403);
        }

        $this->postJson('/api/auth/request-otp', $payload)
            ->assertStatus(429)
            ->assertJson([
                'message' => 'Too many attempts. Try again shortly.',
            ]);
    }

    public function test_verify_otp_issues_tokens_and_consumes_otp(): void
    {
        $otp = '123456';
        $user = $this->createUser([
            'email' => 'verify@example.test',
            'fsc_code' => '12345',
            'access_level' => 'editor',
            'nickname' => 'Verifier',
            'full_name' => 'Verify User',
            'is_active' => true,
        ]);
        $this->seedLoginOtp($user, $otp, 0, now()->addMinutes(5));

        $response = $this->postJson('/api/auth/verify-otp', [
            'email' => 'verify@example.test',
            'otp' => $otp,
        ]);

        $response->assertOk()->assertJsonStructure([
            'token',
            'refreshToken',
            'user' => ['id', 'email', 'accessLevel', 'nickname', 'fullName'],
        ]);
        $response->assertJson([
            'user' => [
                'id' => $user->id,
                'email' => 'verify@example.test',
                'accessLevel' => 'editor',
                'nickname' => 'Verifier',
                'fullName' => 'Verify User',
            ],
        ]);

        $this->assertDatabaseMissing('login_otps', ['user_id' => $user->id]);
        $this->assertDatabaseHas('auth_refresh_tokens', ['user_id' => $user->id]);
        $this->assertDatabaseCount('personal_access_tokens', 1);
    }

    public function test_verify_otp_rejects_expired_code_and_deletes_it(): void
    {
        $user = $this->createUser([
            'email' => 'expired@example.test',
            'fsc_code' => '12345',
        ]);
        $this->seedLoginOtp($user, '654321', 0, now()->subSecond());

        $response = $this->postJson('/api/auth/verify-otp', [
            'email' => 'expired@example.test',
            'otp' => '654321',
        ]);

        $response->assertStatus(403)->assertJson([
            'message' => 'OTP expired.',
        ]);
        $this->assertDatabaseMissing('login_otps', ['user_id' => $user->id]);
    }

    public function test_verify_otp_increments_attempts_for_invalid_code(): void
    {
        $user = $this->createUser([
            'email' => 'invalid-otp@example.test',
            'fsc_code' => '12345',
        ]);
        $this->seedLoginOtp($user, '111111', 0, now()->addMinutes(5));

        $response = $this->postJson('/api/auth/verify-otp', [
            'email' => 'invalid-otp@example.test',
            'otp' => '222222',
        ]);

        $response->assertStatus(403)->assertJson([
            'message' => 'Invalid OTP.',
        ]);
        $this->assertDatabaseHas('login_otps', [
            'user_id' => $user->id,
            'attempts' => 1,
        ]);
    }

    public function test_verify_otp_rejects_when_attempt_limit_reached(): void
    {
        $user = $this->createUser([
            'email' => 'attempts@example.test',
            'fsc_code' => '12345',
        ]);
        $this->seedLoginOtp($user, '333333', 5, now()->addMinutes(5));

        $response = $this->postJson('/api/auth/verify-otp', [
            'email' => 'attempts@example.test',
            'otp' => '333333',
        ]);

        $response->assertStatus(429)->assertJson([
            'message' => 'Too many attempts.',
        ]);
    }

    public function test_refresh_rotates_refresh_token_for_active_user(): void
    {
        $user = $this->createUser([
            'email' => 'refresh@example.test',
            'fsc_code' => '12345',
            'access_level' => 'admin',
        ]);
        $incoming = str_repeat('r', 96);
        $row = AuthRefreshToken::query()->create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $incoming),
            'expires_at' => now()->addDays(3),
            'last_used_at' => null,
            'revoked_at' => null,
        ]);

        $response = $this->postJson('/api/auth/refresh', [
            'refreshToken' => $incoming,
        ]);

        $response->assertOk()->assertJsonStructure([
            'token',
            'refreshToken',
            'user' => ['id', 'email', 'accessLevel'],
        ]);
        $response->assertJson([
            'user' => [
                'id' => $user->id,
                'email' => 'refresh@example.test',
                'accessLevel' => 'admin',
            ],
        ]);

        $row->refresh();
        $this->assertNotNull($row->last_used_at);
        $this->assertNotNull($row->revoked_at);
        $this->assertSame(1, AuthRefreshToken::query()->where('user_id', $user->id)->whereNull('revoked_at')->count());
    }

    public function test_refresh_rejects_expired_token_and_revokes_row(): void
    {
        $user = $this->createUser([
            'email' => 'refresh-expired@example.test',
            'fsc_code' => '12345',
        ]);
        $incoming = str_repeat('e', 96);
        $row = AuthRefreshToken::query()->create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $incoming),
            'expires_at' => now()->subMinute(),
            'last_used_at' => null,
            'revoked_at' => null,
        ]);

        $response = $this->postJson('/api/auth/refresh', [
            'refreshToken' => $incoming,
        ]);

        $response->assertStatus(401)->assertJson([
            'message' => 'Refresh token expired.',
        ]);
        $row->refresh();
        $this->assertNotNull($row->revoked_at);
    }

    public function test_me_and_logout_with_real_bearer_token(): void
    {
        $otp = '222222';
        $user = $this->createUser([
            'email' => 'flow@example.test',
            'fsc_code' => '12345',
            'access_level' => 'standard',
            'nickname' => 'Flow',
            'full_name' => 'Flow User',
        ]);
        $this->seedLoginOtp($user, $otp, 0, now()->addMinutes(5));

        $verify = $this->postJson('/api/auth/verify-otp', [
            'email' => 'flow@example.test',
            'otp' => $otp,
        ]);
        $verify->assertOk();
        $token = (string) $verify->json('token');

        $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJson([
                'id' => $user->id,
                'email' => 'flow@example.test',
                'accessLevel' => 'standard',
                'nickname' => 'Flow',
                'fullName' => 'Flow User',
            ]);

        $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/auth/logout')
            ->assertOk()
            ->assertJson(['success' => true]);

        $this->assertSame(
            0,
            AuthRefreshToken::query()->where('user_id', $user->id)->whereNull('revoked_at')->count()
        );
    }

    public function test_me_requires_authentication(): void
    {
        $this->getJson('/api/auth/me')
            ->assertStatus(401)
            ->assertJson(['message' => 'Unauthenticated.']);
    }

    private function createUser(array $overrides = []): User
    {
        static $counter = 1;
        $index = $counter++;

        return User::query()->create([
            'email' => $overrides['email'] ?? sprintf('user%02d@example.test', $index),
            'fsc_code' => $overrides['fsc_code'] ?? sprintf('%05d', $index),
            'access_level' => $overrides['access_level'] ?? 'standard',
            'agency_id' => $overrides['agency_id'] ?? null,
            'nickname' => $overrides['nickname'] ?? sprintf('User%02d', $index),
            'full_name' => $overrides['full_name'] ?? sprintf('Test User %02d', $index),
            'birth_date' => $overrides['birth_date'] ?? null,
            'contract_date' => $overrides['contract_date'] ?? null,
            'is_active' => $overrides['is_active'] ?? true,
        ]);
    }

    private function seedLoginOtp(User $user, string $otp, int $attempts, \DateTimeInterface $expiresAt): void
    {
        $appKey = (string) config('app.key');
        $hash = app(OtpService::class)->hash($user->email, $otp, $appKey);

        LoginOtp::query()->updateOrCreate(
            ['user_id' => $user->id],
            [
                'otp_hash' => $hash,
                'attempts' => $attempts,
                'expires_at' => $expiresAt,
            ]
        );
    }
}
