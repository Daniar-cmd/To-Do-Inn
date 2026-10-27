<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use InvalidArgumentException;

class EmailVerificationCode extends Mailable
{
    public function __construct(public readonly string $code, public readonly string $recipientName = '')
    {
        if (!preg_match('/^[0-9]{6}$/D', $code)) {
            throw new InvalidArgumentException('Verification codes must contain exactly six digits.');
        }
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Код подтверждения — To Do Inn!');
    }

    public function content(): Content
    {
        return new Content(
            html: 'emails.verification-code-html',
            text: 'emails.verification-code',
            with: [
                'logoPath' => base_path('logos/ToDo-Inn-logo-compact.png'),
                'recipientName' => $this->recipientName,
            ],
        );
    }
}
