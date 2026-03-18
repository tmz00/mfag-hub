<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class LoginOtpMail extends Mailable
{
    use Queueable;
    use SerializesModels;

    public function __construct(
        public readonly string $otp,
        public readonly int $expiresInMinutes = 5
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Your login OTP for MFAG Hub',
        );
    }

    public function content(): Content
    {
        return new Content(
            text: 'emails.auth.login-otp',
        );
    }
}
