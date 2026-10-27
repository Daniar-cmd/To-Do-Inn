<?php

namespace Tests\Feature;

use App\Mail\CorporateAccountInvitation;
use Tests\TestCase;

class CorporateAccountInvitationMailTest extends TestCase
{
    public function test_invitation_email_shows_the_full_organization_name_and_role(): void
    {
        $mail = new CorporateAccountInvitation(
            'ООО',
            'Яблоко',
            'manager',
            'https://example.test/pages/corporate-invitation.html?token=test-token',
            'Данияр Рафаилевич',
        );

        $mail->assertHasSubject('Приглашение в корпоративный аккаунт — To Do Inn!')
            ->assertSeeInHtml('ООО «Яблоко»')
            ->assertSeeInHtml('Менеджер')
            ->assertSeeInHtml('Здравствуйте Данияр Рафаилевич!')
            ->assertSeeInHtml('Принять приглашение')
            ->assertSeeInText('ООО «Яблоко»')
            ->assertSeeInText('7 дней');
    }
}
