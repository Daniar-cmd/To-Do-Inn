<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\DatabaseTestCase;

class AuthRateLimitTest extends DatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withSession(['_token' => str_repeat('a', 40)]);
    }

    public function test_login_is_limited_by_username_and_ip_and_resets_after_a_minute(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->login()->assertUnauthorized();
        }

        $response = $this->login()->assertStatus(429)
            ->assertExactJson(['success' => false, 'error' => 'Слишком много запросов. Попробуйте позже.'])
            ->assertHeader('Retry-After');
        $this->assertGreaterThan(0, (int) $response->headers->get('Retry-After'));
        $this->assertLessThanOrEqual(60, (int) $response->headers->get('Retry-After'));

        $this->travel(61)->seconds();
        $this->login()->assertUnauthorized();
    }

    public function test_changing_username_case_or_session_does_not_reset_the_limit(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->login('NoSuchUser')->assertUnauthorized();
        }

        $this->app['session.store']->invalidate();
        $this->app['session.store']->regenerateToken();
        $this->login('NOSUCHUSER')->assertStatus(429);
    }

    public function test_rotating_usernames_cannot_bypass_the_per_ip_limit(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->login('MissingUser'.$i)->assertUnauthorized();
        }

        $this->login('YetAnotherUser')->assertStatus(429);
    }

    public function test_spoofed_forwarded_ip_headers_are_not_trusted(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->login()->assertUnauthorized();
        }

        $this->withHeaders(['X-Forwarded-For' => '203.0.113.10', 'CF-Connecting-IP' => '203.0.113.11']);
        $this->login()->assertStatus(429);
    }

    public function test_registration_attempts_have_an_hourly_limit(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->invalidRegistration()->assertUnprocessable();
        }

        $this->invalidRegistration()->assertStatus(429)->assertHeader('Retry-After');
        $this->travel(3601)->seconds();
        $this->invalidRegistration()->assertUnprocessable();
    }

    public function test_verification_email_resend_waits_a_minute(): void
    {
        Mail::fake();
        $email = 'code-'.bin2hex(random_bytes(5)).'@example.com';

        $this->sendVerificationCode($email)->assertOk();
        $this->sendVerificationCode($email)->assertStatus(429)->assertHeader('Retry-After');

        $this->travel(60)->seconds();
        $this->sendVerificationCode($email)->assertOk();
        Mail::assertSentTimes(\App\Mail\EmailVerificationCode::class, 2);
    }

    public function test_hourly_resets_do_not_bypass_the_daily_registration_limit(): void
    {
        for ($hour = 0; $hour < 4; $hour++) {
            for ($i = 0; $i < 5; $i++) {
                $this->invalidRegistration()->assertUnprocessable();
            }
            $this->travel(3601)->seconds();
        }

        $this->invalidRegistration()->assertStatus(429);
    }

    public function test_session_reads_also_have_a_per_ip_limit(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->getJson('/api/auth.php')->assertOk();
        }

        $this->getJson('/api/auth.php')->assertStatus(429);
    }

    public function test_a_login_specific_limit_does_not_prevent_logout(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->login()->assertUnauthorized();
        }
        $this->login()->assertStatus(429);

        $this->postJson('/api/auth.php', ['action' => 'logout'], [
            'X-CSRF-TOKEN' => $this->app['session.store']->token(),
        ])->assertOk()->assertJsonPath('data.logged_out', true);
    }

    private function login(string $username = 'NoSuchUser'): TestResponse
    {
        Auth::forgetGuards();

        return $this->postJson('/api/auth.php', [
            'action' => 'login', 'username' => $username, 'password' => 'WrongPassword123',
        ], ['X-CSRF-TOKEN' => $this->app['session.store']->token()]);
    }

    private function invalidRegistration(): TestResponse
    {
        return $this->postJson('/api/auth.php', ['action' => 'register', 'username' => '!'], [
            'X-CSRF-TOKEN' => $this->app['session.store']->token(),
        ]);
    }

    private function sendVerificationCode(string $email): TestResponse
    {
        return $this->postJson('/api/auth.php', [
            'action' => 'send_verification_code', 'email' => $email,
        ], ['X-CSRF-TOKEN' => $this->app['session.store']->token()]);
    }
}
