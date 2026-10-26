<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use Tests\DatabaseTestCase;

class ProfileRateLimitTest extends DatabaseTestCase
{
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = $this->createUser();
        $this->withSession(['_token' => str_repeat('a', 40)]);
        Auth::login($this->user);
        $this->withCredentials()->withCookie(config('session.cookie'), $this->app['session.store']->getId());
    }

    public function test_profile_reads_have_a_per_ip_and_user_limit(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->getJson('/api/profile.php')->assertOk();
        }
        $this->getJson('/api/profile.php')->assertStatus(429)->assertHeader('Retry-After');
    }

    public function test_write_limits_cannot_be_bypassed_by_changing_ip(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.'.($i + 1)]);
            $this->postProfile()->assertOk();
        }
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.100']);
        $this->postProfile()->assertStatus(429)->assertHeader('Retry-After');
    }

    public function test_current_password_guesses_are_limited_per_account_across_ips_and_reset_after_one_minute(): void
    {
        $changes = [
            'current_password' => 'WrongPassword123', 'new_password' => 'NewPassword123', 'confirm_password' => 'NewPassword123',
        ];
        for ($i = 0; $i < 5; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.'.($i + 1)]);
            $this->postProfile($changes)->assertForbidden()->assertJsonPath('error', 'Текущий пароль указан неверно.');
        }
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.100']);
        $this->postProfile($changes)->assertStatus(429)->assertHeader('Retry-After');
        $this->assertTrue(Hash::check('TestPassword123', $this->user->fresh()->getAuthPassword()));

        $this->travel(61)->seconds();
        $this->postProfile($changes)->assertForbidden();
    }

    private function postProfile(array $changes = []): TestResponse
    {
        Auth::forgetGuards();

        return $this->postJson('/api/profile.php', array_replace([
            'username' => $this->user->username, 'account_type' => 'individual',
        ], $changes), ['X-CSRF-TOKEN' => $this->app['session.store']->token()]);
    }
}
