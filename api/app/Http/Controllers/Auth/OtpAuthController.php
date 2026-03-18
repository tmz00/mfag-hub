<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Mail\LoginOtpMail;
use App\Models\AuthRefreshToken;
use App\Models\LoginOtp;
use App\Models\User;
use App\Services\Auth\OtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

class OtpAuthController extends Controller
{
    private const OTP_EXPIRY_SECONDS = 300;
    private const OTP_MAX_ATTEMPTS = 5;
    private const REFRESH_TOKEN_DAYS = 30;

    public function __construct(private readonly OtpService $otpService) {}

    public function requestOtp(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'email' => ['required', 'email:rfc'],
            'fscCode' => ['required', 'digits:5'],
        ]);

        $email = strtolower(trim($payload['email']));
        $fscCode = trim($payload['fscCode']);
        $ip = (string) $request->ip();

        $this->rateLimitOrFail('request_otp', $ip, $email, 5, 120);

        $user = User::query()
            ->where('email', $email)
            ->where('fsc_code', $fscCode)
            ->where('is_active', true)
            ->first();

        if (!$user) {
            return response()->json(['message' => 'Invalid email or FSC code.'], 403);
        }

        $otp = $this->otpService->generateNumericOtp(6);
        $hash = $this->otpService->hash($email, $otp, (string) config('app.key'));
        $expiresAt = now()->addSeconds(self::OTP_EXPIRY_SECONDS);

        DB::transaction(function () use ($user, $hash, $expiresAt): void {
            LoginOtp::query()->updateOrCreate(
                ['user_id' => $user->id],
                [
                    'otp_hash' => $hash,
                    'attempts' => 0,
                    'expires_at' => $expiresAt,
                ]
            );
        });

        Mail::to($email)->send(new LoginOtpMail($otp));

        return response()->json([
            'sent' => true,
            'expiresIn' => self::OTP_EXPIRY_SECONDS,
        ]);
    }

    public function verifyOtp(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'email' => ['required', 'email:rfc'],
            'otp' => ['required', 'digits:6'],
        ]);

        $email = strtolower(trim($payload['email']));
        $otp = trim($payload['otp']);
        $ip = (string) $request->ip();

        $this->rateLimitOrFail('verify_otp', $ip, $email, 10, 300);

        $user = User::query()->where('email', $email)->where('is_active', true)->first();
        if (!$user) {
            return response()->json(['message' => 'Invalid OTP.'], 403);
        }

        $loginOtp = LoginOtp::query()->where('user_id', $user->id)->first();
        if (!$loginOtp) {
            return response()->json(['message' => 'Invalid OTP.'], 403);
        }

        if ($loginOtp->expires_at->isPast()) {
            $loginOtp->delete();
            return response()->json(['message' => 'OTP expired.'], 403);
        }

        if ($loginOtp->attempts >= self::OTP_MAX_ATTEMPTS) {
            return response()->json(['message' => 'Too many attempts.'], 429);
        }

        $incomingHash = $this->otpService->hash($email, $otp, (string) config('app.key'));
        if (!hash_equals($loginOtp->otp_hash, $incomingHash)) {
            $loginOtp->increment('attempts');
            return response()->json(['message' => 'Invalid OTP.'], 403);
        }

        $loginOtp->delete();
        $this->clearRateLimit('verify_otp', $ip, $email, 300);
        $issued = $this->issueSessionTokens($user);

        return response()->json([
            'token' => $issued['token'],
            'refreshToken' => $issued['refreshToken'],
            'user' => [
                'id' => $user->id,
                'email' => $user->email,
                'accessLevel' => $this->normalizeAccessLevel((string) $user->access_level),
                'nickname' => $user->nickname,
                'fullName' => $user->full_name,
            ],
        ]);
    }

    public function refresh(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'refreshToken' => ['required', 'string', 'min:20'],
        ]);

        $incoming = (string) $payload['refreshToken'];
        $hash = hash('sha256', $incoming);
        $result = DB::transaction(function () use ($hash): array {
            $row = AuthRefreshToken::query()
                ->where('token_hash', $hash)
                ->lockForUpdate()
                ->first();

            if (!$row || $row->revoked_at !== null) {
                return ['status' => 'expired'];
            }

            $now = now();
            if ($row->expires_at->isPast()) {
                $row->update(['revoked_at' => $now]);
                return ['status' => 'expired'];
            }

            $user = User::query()->where('id', $row->user_id)->where('is_active', true)->first();
            if (!$user) {
                $row->update(['revoked_at' => $now]);
                return ['status' => 'invalid'];
            }

            $existingSessionKey = trim((string) ($row->session_key ?? ''));
            $sessionKey = $this->resolveSessionKey($existingSessionKey);
            $row->update([
                'session_key' => $sessionKey,
                'last_used_at' => $now,
                'revoked_at' => $now,
            ]);

            if ($existingSessionKey === '') {
                $this->revokeLegacyAccessTokens($user);
            }
            $this->revokeSessionAccessTokens($user, $sessionKey);
            $issued = $this->issueSessionTokens($user, $sessionKey);

            return [
                'status' => 'ok',
                'token' => $issued['token'],
                'refreshToken' => $issued['refreshToken'],
                'user' => $user,
            ];
        });

        if (($result['status'] ?? 'expired') === 'expired') {
            return response()->json(['message' => 'Refresh token expired.'], 401);
        }

        if (($result['status'] ?? 'invalid') !== 'ok') {
            return response()->json(['message' => 'Refresh token invalid.'], 401);
        }
        /** @var User $user */
        $user = $result['user'];

        return response()->json([
            'token' => $result['token'],
            'refreshToken' => $result['refreshToken'],
            'user' => [
                'id' => $user->id,
                'email' => $user->email,
                'accessLevel' => $this->normalizeAccessLevel((string) $user->access_level),
                'nickname' => $user->nickname,
                'fullName' => $user->full_name,
            ],
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        $user->loadMissing('agency:id,code');

        return response()->json([
            'id' => $user->id,
            'email' => $user->email,
            'accessLevel' => $this->normalizeAccessLevel((string) $user->access_level),
            'agencyCode' => $user->agency?->code ?? '',
            'nickname' => $user->nickname,
            'fullName' => $user->full_name,
            'isActive' => $user->is_active,
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();
        $currentToken = $user?->currentAccessToken();
        $sessionKey = $this->sessionKeyFromTokenName((string) ($currentToken?->name ?? ''));
        $currentToken?->delete();
        if ($user) {
            if ($sessionKey !== '') {
                $now = now();
                AuthRefreshToken::query()
                    ->where('user_id', $user->id)
                    ->where('session_key', $sessionKey)
                    ->whereNull('revoked_at')
                    ->update(['revoked_at' => $now]);
                $this->revokeSessionAccessTokens($user, $sessionKey);
            } else {
                $now = now();
                AuthRefreshToken::query()
                    ->where('user_id', $user->id)
                    ->whereNull('revoked_at')
                    ->update(['revoked_at' => $now]);
                $this->revokeLegacyAccessTokens($user);
            }
        }

        return response()->json(['success' => true]);
    }

    private function normalizeAccessLevel(string $accessLevel): string
    {
        $normalized = strtolower(trim($accessLevel));
        if ($normalized === '') {
            return 'standard';
        }

        return $normalized;
    }

    /**
     * @return array{token: string, refreshToken: string}
     */
    private function issueSessionTokens(User $user, ?string $sessionKey = null): array
    {
        $resolvedSessionKey = $this->resolveSessionKey($sessionKey);
        $token = $user->createToken($this->sessionTokenName($resolvedSessionKey))->plainTextToken;

        $refreshPlain = Str::random(96);
        AuthRefreshToken::query()->create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $refreshPlain),
            'session_key' => $resolvedSessionKey,
            'expires_at' => now()->addDays(self::REFRESH_TOKEN_DAYS),
            'last_used_at' => null,
            'revoked_at' => null,
        ]);

        return [
            'token' => $token,
            'refreshToken' => $refreshPlain,
        ];
    }

    private function resolveSessionKey(?string $sessionKey = null): string
    {
        $value = trim((string) $sessionKey);

        return $value !== '' ? $value : (string) Str::uuid();
    }

    private function sessionTokenName(string $sessionKey): string
    {
        return 'api-login:' . $sessionKey;
    }

    private function sessionKeyFromTokenName(string $tokenName): string
    {
        $prefix = 'api-login:';
        if (!str_starts_with($tokenName, $prefix)) {
            return '';
        }

        return trim(substr($tokenName, strlen($prefix)));
    }

    private function revokeSessionAccessTokens(User $user, string $sessionKey): void
    {
        $user->tokens()
            ->where('name', $this->sessionTokenName($sessionKey))
            ->delete();
    }

    private function revokeLegacyAccessTokens(User $user): void
    {
        $user->tokens()
            ->where('name', 'api-login')
            ->delete();
    }

    private function rateLimitOrFail(
        string $action,
        string $ip,
        string $email,
        int $limit,
        int $windowSeconds
    ): void {
        $bucketKey = $this->rateLimitKey($action, $ip, $email, $windowSeconds);
        $attempts = RateLimiter::hit($bucketKey, $windowSeconds);

        if ($attempts > $limit) {
            abort(response()->json(['message' => 'Too many attempts. Try again shortly.'], 429));
        }
    }

    private function clearRateLimit(string $action, string $ip, string $email, int $windowSeconds): void
    {
        RateLimiter::clear($this->rateLimitKey($action, $ip, $email, $windowSeconds));
    }

    private function rateLimitKey(string $action, string $ip, string $email, int $windowSeconds): string
    {
        $timestamp = now()->getTimestamp();
        $windowStart = $timestamp - ($timestamp % $windowSeconds);

        return implode(':', [
            'auth',
            $action,
            $windowStart,
            hash('sha256', strtolower(trim($email)) . '|' . trim($ip)),
        ]);
    }
}
