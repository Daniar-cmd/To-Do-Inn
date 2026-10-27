<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

class PasswordResetLink extends Mailable
{
    public function __construct(public readonly string $resetUrl, public readonly string $recipientName = '')
    {
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Восстановление пароля — To Do Inn!');
    }

    public function content(): Content
    {
        return new Content(
            html: 'emails.password-reset-html',
            text: 'emails.password-reset',
            with: [
                'resetUrl' => $this->resetUrl,
                'recipientName' => $this->recipientName,
                'logoPath' => base_path('logos/ToDo-Inn-logo-compact.png'),
            ],
        );
    }
}
