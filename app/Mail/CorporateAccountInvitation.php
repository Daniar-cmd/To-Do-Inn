<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class CorporateAccountInvitation extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $organizationType,
        public readonly string $organizationName,
        public readonly string $role,
        public readonly string $invitationUrl,
        public readonly string $recipientName = '',
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Приглашение в корпоративный аккаунт — To Do Inn!');
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.corporate-account-invitation',
            text: 'emails.corporate-account-invitation-text',
            with: [
                'organizationLabel' => $this->organizationType.' «'.$this->organizationName.'»',
                'recipientName' => $this->recipientName,
                'logoPath' => base_path('logos/ToDo-Inn-logo-compact.png'),
            ],
        );
    }
}
