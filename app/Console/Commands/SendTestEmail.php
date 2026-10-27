<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Mail;

class SendTestEmail extends Command
{
    protected $signature = 'mail:test {recipient : Address to send the test email to}';

    protected $description = 'Send a plain-text test email using the configured mailer';

    public function handle(): int
    {
        $recipient = $this->argument('recipient');
        if (!is_string($recipient) || filter_var($recipient, FILTER_VALIDATE_EMAIL) === false) {
            $this->error('Provide a valid recipient email address.');

            return self::FAILURE;
        }

        try {
            Mail::raw('Это тестовое текстовое письмо из To Do Inn.', function ($message) use ($recipient): void {
                $message->to($recipient)->subject('Тестовое письмо To Do Inn');
            });
        } catch (\Throwable) {
            $this->error('Не удалось отправить письмо. Проверьте конфигурацию mailer и Resend.');

            return self::FAILURE;
        }

        $this->info('Письмо передано настроенному почтовому провайдеру.');

        return self::SUCCESS;
    }
}
