<?php

namespace Tests\Feature;

use App\Mail\EmailVerificationCode;
use InvalidArgumentException;
use Tests\TestCase;

class EmailVerificationCodeMailTest extends TestCase
{
    public function test_verification_email_has_a_plain_text_subject_and_code(): void
    {
        $mail = new EmailVerificationCode('042817');

        $mail->assertHasSubject('Код подтверждения — To Do Inn!')
            ->assertSeeInHtml('042817')
            ->assertSeeInHtml('Код действителен')
            ->assertSeeInText('To Do Inn!')
            ->assertSeeInText('042817')
            ->assertSeeInText('Код действителен 10 минут.')
            ->assertSeeInText('Если вы не запрашивали регистрацию');
    }

    public function test_verification_email_rejects_codes_that_are_not_six_digits(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new EmailVerificationCode('12345x');
    }
}
