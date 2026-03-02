<?php

namespace App\Services\Auth;

class OtpService
{
    public function generateNumericOtp(int $length = 6): string
    {
        $max = (10 ** $length) - 1;
        $min = 10 ** ($length - 1);

        return (string) random_int($min, $max);
    }

    public function hash(string $email, string $otp, string $appKey): string
    {
        return hash('sha256', strtolower(trim($email)) . '|' . trim($otp) . '|' . $appKey);
    }
}
