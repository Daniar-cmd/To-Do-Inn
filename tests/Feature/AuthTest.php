<?php

namespace Tests\Feature;

use App\Models\Board;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\DatabaseTestCase;

class AuthTest extends DatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withSession(['_token' => str_repeat('a', 40)]);
    }

    public function test_anonymous_session_exposes_only_the_csrf_token_and_null_user(): void
    {
        $response = $this->getAuth()->assertOk()->assertExactJson([
            'success' => true,
            'data' => ['csrf_token' => str_repeat('a', 40), 'user' => null],
        ])->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertCookie('todo_inn_laravel_session')
            ->assertCookieMissing('PHPSESSID')
            ->assertCookieMissing('XSRF-TOKEN');

        $cookie = $response->getCookie('todo_inn_laravel_session');
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', $cookie->getSameSite());
        $this->getAuth()->assertJsonPath('data.csrf_token', $response->json('data.csrf_token'));
    }

    public function test_registration_creates_a_user_and_one_default_board_then_logs_in(): void
    {
        $oldId = $this->app['session.store']->getId();
        $oldToken = $this->app['session.store']->token();
        $response = $this->postAuth($this->registration())
            ->assertCreated()
            ->assertJsonStructure(['success', 'data' => ['user' => ['id', 'username', 'account_type']]])
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        $user = User::findOrFail($response->json('data.user.id'));
        $this->assertSame('NewUser', $user->username);
        $this->assertNull($user->email);
        $this->assertSame('individual', $user->account_type);
        $this->assertTrue(Hash::check('Password123', $user->getAuthPassword()));
        $this->assertSame('argon2id', password_get_info($user->getAuthPassword())['algoName']);
        $this->assertSame(1, $user->boards()->count());
        $this->assertSame('👋 Hello World!', $user->boards()->first()->name);
        $this->assertTrue($user->boards()->first()->is_default);
        $this->assertNotSame($oldId, $this->app['session.store']->getId());
        $this->assertNotSame($oldToken, $this->app['session.store']->token());

        $this->getAuth()->assertJsonPath('data.user', $response->json('data.user'));
        $this->assertSame(['id', 'username', 'account_type'], array_keys($response->json('data.user')));
    }

    public function test_optional_email_and_account_type_defaults_match_the_legacy_api(): void
    {
        $response = $this->postAuth($this->registration(['email' => null, 'account_type' => null]))->assertCreated();
        $user = User::findOrFail($response->json('data.user.id'));

        $this->assertNull($user->email);
        $this->assertSame('individual', $user->account_type);
    }

    public function test_registration_normalizes_email_and_keeps_the_selected_account_type(): void
    {
        $response = $this->postAuth($this->registration([
            'email' => 'Person@Example.COM', 'account_type' => 'team', 'id' => 0, 'is_admin' => true,
        ]))->assertCreated();
        $user = User::findOrFail($response->json('data.user.id'));

        $this->assertSame('person@example.com', $user->email);
        $this->assertSame('team', $user->account_type);
        $this->assertFalse(array_key_exists('is_admin', $user->getAttributes()));
        $this->assertGreaterThan(0, $user->id);
    }

    #[DataProvider('invalidRegistrationFields')]
    public function test_invalid_registration_input_is_rejected_without_partial_rows(array $changes): void
    {
        $users = User::count();
        $boards = Board::count();

        $this->postAuth($this->registration($changes))
            ->assertUnprocessable()
            ->assertJsonPath('success', false)
            ->assertJsonStructure(['error']);

        $this->assertSame($users, User::count());
        $this->assertSame($boards, Board::count());
        $this->assertGuest();
    }

    public static function invalidRegistrationFields(): array
    {
        return [
            'short username' => [['username' => 'ab']],
            'long username' => [['username' => str_repeat('a', 25)]],
            'username whitespace not trimmed' => [['username' => ' NewUser ']],
            'non-string username' => [['username' => ['NewUser']]],
            'non-latin username' => [['username' => 'Новый']],
            'short password' => [['password' => 'Ab12', 'confirm_password' => 'Ab12']],
            'long password' => [['password' => str_repeat('a', 128).'1', 'confirm_password' => str_repeat('a', 128).'1']],
            'non-string password' => [['password' => ['Password123']]],
            'no password digit' => [['password' => 'Password', 'confirm_password' => 'Password']],
            'no password letter' => [['password' => '123456', 'confirm_password' => '123456']],
            'password whitespace' => [['password' => 'Pass 123', 'confirm_password' => 'Pass 123']],
            'non-ascii password' => [['password' => 'Пароль123', 'confirm_password' => 'Пароль123']],
            'confirmation mismatch' => [['confirm_password' => 'Another123']],
            'confirmation not trimmed' => [['confirm_password' => 'Password123 ']],
            'non-string confirmation' => [['confirm_password' => true]],
            'bad email' => [['email' => 'not-an-email']],
            'email whitespace not trimmed' => [['email' => ' person@example.com ']],
            'non-string email' => [['email' => ['person@example.com']]],
            'invalid account type' => [['account_type' => 'admin']],
            'empty account type' => [['account_type' => '']],
        ];
    }

    public function test_duplicate_username_is_a_conflict_with_no_extra_board(): void
    {
        $user = $this->createUser();
        $boards = Board::count();

        $this->postAuth($this->registration(['username' => $user->username]))
            ->assertConflict()
            ->assertExactJson(['success' => false, 'error' => 'Логин или e-mail уже используется.']);

        $this->assertSame($boards, Board::count());
        $this->assertGuest();
    }

    public function test_duplicate_normalized_email_is_a_conflict(): void
    {
        $user = $this->createUser();
        $user->update(['email' => 'person@example.com']);

        $this->postAuth($this->registration(['email' => 'PERSON@EXAMPLE.COM']))->assertConflict();
        $this->assertFalse(User::where('username', 'NewUser')->exists());
    }

    public function test_failure_to_create_the_default_board_rolls_back_the_user(): void
    {
        Board::creating(fn () => throw new RuntimeException('Private board creation error'));

        $this->postAuth($this->registration())
            ->assertStatus(500)
            ->assertExactJson(['success' => false, 'error' => 'Не удалось выполнить запрос. Попробуйте позже.']);

        $this->assertFalse(User::where('username', 'NewUser')->exists());
        $this->getAuth()->assertJsonPath('data.user', null);
    }

    public function test_a_128_character_password_is_not_truncated_at_72_bytes(): void
    {
        $password = str_repeat('a', 127).'1';
        $response = $this->postAuth($this->registration(['password' => $password, 'confirm_password' => $password]))->assertCreated();
        $user = User::findOrFail($response->json('data.user.id'));

        $this->assertTrue(Hash::check($password, $user->getAuthPassword()));
        $this->assertFalse(Hash::check(str_repeat('a', 127).'2', $user->getAuthPassword()));

        $this->postAuth(['action' => 'logout'])->assertOk();
        $this->postAuth(['action' => 'login', 'username' => $user->username, 'password' => $password])->assertOk();
    }

    public function test_a_password_that_looks_like_a_hash_is_hashed_as_plain_input(): void
    {
        $password = password_hash('SomeOther123', PASSWORD_BCRYPT, ['cost' => 4]);
        $response = $this->postAuth($this->registration(['password' => $password, 'confirm_password' => $password]))->assertCreated();
        $stored = User::findOrFail($response->json('data.user.id'))->getAuthPassword();

        $this->assertNotSame($password, $stored);
        $this->assertTrue(Hash::check($password, $stored));
        $this->assertFalse(Hash::check('SomeOther123', $stored));
    }

    public function test_login_accepts_an_existing_bcrypt_hash_without_rewriting_it(): void
    {
        $hash = password_hash('OldPassword123', PASSWORD_BCRYPT, ['cost' => 6]);
        $id = DB::table('users')->insertGetId(['username' => 'OldUser', 'password_hash' => $hash]);
        $oldId = $this->app['session.store']->getId();
        $oldToken = $this->app['session.store']->token();

        $this->postAuth(['action' => 'login', 'username' => 'OldUser', 'password' => 'OldPassword123'])
            ->assertOk()->assertExactJson([
                'success' => true,
                'data' => ['user' => ['id' => $id, 'username' => 'OldUser', 'account_type' => 'individual']],
            ]);

        $this->assertSame($hash, DB::table('users')->where('id', $id)->value('password_hash'));
        $this->assertNotSame($oldId, $this->app['session.store']->getId());
        $this->assertNotSame($oldToken, $this->app['session.store']->token());
        $this->getAuth()->assertJsonPath('data.user.id', $id);
    }

    public function test_wrong_password_and_unknown_user_have_the_same_error(): void
    {
        $user = $this->createUser();
        foreach ([$user->username, 'NoSuchUser'] as $username) {
            $this->postAuth(['action' => 'login', 'username' => $username, 'password' => 'WrongPassword123'])
                ->assertUnauthorized()
                ->assertExactJson(['success' => false, 'error' => 'Неверный логин или пароль.']);
        }
        $this->assertGuest();
    }

    #[DataProvider('invalidLoginFields')]
    public function test_login_rejects_missing_empty_or_non_string_credentials(array $credentials): void
    {
        $this->postAuth(['action' => 'login', ...$credentials])->assertUnprocessable();
        $this->assertGuest();
    }

    public static function invalidLoginFields(): array
    {
        return [
            'missing' => [[]],
            'empty username' => [['username' => '', 'password' => 'Password123']],
            'array username' => [['username' => ['Name'], 'password' => 'Password123']],
            'empty password' => [['username' => 'Name', 'password' => '']],
            'non-string password' => [['username' => 'Name', 'password' => true]],
        ];
    }

    public function test_login_does_not_silently_trim_credentials(): void
    {
        $user = $this->createUser();
        $this->postAuth(['action' => 'login', 'username' => ' '.$user->username, 'password' => 'TestPassword123'])->assertUnauthorized();
        $this->postAuth(['action' => 'login', 'username' => $user->username, 'password' => 'TestPassword123 '])->assertUnauthorized();
        $this->postAuth(['action' => 'login', 'username' => ' ', 'password' => ' '])->assertUnauthorized();
    }

    public function test_logout_invalidates_the_session_and_old_csrf_token(): void
    {
        $user = $this->createUser();
        $this->postAuth(['action' => 'login', 'username' => $user->username, 'password' => 'TestPassword123'])->assertOk();
        $oldId = $this->app['session.store']->getId();
        $oldToken = $this->app['session.store']->token();
        $this->app['session.store']->put('private_extra', 'must be removed');

        $this->postAuth(['action' => 'logout'])->assertOk()->assertExactJson([
            'success' => true, 'data' => ['logged_out' => true],
        ]);

        $this->assertNotSame($oldId, $this->app['session.store']->getId());
        $this->assertNotSame($oldToken, $this->app['session.store']->token());
        $this->assertFalse($this->app['session.store']->has('private_extra'));
        $this->getAuth()->assertJsonPath('data.user', null);
        $this->postAuth(['action' => 'logout'], ['X-CSRF-TOKEN' => $oldToken])->assertForbidden();
    }

    public function test_a_native_php_session_user_field_does_not_authenticate_laravel(): void
    {
        $user = $this->createUser();
        $this->withSession(['user' => ['id' => $user->id, 'username' => $user->username]]);

        $this->getAuth()->assertOk()->assertJsonPath('data.user', null);
    }

    public function test_query_parameters_cannot_supply_missing_json_actions_or_credentials(): void
    {
        $this->postJson('/api/auth.php?action=logout', [], ['X-CSRF-TOKEN' => $this->app['session.store']->token()])
            ->assertBadRequest()->assertJsonPath('error', 'Unknown action');
    }

    #[DataProvider('invalidCsrfHeaders')]
    public function test_csrf_is_enforced_even_in_tests_and_for_same_origin_requests(array $headers): void
    {
        $count = User::count();
        $this->postJson('/api/auth.php', $this->registration(), $headers)
            ->assertForbidden()
            ->assertExactJson(['success' => false, 'error' => 'Session expired. Refresh the page and try again.']);

        $this->assertSame($count, User::count());
    }

    public static function invalidCsrfHeaders(): array
    {
        return [
            'missing' => [[]],
            'wrong token' => [['X-CSRF-TOKEN' => str_repeat('b', 40)]],
            'same-origin without token' => [['Sec-Fetch-Site' => 'same-origin']],
        ];
    }

    public function test_a_body_token_does_not_replace_the_required_header(): void
    {
        $this->postJson('/api/auth.php', ['action' => 'logout', '_token' => $this->app['session.store']->token()])->assertForbidden();
    }

    public function test_cross_origin_reads_are_not_granted_cors_access(): void
    {
        $this->withHeaders(['Origin' => 'https://untrusted.example'])->getAuth()
            ->assertOk()
            ->assertHeaderMissing('Access-Control-Allow-Origin')
            ->assertHeaderMissing('Access-Control-Allow-Credentials');
    }

    public function test_cors_preflight_does_not_bypass_the_legacy_method_policy(): void
    {
        $this->withHeaders([
            'Origin' => 'https://untrusted.example',
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type,x-csrf-token',
        ])->call('OPTIONS', '/api/auth.php')
            ->assertStatus(405)
            ->assertHeader('Allow', 'GET, POST')
            ->assertHeaderMissing('Access-Control-Allow-Origin');
    }

    public function test_unsupported_methods_return_405_with_the_legacy_allow_header(): void
    {
        foreach (['PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE'] as $method) {
            $this->call($method, '/api/auth.php')->assertStatus(405)->assertHeader('Allow', 'GET, POST');
        }
    }

    public function test_wrong_content_type_is_rejected_before_csrf(): void
    {
        $this->call('POST', '/api/auth.php', [], [], [], ['CONTENT_TYPE' => 'text/plain'], '{"action":"logout"}')
            ->assertStatus(415)->assertExactJson(['success' => false, 'error' => 'Expected a JSON request']);
    }

    #[DataProvider('invalidJsonBodies')]
    public function test_malformed_or_scalar_json_is_rejected_before_csrf(string $body): void
    {
        $this->call('POST', '/api/auth.php', [], [], [], ['CONTENT_TYPE' => 'application/json'], $body)
            ->assertBadRequest()->assertExactJson(['success' => false, 'error' => 'Invalid JSON request']);
    }

    public static function invalidJsonBodies(): array
    {
        return [
            'malformed' => ['{'],
            'empty body' => [''],
            'number' => ['42'],
            'boolean' => ['true'],
            'null' => ['null'],
            'string' => ['"login"'],
        ];
    }

    public function test_the_actual_body_size_is_bounded_even_if_content_length_is_small(): void
    {
        $this->call('POST', '/api/auth.php', [], [], [], [
            'CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => '1',
        ], str_repeat(' ', 8193))->assertStatus(413)->assertJsonPath('error', 'Request is too large');
    }

    public function test_an_exactly_8192_byte_json_body_and_content_type_parameters_are_supported(): void
    {
        $this->call('POST', '/api/auth.php', [], [], [], [
            'CONTENT_TYPE' => 'Application/Json; charset=UTF-8',
            'HTTP_X_CSRF_TOKEN' => $this->app['session.store']->token(),
        ], str_pad('{"action":"logout"}', 8192))->assertOk()->assertJsonPath('data.logged_out', true);
    }

    public function test_unknown_and_non_string_actions_are_bad_requests(): void
    {
        $this->postAuth(['action' => 'unknown'])->assertBadRequest()->assertJsonPath('error', 'Unknown action');
        $this->postAuth(['action' => ['login']])->assertBadRequest()->assertJsonPath('error', 'Invalid action');
    }

    private function registration(array $changes = []): array
    {
        return array_replace([
            'action' => 'register', 'username' => 'NewUser',
            'password' => 'Password123', 'confirm_password' => 'Password123',
        ], $changes);
    }

    private function getAuth(): TestResponse
    {
        Auth::forgetGuards();

        return $this->getJson('/api/auth.php');
    }

    private function postAuth(array $input, array $headers = []): TestResponse
    {
        Auth::forgetGuards();

        return $this->postJson('/api/auth.php', $input, [
            'X-CSRF-TOKEN' => $this->app['session.store']->token(), ...$headers,
        ]);
    }
}
