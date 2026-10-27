<?php

namespace Tests\Feature;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\DatabaseTestCase;

class ProfileTest extends DatabaseTestCase
{
    private User $user;

    private const JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A5qiiivrD54//2Q==';

    private const WEBP = 'UklGRjoAAABXRUJQVlA4IC4AAADwAQCdASoBAAEAAUAmJaACdLoB+AAEgwAA/vAb3/89M15g/yc/+Uq8Fjc3wAAA';

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = $this->createUser();
        $this->withSession(['_token' => str_repeat('a', 40)]);
        Auth::login($this->user);
    }

    public function test_get_returns_the_existing_profile_contract_without_credentials_or_raw_bytes(): void
    {
        $this->getProfile()->assertOk()->assertExactJson([
            'success' => true,
            'data' => ['profile' => [
                'id' => $this->user->id,
                'username' => $this->user->username,
                'email' => null,
                'secondary_email' => null,
                'account_type' => 'individual',
                'about' => '',
                'github_url' => null,
                'telegram_url' => null,
                'preferred_theme' => 'system',
                'username_changed_at' => null,
                'username_change_available_at' => null,
                'avatar' => null,
            ]],
        ])->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_guests_receive_json_401_before_method_csrf_or_body_checks(): void
    {
        Auth::logout();
        $this->app['session.store']->invalidate();
        Auth::forgetGuards();

        foreach (['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'] as $method) {
            $response = $this->rawProfile($method, '{')->assertUnauthorized()->assertHeaderMissing('Location');
            if ($method !== 'HEAD') {
                $response->assertExactJson(['success' => false, 'error' => 'Требуется войти в аккаунт.']);
            }
        }
    }

    public function test_a_deleted_account_cannot_read_or_save_a_profile(): void
    {
        $this->user->delete();

        $this->getProfile()->assertUnauthorized();
        $this->postJson('/api/profile.php', [], ['X-CSRF-TOKEN' => $this->token()])->assertUnauthorized();
    }

    public function test_profile_fields_are_normalized_but_password_hash_session_and_csrf_are_preserved(): void
    {
        $hash = password_hash('LegacyPassword123', PASSWORD_BCRYPT, ['cost' => 4]);
        DB::table('users')->where('id', $this->user->id)->update(['password_hash' => $hash]);
        $id = $this->app['session.store']->getId();
        $token = $this->token();

        $this->postProfile([
            'username' => ' '.$this->user->username.' ',
            'email' => ' Person@Example.COM ', 'secondary_email' => ' Backup@Example.COM ',
            'about' => ' Привет 👋 ', 'account_type' => 'corporate',
            'github_url' => 'https://github.com/profile-user', 'preferred_theme' => 'dark',
            'telegram_url' => 'https://t.me/profile_user',
        ])->assertOk()->assertJsonPath('data.profile.email', 'person@example.com')
            ->assertJsonPath('data.profile.secondary_email', 'backup@example.com')
            ->assertJsonPath('data.profile.about', 'Привет 👋')
            ->assertJsonPath('data.profile.github_url', 'https://github.com/profile-user')
            ->assertJsonPath('data.profile.telegram_url', 'https://t.me/profile_user')
            ->assertJsonPath('data.profile.preferred_theme', 'dark')
            ->assertJsonPath('data.profile.account_type', 'corporate')
            ->assertJsonPath('data.profile.username_changed_at', null);

        $this->assertSame($hash, $this->user->fresh()->getAuthPassword());
        $this->assertSame($id, $this->app['session.store']->getId());
        $this->assertSame($token, $this->token());
        Auth::forgetGuards();
        $this->getJson('/api/auth.php')->assertJsonPath('data.user.account_type', 'corporate');
    }

    public function test_empty_or_null_optional_fields_become_the_legacy_defaults(): void
    {
        $this->user->update(['email' => 'person@example.com', 'secondary_email' => 'backup@example.com', 'about' => 'Old']);

        $this->postProfile([
            'email' => null, 'secondary_email' => '  ', 'about' => null,
            'current_password' => null, 'new_password' => null, 'confirm_password' => null,
        ])->assertOk()->assertJsonPath('data.profile.email', null)
            ->assertJsonPath('data.profile.secondary_email', null)
            ->assertJsonPath('data.profile.about', '');
    }

    #[DataProvider('invalidFields')]
    public function test_invalid_profile_fields_return_422_without_saving_other_changes(array $changes): void
    {
        $before = $this->state($this->user->id);
        $this->postProfile($changes)->assertUnprocessable()->assertJsonPath('success', false);
        $this->assertSame($before, $this->state($this->user->id));
    }

    public static function invalidFields(): array
    {
        return [
            'short username' => [['username' => 'ab']],
            'three-character username' => [['username' => 'abc']],
            'long username' => [['username' => str_repeat('a', 25)]],
            'username type' => [['username' => ['Name']]],
            'username null' => [['username' => null]],
            'unicode username' => [['username' => 'Новый']],
            'numeric username' => [['username' => '12345']],
            'email type' => [['email' => ['person@example.com']]],
            'bad email' => [['email' => 'not-an-email']],
            'long email' => [['email' => str_repeat('a', 250).'@example.com']],
            'secondary email type' => [['secondary_email' => true]],
            'bad secondary email' => [['secondary_email' => 'not-an-email']],
            'same normalized emails' => [['email' => ' Person@Example.COM ', 'secondary_email' => 'PERSON@example.com']],
            'about type' => [['about' => ['text']]],
            'about character limit' => [['about' => str_repeat('я', 1201)]],
            'about limit before trimming' => [['about' => ' '.str_repeat('a', 1200)]],
            'invalid GitHub URL' => [['github_url' => 'javascript:alert(1)']],
            'invalid Telegram URL' => [['telegram_url' => 'https://t.me/a']],
            'invalid preferred theme' => [['preferred_theme' => 'auto']],
            'invalid account type' => [['account_type' => 'admin']],
            'empty account type' => [['account_type' => '']],
            'null account type' => [['account_type' => null]],
        ];
    }

    public function test_the_about_limit_counts_unicode_characters_not_bytes(): void
    {
        $about = str_repeat('я', 1200);
        $this->postProfile(['about' => $about])->assertOk()->assertJsonPath('data.profile.about', $about);
    }

    public function test_validation_messages_remain_compatible_with_the_legacy_profile(): void
    {
        $this->postProfile(['username' => 'ab'])
            ->assertUnprocessable()->assertJsonPath('error', 'Проверьте логин и остальные данные профиля.');
        $this->postProfile(['email' => []])
            ->assertUnprocessable()->assertJsonPath('error', 'Проверьте логин и остальные данные профиля.');
        $this->postProfile(['email' => 'not-an-email'])
            ->assertUnprocessable()->assertJsonPath('error', 'Проверьте формат электронной почты.');
        $this->postProfile(['email' => 'Same@Example.com', 'secondary_email' => 'same@example.com'])
            ->assertUnprocessable()->assertJsonPath('error', 'Основная и дополнительная почта должны различаться.');
    }

    public function test_a_rename_updates_auth_and_exposes_the_next_allowed_time(): void
    {
        $response = $this->postProfile(['username' => 'RenamedUser'])->assertOk()
            ->assertJsonPath('data.profile.username', 'RenamedUser');
        $changed = CarbonImmutable::parse($response->json('data.profile.username_changed_at'));
        $available = CarbonImmutable::parse($response->json('data.profile.username_change_available_at'));
        $this->assertSame(86400, $available->getTimestamp() - $changed->getTimestamp());

        Auth::forgetGuards();
        $this->getJson('/api/auth.php')->assertJsonPath('data.user.username', 'RenamedUser');
        $this->postProfile(['username' => 'AnotherName', 'about' => 'Must not be saved'])
            ->assertStatus(429)->assertJsonPath('error', 'Логин можно менять не чаще одного раза в 24 часа.');
        $this->assertSame('RenamedUser', $this->user->fresh()->username);
        $this->assertSame('', $this->user->fresh()->about);

        $this->postProfile(['about' => 'A permitted change'])->assertOk()
            ->assertJsonPath('data.profile.username_changed_at', $response->json('data.profile.username_changed_at'));
    }

    #[DataProvider('renameWindows')]
    public function test_rename_eligibility_uses_a_full_24_hour_window(int $secondsAgo, int $status): void
    {
        $clock = CarbonImmutable::now()->startOfSecond();
        $this->travelTo($clock);
        DB::table('users')->where('id', $this->user->id)->update([
            'username_changed_at' => $clock->subSeconds($secondsAgo)->format('Y-m-d H:i:s.uP'),
        ]);

        $this->postProfile(['username' => 'NextName'])->assertStatus($status);
    }

    public static function renameWindows(): array
    {
        return [
            'one second too early' => [86399, 429],
            'exactly 24 hours' => [86400, 200],
            'more than 24 hours' => [86401, 200],
        ];
    }

    public function test_duplicate_username_rolls_back_every_profile_field_password_and_avatar(): void
    {
        $other = $this->createUser();
        $before = $this->state($this->user->id);

        $this->postProfile([
            'username' => $other->username, 'about' => 'Must roll back',
            'current_password' => 'TestPassword123', 'new_password' => 'NewPassword123', 'confirm_password' => 'NewPassword123',
            'avatar' => 'data:image/png;base64,'.base64_encode(self::png()),
        ])->assertConflict()->assertJsonPath('error', 'Логин или электронная почта уже используются.');

        $this->assertSame($before, $this->state($this->user->id));
    }

    public function test_primary_and_secondary_email_conflicts_are_409_and_atomic(): void
    {
        $other = $this->createUser();
        $other->update(['email' => 'person@example.com', 'secondary_email' => 'backup@example.com']);
        $before = $this->state($this->user->id);

        $this->postProfile(['email' => 'PERSON@EXAMPLE.COM', 'about' => 'Must roll back'])->assertConflict();
        $this->assertSame($before, $this->state($this->user->id));
        $this->postProfile(['secondary_email' => 'BACKUP@EXAMPLE.COM', 'about' => 'Must roll back'])->assertConflict();
        $this->assertSame($before, $this->state($this->user->id));
    }

    public function test_failure_after_the_avatar_write_rolls_back_the_entire_profile_and_exposes_no_details(): void
    {
        $before = $this->state($this->user->id);
        DB::listen(function ($query): void {
            if (str_contains($query->sql, 'SET avatar_data = decode')) {
                throw new RuntimeException('Private storage path and SQL details');
            }
        });

        $this->postProfile([
            'username' => 'RolledBackName', 'email' => 'changed@example.com', 'about' => 'Must roll back',
            'current_password' => 'TestPassword123', 'new_password' => 'NewPassword123', 'confirm_password' => 'NewPassword123',
            'avatar' => 'data:image/png;base64,'.base64_encode(self::png()),
        ])->assertStatus(500)->assertExactJson([
            'success' => false, 'error' => 'Не удалось сохранить профиль. Попробуйте позже.',
        ]);

        $this->assertSame($before, $this->state($this->user->id));
    }

    public function test_client_ids_and_private_columns_cannot_target_another_user_or_bypass_whitelisting(): void
    {
        $other = $this->createUser();
        $before = $this->state($other->id);
        $hash = $this->user->getAuthPassword();

        $this->postProfile([
            'id' => $other->id, 'user_id' => $other->id, 'about' => 'Only my profile',
            'password_hash' => 'unsafe', 'avatar_data' => 'unsafe', 'avatar_mime' => 'image/svg+xml',
            'username_changed_at' => '2000-01-01',
        ], '?id='.$other->id)->assertOk()->assertJsonPath('data.profile.id', $this->user->id)
            ->assertJsonPath('data.profile.avatar', null)
            ->assertJsonPath('data.profile.username_changed_at', null);

        $this->assertSame($before, $this->state($other->id));
        $this->assertSame($hash, $this->user->fresh()->getAuthPassword());
        $this->getProfile('?id='.$other->id)->assertJsonPath('data.profile.id', $this->user->id);
    }

    public function test_password_change_requires_the_current_password_and_preserves_the_session_contract(): void
    {
        $oldHash = password_hash('LegacyPassword123', PASSWORD_BCRYPT, ['cost' => 4]);
        DB::table('users')->where('id', $this->user->id)->update(['password_hash' => $oldHash]);
        $beforeId = $this->app['session.store']->getId();
        $beforeToken = $this->token();
        $newPassword = str_repeat('a', 127).'1';

        $this->postProfile([
            'current_password' => 'LegacyPassword123', 'new_password' => $newPassword, 'confirm_password' => $newPassword,
        ])->assertOk();

        $stored = $this->user->fresh()->getAuthPassword();
        $this->assertSame('argon2id', password_get_info($stored)['algoName']);
        $this->assertTrue(Hash::check($newPassword, $stored));
        $this->assertFalse(Hash::check(str_repeat('a', 127).'2', $stored));
        $this->assertFalse(Hash::check('LegacyPassword123', $stored));
        $this->assertSame($beforeId, $this->app['session.store']->getId());
        $this->assertSame($beforeToken, $this->token());
        $this->getProfile()->assertOk();

        Auth::forgetGuards();
        $this->useSessionCookie();
        $this->postJson('/api/auth.php', ['action' => 'logout'], ['X-CSRF-TOKEN' => $this->token()])->assertOk();
        Auth::forgetGuards();
        $this->useSessionCookie();
        $this->postJson('/api/auth.php', [
            'action' => 'login', 'username' => $this->user->username, 'password' => $newPassword,
        ], ['X-CSRF-TOKEN' => $this->token()])->assertOk();
    }

    public function test_a_wrong_current_password_is_403_with_no_partial_profile_changes(): void
    {
        $before = $this->state($this->user->id);
        $this->postProfile([
            'about' => 'Must not change', 'current_password' => 'WrongPassword123',
            'new_password' => 'NewPassword123', 'confirm_password' => 'NewPassword123',
        ])->assertForbidden()->assertJsonPath('error', 'Текущий пароль указан неверно.');
        $this->assertSame($before, $this->state($this->user->id));
    }

    public function test_query_parameters_cannot_supply_the_current_password(): void
    {
        $before = $this->state($this->user->id);
        $this->postProfile([
            'new_password' => 'NewPassword123', 'confirm_password' => 'NewPassword123',
        ], '?current_password=TestPassword123')->assertUnprocessable();
        $this->assertSame($before, $this->state($this->user->id));
    }

    #[DataProvider('invalidPasswordChanges')]
    public function test_invalid_password_changes_return_422_without_changes(array $changes): void
    {
        $before = $this->state($this->user->id);
        $this->postProfile($changes)->assertUnprocessable();
        $this->assertSame($before, $this->state($this->user->id));
    }

    public static function invalidPasswordChanges(): array
    {
        return [
            'missing current password' => [['new_password' => 'NewPassword123', 'confirm_password' => 'NewPassword123']],
            'current only' => [['current_password' => 'TestPassword123']],
            'confirmation missing' => [['current_password' => 'TestPassword123', 'new_password' => 'NewPassword123']],
            'mismatch' => [['current_password' => 'TestPassword123', 'new_password' => 'NewPassword123', 'confirm_password' => 'Wrong123']],
            'short' => [['current_password' => 'TestPassword123', 'new_password' => 'Aa1', 'confirm_password' => 'Aa1']],
            'too long' => [['current_password' => 'TestPassword123', 'new_password' => str_repeat('a', 128).'1', 'confirm_password' => str_repeat('a', 128).'1']],
            'non-string current' => [['current_password' => ['TestPassword123'], 'new_password' => 'NewPassword123', 'confirm_password' => 'NewPassword123']],
            'non-string new' => [['current_password' => 'TestPassword123', 'new_password' => true, 'confirm_password' => 'NewPassword123']],
            'whitespace' => [['current_password' => 'TestPassword123', 'new_password' => ' NewPass123 ', 'confirm_password' => ' NewPass123 ']],
            'unicode' => [['current_password' => 'TestPassword123', 'new_password' => 'Пароль123', 'confirm_password' => 'Пароль123']],
        ];
    }

    #[DataProvider('imageData')]
    public function test_png_jpeg_and_webp_avatars_round_trip_as_data_uris(string $uri): void
    {
        $this->postProfile(['avatar' => $uri])->assertOk()->assertJsonPath('data.profile.avatar', $uri);
        $this->getProfile()->assertJsonPath('data.profile.avatar', $uri);
        $this->postProfile(['about' => 'The omitted avatar must survive'])->assertOk()->assertJsonPath('data.profile.avatar', $uri);
    }

    public static function imageData(): array
    {
        return [
            'png' => ['data:image/png;base64,'.base64_encode(self::png())],
            'jpeg' => ['data:image/jpeg;base64,'.self::JPEG],
            'webp' => ['data:image/webp;base64,'.self::WEBP],
        ];
    }

    public function test_deleting_an_avatar_clears_both_bytea_and_mime_without_touching_other_rows(): void
    {
        $this->postProfile(['avatar' => 'data:image/png;base64,'.base64_encode(self::png())])->assertOk();
        $this->postProfile(['avatar' => null])->assertOk()->assertJsonPath('data.profile.avatar', null);
        $row = DB::table('users')->where('id', $this->user->id)->first(['avatar_data', 'avatar_mime']);
        $this->assertNull($row->avatar_data);
        $this->assertNull($row->avatar_mime);
        $this->postProfile(['avatar' => null])->assertOk();
    }

    public function test_unpadded_valid_base64_is_canonicalized_before_postgresql_decode(): void
    {
        $this->postProfile(['avatar' => 'data:image/jpeg;base64,'.rtrim(self::JPEG, '=')])
            ->assertOk()->assertJsonPath('data.profile.avatar', 'data:image/jpeg;base64,'.self::JPEG);
    }

    #[DataProvider('invalidAvatars')]
    public function test_invalid_avatars_are_422_and_do_not_change_the_profile(mixed $avatar): void
    {
        $before = $this->state($this->user->id);
        $this->postProfile(['avatar' => $avatar, 'about' => 'Must not be saved'])->assertUnprocessable();
        $this->assertSame($before, $this->state($this->user->id));
    }

    public static function invalidAvatars(): array
    {
        return [
            'array' => [[]],
            'empty string is not deletion' => [''],
            'boolean' => [false],
            'svg' => ['data:image/svg+xml;base64,'.base64_encode('<svg/>')],
            'bad base64' => ['data:image/png;base64,===='],
            'not an image' => ['data:image/png;base64,'.base64_encode('not an image')],
            'truncated' => ['data:image/png;base64,AA=='],
            'mismatched mime' => ['data:image/jpeg;base64,'.base64_encode(self::png())],
            'zero width' => ['data:image/png;base64,'.base64_encode(self::png(0, 1))],
            'zero height' => ['data:image/png;base64,'.base64_encode(self::png(1, 0))],
            'width above limit' => ['data:image/png;base64,'.base64_encode(self::png(2049, 1))],
            'height above limit' => ['data:image/png;base64,'.base64_encode(self::png(1, 2049))],
        ];
    }

    public function test_the_decoded_avatar_size_limit_is_one_mebibyte(): void
    {
        $image = self::png();
        $content = 'Comment'."\0".str_repeat('a', 1_048_576 - strlen($image) - 12 - 8);
        $image = substr($image, 0, -12).self::pngChunk('tEXt', $content).substr($image, -12);
        $this->assertSame(1_048_576, strlen($image));
        $this->postProfile(['avatar' => 'data:image/png;base64,'.base64_encode($image)])->assertOk();

        $before = $this->state($this->user->id);
        $this->postProfile(['avatar' => 'data:image/png;base64,'.base64_encode($image."\0")])
            ->assertUnprocessable()->assertJsonPath('error', 'Размер аватара не должен превышать 1 МБ.');
        $this->assertSame($before, $this->state($this->user->id));
    }

    public function test_avatars_at_the_dimension_limit_are_accepted(): void
    {
        $this->postProfile(['avatar' => 'data:image/png;base64,'.base64_encode(self::png(2048, 1))])->assertOk();
        $this->postProfile(['avatar' => 'data:image/png;base64,'.base64_encode(self::png(1, 2048))])->assertOk();
    }

    public function test_csrf_is_required_before_profile_json_parsing_even_for_same_origin(): void
    {
        $before = $this->state($this->user->id);
        $this->rawProfile('POST', '{', [
            'HTTP_SEC_FETCH_SITE' => 'same-origin', 'CONTENT_TYPE' => 'application/json',
        ])->assertForbidden()->assertJsonPath('error', 'Сессия истекла. Обновите страницу.');
        $this->assertSame($before, $this->state($this->user->id));
    }

    public function test_unsupported_methods_are_405_before_csrf_for_authenticated_users(): void
    {
        foreach (['PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'] as $method) {
            $this->rawProfile($method)->assertStatus(405)->assertHeader('Allow', 'GET, POST');
        }
    }

    #[DataProvider('invalidJsonBodies')]
    public function test_invalid_json_is_400_after_successful_authentication_and_csrf(string $body): void
    {
        $this->rawProfile('POST', $body, [
            'HTTP_X_CSRF_TOKEN' => $this->token(), 'CONTENT_TYPE' => 'application/json',
        ])->assertBadRequest()->assertJsonPath('error', 'Некорректный JSON-запрос.');
    }

    public static function invalidJsonBodies(): array
    {
        return ['malformed' => ['{'], 'empty' => [''], 'scalar' => ['42'], 'null' => ['null']];
    }

    public function test_a_valid_json_body_without_json_content_type_remains_compatible(): void
    {
        $this->rawProfile('POST', json_encode($this->payload(['about' => 'Legacy content type'])), [
            'HTTP_X_CSRF_TOKEN' => $this->token(), 'CONTENT_TYPE' => 'text/plain',
        ])
            ->assertOk()->assertJsonPath('data.profile.about', 'Legacy content type');
    }

    public function test_profile_json_has_an_exact_1500000_byte_limit(): void
    {
        $body = str_pad(json_encode($this->payload()), 1_500_000);
        $server = ['HTTP_X_CSRF_TOKEN' => $this->token(), 'CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => '1'];
        $this->rawProfile('POST', $body, $server)->assertOk();
        $this->rawProfile('POST', $body.' ', $server)
            ->assertStatus(413)->assertJsonPath('error', 'Запрос слишком большой.');
    }

    private function payload(array $changes = []): array
    {
        $user = $this->user->fresh();

        return array_replace([
            'username' => $user->username, 'email' => $user->email ?? '',
            'secondary_email' => $user->secondary_email ?? '', 'about' => $user->about,
            'account_type' => $user->account_type,
        ], $changes);
    }

    private function postProfile(array $changes = [], string $query = ''): TestResponse
    {
        $this->useSessionCookie();
        Auth::forgetGuards();

        return $this->postJson('/api/profile.php'.$query, $this->payload($changes), ['X-CSRF-TOKEN' => $this->token()]);
    }

    private function getProfile(string $query = ''): TestResponse
    {
        $this->useSessionCookie();
        Auth::forgetGuards();

        return $this->getJson('/api/profile.php'.$query);
    }

    private function rawProfile(string $method, string $body = '', array $server = []): TestResponse
    {
        $this->useSessionCookie();
        Auth::forgetGuards();

        return $this->call($method, '/api/profile.php', [], $this->prepareCookiesForRequest(), [], $server, $body);
    }

    private function useSessionCookie(): void
    {
        $this->withCredentials()->withCookie(config('session.cookie'), $this->app['session.store']->getId());
    }

    private function token(): string
    {
        return $this->app['session.store']->token();
    }

    private function state(int $id): string
    {
        return DB::selectOne('SELECT md5(row_to_json(u)::text) AS checksum FROM users u WHERE id = ?', [$id])->checksum;
    }

    // Self-contained image fixtures: no GD extension, files, or external downloads required by the tests.
    private static function png(int $width = 1, int $height = 1): string
    {
        $header = pack('NNCCCCC', $width, $height, 8, 2, 0, 0, 0);
        $pixels = str_repeat("\0".str_repeat("\x28\x64\xb4", $width), $height);

        return "\x89PNG\r\n\x1a\n".self::pngChunk('IHDR', $header)
            .self::pngChunk('IDAT', gzcompress($pixels)).self::pngChunk('IEND', '');
    }

    private static function pngChunk(string $type, string $data): string
    {
        return pack('N', strlen($data)).$type.$data.pack('N', crc32($type.$data));
    }
}
