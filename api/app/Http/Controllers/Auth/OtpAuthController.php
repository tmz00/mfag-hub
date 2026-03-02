<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\AuthRateLimit;
use App\Models\AuthRefreshToken;
use App\Models\LoginOtp;
use App\Models\User;
use App\Services\Auth\OtpService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class OtpAuthController extends Controller
{
    private const OTP_EXPIRY_SECONDS = 300;
    private const OTP_MAX_ATTEMPTS = 5;
    private const REFRESH_TOKEN_DAYS = 30;

    public function __construct(private readonly OtpService $otpService)
    {
    }

    public function requestOtp(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'email' => ['required', 'email:rfc'],
            'fscCode' => ['required', 'string', 'max:20'],
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

        Mail::raw(
            "Your MFAG Hub OTP is {$otp}. It expires in 5 minutes.",
            static function ($message) use ($email): void {
                $message->to($email)->subject('Your login OTP for MFAG Hub');
            }
        );

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
        [$token, $refreshToken] = $this->issueSessionTokens($user);

        return response()->json([
            'token' => $token,
            'refreshToken' => $refreshToken,
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
        $row = AuthRefreshToken::query()
            ->where('token_hash', $hash)
            ->whereNull('revoked_at')
            ->first();

        if (!$row || $row->expires_at->isPast()) {
            if ($row) {
                $row->update(['revoked_at' => now()]);
            }
            return response()->json(['message' => 'Refresh token expired.'], 401);
        }

        $user = User::query()->where('id', $row->user_id)->where('is_active', true)->first();
        if (!$user) {
            $row->update(['revoked_at' => now()]);
            return response()->json(['message' => 'Refresh token invalid.'], 401);
        }

        $row->update([
            'last_used_at' => now(),
            'revoked_at' => now(),
        ]);

        [$token, $newRefreshToken] = $this->issueSessionTokens($user);

        return response()->json([
            'token' => $token,
            'refreshToken' => $newRefreshToken,
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
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();
        $user?->currentAccessToken()?->delete();
        if ($user) {
            AuthRefreshToken::query()
                ->where('user_id', $user->id)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);
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

    private function issueSessionTokens(User $user): array
    {
        $token = $user->createToken('api-login')->plainTextToken;

        $refreshPlain = Str::random(96);
        AuthRefreshToken::query()->create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $refreshPlain),
            'expires_at' => now()->addDays(self::REFRESH_TOKEN_DAYS),
            'last_used_at' => null,
            'revoked_at' => null,
        ]);

        return [$token, $refreshPlain];
    }

    private function rateLimitOrFail(
        string $action,
        string $ip,
        string $email,
        int $limit,
        int $windowSeconds
    ): void {
        $now = CarbonImmutable::now();
        $windowStart = $now->timestamp - ($now->timestamp % $windowSeconds);
        $bucketKey = implode(':', [$action, $windowStart, strtolower($email), $ip]);

        $row = AuthRateLimit::query()->firstOrNew(['bucket_key' => $bucketKey]);
        if (!$row->exists) {
            $row->email = $email;
            $row->ip_address = $ip;
            $row->action = $action;
            $row->window_started_at = CarbonImmutable::createFromTimestamp($windowStart);
            $row->expires_at = CarbonImmutable::createFromTimestamp($windowStart + $windowSeconds);
            $row->count = 0;
        }

        if ($row->count >= $limit) {
            abort(response()->json(['message' => 'Too many attempts. Try again shortly.'], 429));
        }

        $row->count += 1;
        $row->save();
    }
}
