<?php

namespace Tests\Feature;

use App\Models\Board;
use App\Models\User;
use App\Mail\EmailVerificationCode;
use App\Mail\CorporateAccountInvitation;
use App\Mail\PasswordResetLink;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\DatabaseTestCase;

class AuthTest extends DatabaseTestCase
{
    private const WEBP = 'UklGRjoAAABXRUJQVlA4IC4AAADwAQCdASoBAAEAAUAmJaACdLoB+AAEgwAA/vAb3/89M15g/yc/+Uq8Fjc3wAAA';

    protected function setUp(): void
    {
        parent::setUp();
        $this->withSession(['_token' => str_repeat('a', 40)]);
    }

    public function test_anonymous_session_exposes_only_the_csrf_token_and_null_user(): void
    {
        $response = $this->getAuth()->assertOk()->assertExactJson([
            'success' => true,
            'data' => ['csrf_token' => str_repeat('a', 40), 'user' => null, 'corporate_account' => null],
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
        $response = $this->postRegistration($this->registration())
            ->assertCreated()
            ->assertJsonStructure(['success', 'data' => ['user' => ['id', 'username', 'account_type']]])
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        $user = User::findOrFail($response->json('data.user.id'));
        $this->assertSame('@NewUser', $user->username);
        $this->assertSame('Имя', $user->first_name);
        $this->assertSame('Фамилия', $user->last_name);
        $this->assertNull($user->middle_name);
        $this->assertNotNull($user->email);
        $this->assertSame('individual', $user->account_type);
        $this->assertTrue(Hash::check('Password123!', $user->getAuthPassword()));
        $this->assertSame('argon2id', password_get_info($user->getAuthPassword())['algoName']);
        $this->assertSame(1, $user->boards()->count());
        $this->assertSame('👋 Hello World!', $user->boards()->first()->name);
        $this->assertTrue($user->boards()->first()->is_default);
        $this->assertDatabaseHas('task_lists', [
            'user_id' => $user->id,
            'board_id' => $user->boards()->first()->id,
            'name' => '👋 Hello World!',
            'description' => 'Это ваш первый список',
        ]);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $user->id,
            'sender' => 'ToDo-Inn!',
            'message' => 'Добро пожаловать в ToDo-inn! Здесь вы можете организовать свои дела или работу предприятия. Надеемся, мы сработаемся!',
            'read_at' => null,
        ]);
        $this->assertNotSame($oldId, $this->app['session.store']->getId());
        $this->assertNotSame($oldToken, $this->app['session.store']->token());

        $this->getAuth()->assertJsonPath('data.user', $response->json('data.user'));
        $this->assertSame(['id', 'username', 'account_type'], array_keys($response->json('data.user')));
    }

    public function test_legacy_personal_account_can_refresh_credentials_without_touching_workspace_data(): void
    {
        $user = $this->createUser();
        $user->forceFill([
            'username' => '@OldLegacy',
            'first_name' => 'СтароеИмя',
            'last_name' => 'СтараяФамилия',
            'email' => 'old-legacy@example.com',
            'about' => 'Старое описание',
        ])->save();
        DB::table('users')->where('id', $user->id)->update(['password_hash' => password_hash('OldPassword123!', PASSWORD_BCRYPT)]);
        $user->forceFill(['registration_version' => 1])->save();
        $createdAt = $user->created_at->toDateTimeString();
        $board = $user->boards()->create(['name' => 'Мои старые дела', 'is_default' => true]);
        $listId = DB::table('task_lists')->insertGetId(['user_id' => $user->id, 'board_id' => $board->id, 'name' => 'Старый список']);
        $taskId = DB::table('tasks')->insertGetId(['user_id' => $user->id, 'list_id' => $listId, 'title' => 'Сохранить эту задачу']);

        Auth::login($user);
        $newEmail = 'upgraded-'.bin2hex(random_bytes(5)).'@example.com';
        $this->withSession(['_token' => str_repeat('a', 40), 'registration_verified_email' => $newEmail]);
        $this->postAuth(['action' => 'legacy_account_status'])->assertOk()->assertJsonPath('data.required', true);
        $this->postAuth(['action' => 'validate_registration_username', 'username' => '@FreshLegacy'])
            ->assertOk()->assertJsonPath('data.available', true);
        $this->postAuth(['action' => 'validate_registration_email', 'email' => $newEmail, 'account_type' => 'individual'])
            ->assertOk()->assertJsonPath('data.available', true);

        $registration = $this->registration([
            'username' => '@FreshLegacy', 'email' => $newEmail,
            'password' => 'FreshPassword123!', 'confirm_password' => 'FreshPassword123!',
            'first_name' => 'НовоеИмя', 'last_name' => 'НоваяФамилия',
        ]);
        $response = $this->postRegistration($registration)->assertOk()->assertJsonPath('data.upgraded', true);

        $updated = User::findOrFail($user->id);
        $this->assertSame($user->id, $response->json('data.user.id'));
        $this->assertSame('@FreshLegacy', $updated->username);
        $this->assertSame($newEmail, $updated->email);
        $this->assertSame('НовоеИмя', $updated->first_name);
        $this->assertSame($createdAt, $updated->created_at->toDateTimeString());
        $this->assertTrue(Hash::check('FreshPassword123!', $updated->getAuthPassword()));
        $this->assertSame('argon2id', password_get_info($updated->getAuthPassword())['algoName']);
        $this->assertSame([$board->id], $updated->boards()->pluck('id')->all());
        $this->assertSame([$listId], $updated->taskLists()->pluck('id')->all());
        $this->assertSame([$taskId], $updated->tasks()->pluck('id')->all());
        $this->assertSame('Сохранить эту задачу', $updated->tasks()->first()->title);
        $this->postAuth(['action' => 'legacy_account_status'])->assertOk()->assertJsonPath('data.required', false);
    }

    public function test_legacy_corporate_account_can_switch_to_a_new_corporate_type_and_keep_its_workspace(): void
    {
        $user = $this->createUser();
        $user->forceFill([
            'username' => '@OldCompany',
            'account_type' => 'corporate',
            'first_name' => '',
            'last_name' => '',
            'email' => 'old-company-'.bin2hex(random_bytes(4)).'@example.com',
        ])->save();
        DB::table('users')->where('id', $user->id)->update([
            'password_hash' => password_hash('OldCompany123!', PASSWORD_BCRYPT),
            'registration_version' => 1,
        ]);
        $board = $user->boards()->create(['name' => 'Старый корпоративный workspace', 'is_default' => true]);
        $listId = DB::table('task_lists')->insertGetId([
            'user_id' => $user->id, 'board_id' => $board->id, 'name' => 'Не трогать список',
        ]);
        $taskId = DB::table('tasks')->insertGetId([
            'user_id' => $user->id, 'list_id' => $listId, 'title' => 'Не трогать задачу',
        ]);
        Auth::login($user);
        $this->withSession([
            '_token' => str_repeat('a', 40),
            'registration_verified_email' => $user->email,
        ]);

        $this->postAuth(['action' => 'legacy_account_status'])->assertOk()->assertJsonPath('data.required', true);
        $input = $this->registration([
            'username' => '@NewCompany',
            'email' => $user->email,
            'account_type' => 'corporate',
            'first_name' => '',
            'last_name' => '',
            'organization_type' => 'ООО',
            'organization_name' => 'Новая организация',
            'password' => 'NewCompany123!',
            'confirm_password' => 'NewCompany123!',
        ]);
        $input['administrators'] = [['role' => 'owner', 'identifier' => $user->email]];
        $response = $this->postRegistration($input)->assertOk()->assertJsonPath('data.upgraded', true);

        $accountId = $response->json('data.corporate_account.id');
        $this->assertNotSame('@OldCompany', User::findOrFail($user->id)->username);
        $this->assertSame('individual', User::findOrFail($user->id)->account_type);
        $this->assertSame(2, (int) User::findOrFail($user->id)->registration_version);
        $this->assertDatabaseHas('corporate_account_members', [
            'corporate_account_id' => $accountId, 'user_id' => $user->id, 'role' => 'owner',
        ]);
        $this->assertDatabaseHas('boards', ['id' => $board->id, 'user_id' => $user->id, 'corporate_account_id' => null]);
        $this->assertDatabaseHas('task_lists', ['id' => $listId, 'user_id' => $user->id, 'board_id' => $board->id]);
        $this->assertDatabaseHas('tasks', ['id' => $taskId, 'user_id' => $user->id, 'list_id' => $listId, 'title' => 'Не трогать задачу']);
        $this->assertDatabaseHas('notifications', ['corporate_account_id' => $accountId, 'sender' => 'ToDo-Inn!']);
        $this->getAuth()->assertJsonPath('data.user', null)->assertJsonPath('data.corporate_account.id', $accountId);

        $this->postAuth(['action' => 'logout'])->assertOk();
        $this->postAuth(['action' => 'login', 'username' => $user->email, 'password' => 'NewCompany123!'])
            ->assertOk()->assertJsonPath('data.account_choices', ['individual', 'corporate']);
    }

    public function test_legacy_corporate_account_can_switch_to_individual_without_losing_boards(): void
    {
        $user = $this->createUser();
        $user->forceFill(['username' => '@OldTeam', 'account_type' => 'corporate', 'email' => 'old-team@example.com'])->save();
        DB::table('users')->where('id', $user->id)->update([
            'password_hash' => password_hash('OldTeam123!', PASSWORD_BCRYPT), 'registration_version' => 1,
        ]);
        $board = $user->boards()->create(['name' => 'Доска останется', 'is_default' => true]);
        Auth::login($user);
        $this->withSession([
            '_token' => str_repeat('a', 40),
            'registration_verified_email' => $user->email,
        ]);

        $input = $this->registration([
            'username' => '@NewIndividual',
            'email' => $user->email,
            'account_type' => 'individual',
            'password' => 'NewIndividual123!',
            'confirm_password' => 'NewIndividual123!',
        ]);
        $this->postRegistration($input)->assertOk()->assertJsonPath('data.upgraded', true);

        $updated = User::findOrFail($user->id);
        $this->assertSame('individual', $updated->account_type);
        $this->assertSame('@NewIndividual', $updated->username);
        $this->assertSame([$board->id], $updated->boards()->pluck('id')->all());
        $this->assertDatabaseMissing('corporate_accounts', ['root_email' => $user->email]);
        $this->postAuth(['action' => 'legacy_account_status'])->assertOk()->assertJsonPath('data.required', false);
    }

    public function test_user_can_read_and_mark_only_their_notifications_as_read(): void
    {
        $registration = $this->postRegistration($this->registration())->assertCreated();
        $userId = $registration->json('data.user.id');
        $notification = DB::table('notifications')->where('user_id', $userId)->first();

        $response = $this->postAuth(['action' => 'get_notifications'])->assertOk()
            ->assertJsonPath('data.unread_count', 1)
            ->assertJsonPath('data.notifications.0.sender', 'ToDo-Inn!')
            ->assertJsonPath('data.notifications.0.is_read', false);
        $this->assertSame((int) $notification->id, $response->json('data.notifications.0.id'));

        $this->postAuth(['action' => 'mark_notification_read', 'notification_id' => (int) $notification->id])
            ->assertOk()->assertJsonPath('data.read', true);
        $this->postAuth(['action' => 'get_notifications'])
            ->assertOk()->assertJsonPath('data.unread_count', 0)
            ->assertJsonPath('data.notifications.0.is_read', true);

        $other = $this->createUser();
        Auth::logout();
        Auth::login($other);
        $this->postAuth(['action' => 'mark_notification_read', 'notification_id' => (int) $notification->id])
            ->assertNotFound();
    }

    public function test_registration_requires_personal_data_consent_and_saves_optional_preferences(): void
    {
        $input = $this->registration([
            'secondary_email' => 'backup@example.com',
            'about' => 'Learning and building.',
            'github_url' => 'https://github.com/example-user',
            'telegram_url' => 'https://t.me/example_user',
            'preferred_theme' => 'dark',
            'avatar' => 'data:image/webp;base64,'.self::WEBP,
            'marketing_consent' => true,
        ]);
        unset($input['personal_data_consent']);
        $this->postRegistration($input)->assertUnprocessable()
            ->assertJsonPath('error', 'Для регистрации необходимо согласиться на обработку персональных данных.');
        $this->assertDatabaseMissing('users', ['username' => '@NewUser']);

        $input['personal_data_consent'] = true;
        $response = $this->postRegistration($input)->assertCreated();
        $user = User::findOrFail($response->json('data.user.id'));

        $this->assertSame('backup@example.com', $user->secondary_email);
        $this->assertSame('Learning and building.', $user->about);
        $this->assertSame('https://github.com/example-user', $user->github_url);
        $this->assertSame('https://t.me/example_user', $user->telegram_url);
        $this->assertSame('dark', $user->preferred_theme);
        $this->assertSame('image/webp', $user->avatar_mime);
        $encodedAvatar = DB::table('users')->where('id', $user->id)->selectRaw("encode(avatar_data, 'base64') AS avatar_base64")->value('avatar_base64');
        $this->assertSame(self::WEBP, str_replace(["\r", "\n"], '', $encodedAvatar));
        $this->assertTrue($user->marketing_consent);
        $this->assertNotNull($user->marketing_consent_at);
        $this->assertNotNull($user->personal_data_consent_at);
        $this->assertSame('2026-10-draft-1', $user->personal_data_consent_version);
    }

    public function test_email_is_required_and_account_type_keeps_its_default(): void
    {
        $this->postRegistration($this->registration(['email' => null]))->assertUnprocessable();
        $response = $this->postRegistration($this->registration(['account_type' => null]))->assertCreated();
        $user = User::findOrFail($response->json('data.user.id'));

        $this->assertNotNull($user->email);
        $this->assertSame('individual', $user->account_type);
    }

    public function test_registration_normalizes_email_and_keeps_the_selected_account_type(): void
    {
        $input = $this->registration([
            'email' => 'Person@Example.COM', 'account_type' => 'corporate',
            'organization_type' => 'ООО', 'organization_name' => 'Ромашка & Co. №1', 'id' => 0, 'is_admin' => true,
        ]);
        $input['administrators'] = [['role' => 'owner', 'identifier' => 'person@example.com']];
        $response = $this->postRegistration($input)->assertCreated();
        $accountId = $response->json('data.corporate_account.id');

        $this->assertNull($response->json('data.user'));
        $this->assertDatabaseHas('corporate_accounts', [
            'id' => $accountId, 'root_email' => 'person@example.com', 'root_username' => '@NewUser',
            'organization_type' => 'ООО', 'organization_name' => 'Ромашка & Co. №1',
        ]);
        $this->assertDatabaseHas('corporate_account_members', [
            'corporate_account_id' => $accountId, 'user_id' => null, 'email' => 'person@example.com', 'role' => 'owner',
        ]);
        $this->assertDatabaseMissing('users', ['username' => '@NewUser']);
    }

    public function test_registration_accepts_the_new_login_and_name_characters(): void
    {
        $response = $this->postRegistration($this->registration([
            'username' => '@A-user_2', 'first_name' => 'Ёлка—', 'last_name' => 'Smith-Ж', 'middle_name' => 'Отчество',
        ]))->assertCreated();

        $user = User::findOrFail($response->json('data.user.id'));
        $this->assertSame('@A-user_2', $user->username);
        $this->assertSame('Ёлка—', $user->first_name);
        $this->assertSame('Smith-Ж', $user->last_name);
        $this->assertSame('Отчество', $user->middle_name);
    }

    public function test_corporate_registration_requires_and_saves_valid_organization_details(): void
    {
        $this->postRegistration($this->registration(['account_type' => 'corporate']))->assertUnprocessable();

        $firstRegistration = $this->registration([
            'account_type' => 'corporate', 'first_name' => '', 'last_name' => '',
            'organization_type' => 'ГУП', 'organization_name' => 'АО «Пример-1» & Co.',
            'secondary_email' => 'contact@example.com', 'about' => 'Организационное описание',
            'github_url' => 'https://github.com/example-org', 'preferred_theme' => 'light', 'marketing_consent' => true,
        ]);
        $firstRegistration['administrators'] = [['role' => 'owner', 'identifier' => $firstRegistration['email']]];
        $response = $this->postRegistration($firstRegistration)->assertCreated();
        $this->assertNull($response->json('data.user'));
        $this->assertDatabaseHas('corporate_accounts', [
            'root_username' => '@NewUser', 'organization_type' => 'ГУП', 'organization_name' => 'АО «Пример-1» & Co.',
            'secondary_email' => 'contact@example.com', 'description' => 'Организационное описание',
            'github_url' => 'https://github.com/example-org', 'preferred_theme' => 'light', 'marketing_consent' => true,
        ]);
        $account = DB::table('corporate_accounts')->where('root_username', '@NewUser')->first();
        $this->assertNotNull($account->personal_data_consent_at);
        $this->assertSame('2026-10-draft-1', $account->personal_data_consent_version);

        $secondRegistration = $this->registration([
            'username' => '@MupOrg',
            'account_type' => 'corporate', 'first_name' => '', 'last_name' => '',
            'organization_type' => 'МУП', 'organization_name' => 'Муниципальная организация',
        ]);
        $secondRegistration['administrators'] = [['role' => 'owner', 'identifier' => $secondRegistration['email']]];
        $anotherResponse = $this->postRegistration($secondRegistration)->assertCreated();
        $this->assertDatabaseHas('corporate_accounts', [
            'id' => $anotherResponse->json('data.corporate_account.id'), 'organization_type' => 'МУП',
        ]);
    }

    public function test_corporate_owner_can_be_a_different_user_and_receives_an_invitation(): void
    {
        Mail::fake();
        $input = $this->registration([
            'account_type' => 'corporate', 'organization_type' => 'ООО', 'organization_name' => 'Ромашка',
        ]);
        $ownerEmail = 'separate-owner@example.com';
        $input['administrators'] = [['role' => 'owner', 'identifier' => $ownerEmail]];

        $response = $this->postRegistration($input)->assertCreated();
        $accountId = $response->json('data.corporate_account.id');
        $this->assertDatabaseHas('corporate_accounts', ['id' => $accountId, 'created_by_user_id' => null]);
        $this->assertDatabaseHas('corporate_account_members', [
            'corporate_account_id' => $accountId, 'email' => $ownerEmail, 'role' => 'owner', 'user_id' => null,
        ]);
        Mail::assertSent(CorporateAccountInvitation::class, fn (CorporateAccountInvitation $mail): bool => $mail->hasTo($ownerEmail) && $mail->role === 'owner');
    }

    public function test_new_corporate_account_receives_a_welcome_notification_for_root_login(): void
    {
        $input = $this->registration([
            'account_type' => 'corporate', 'first_name' => '', 'last_name' => '',
            'organization_type' => 'ООО', 'organization_name' => 'Добро пожаловать',
        ]);
        $input['administrators'] = [['role' => 'owner', 'identifier' => $input['email']]];
        $registration = $this->postRegistration($input)->assertCreated();
        $accountId = $registration->json('data.corporate_account.id');
        $notification = DB::table('notifications')->where('corporate_account_id', $accountId)->first();
        $this->assertNotNull($notification);

        $this->postAuth(['action' => 'login', 'username' => $input['username'], 'password' => $input['password']])->assertOk();
        $this->postAuth(['action' => 'get_notifications'])->assertOk()
            ->assertJsonPath('data.unread_count', 1)
            ->assertJsonPath('data.notifications.0.sender', 'ToDo-Inn!')
            ->assertJsonPath('data.notifications.0.is_read', false);
        $this->postAuth(['action' => 'mark_notification_read', 'notification_id' => (int) $notification->id])
            ->assertOk()->assertJsonPath('data.read', true);
    }

    public function test_organization_and_director_can_share_email_and_root_login_is_separate(): void
    {
        $email = 'director-company@example.com';
        $director = $this->createUser();
        $director->forceFill(['email' => $email])->save();

        $input = $this->registration([
            'username' => '@CompanyRoot', 'email' => $email,
            'account_type' => 'corporate', 'organization_type' => 'ООО', 'organization_name' => 'Пример',
        ]);
        $input['administrators'] = [['role' => 'owner', 'identifier' => $email]];

        $response = $this->postRegistration($input)->assertCreated();
        $accountId = $response->json('data.corporate_account.id');
        $this->assertNull($response->json('data.user'));
        $this->assertSame($email, User::findOrFail($director->id)->email);
        $this->assertDatabaseHas('corporate_accounts', ['id' => $accountId, 'root_email' => $email]);
        $this->assertDatabaseHas('corporate_account_members', [
            'corporate_account_id' => $accountId, 'email' => $email, 'role' => 'owner', 'user_id' => null,
        ]);

        $this->postAuth(['action' => 'login', 'username' => '@CompanyRoot', 'password' => 'Password123!'])
            ->assertOk()->assertJsonPath('data.user', null)->assertJsonPath('data.corporate_account.id', $accountId);
        $this->getAuth()->assertJsonPath('data.user', null)->assertJsonPath('data.corporate_account.id', $accountId);
    }

    public function test_invited_owner_gets_an_organization_board_after_creating_personal_account(): void
    {
        Mail::fake();
        $ownerEmail = 'company-root@example.com';
        $corporate = $this->registration([
            'username' => '@RootCompany', 'email' => 'company-root@example.com',
            'account_type' => 'corporate', 'organization_type' => 'ООО', 'organization_name' => 'Owner Workspace',
        ]);
        $corporate['administrators'] = [['role' => 'owner', 'identifier' => $ownerEmail]];
        $accountId = $this->postRegistration($corporate)->assertCreated()->json('data.corporate_account.id');

        $token = null;
        Mail::assertSent(CorporateAccountInvitation::class, function (CorporateAccountInvitation $mail) use (&$token, $ownerEmail): bool {
            if ($mail->role !== 'owner' || !$mail->hasTo($ownerEmail)) return false;
            parse_str((string) parse_url($mail->invitationUrl, PHP_URL_QUERY), $query);
            $token = $query['token'] ?? null;

            return true;
        });
        $this->assertIsString($token);
        $this->postAuth(['action' => 'accept_corporate_invitation', 'token' => $token])
            ->assertOk()->assertJsonPath('data.registered', false)->assertJsonPath('data.role', 'owner');

        $personal = $this->registration(['username' => '@Director', 'email' => $ownerEmail]);
        $userId = $this->postRegistration($personal)->assertCreated()->json('data.user.id');
        $board = DB::table('boards')->where('corporate_account_id', $accountId)->first();
        $this->assertNotNull($board);
        $this->assertSame($userId, (int) $board->user_id);
        $this->assertDatabaseHas('corporate_account_members', [
            'corporate_account_id' => $accountId, 'user_id' => $userId, 'role' => 'owner',
        ]);
        $this->assertDatabaseHas('task_lists', ['board_id' => $board->id, 'user_id' => $userId, 'name' => '👋 Hello World!']);
    }

    public function test_corporate_registration_requires_one_owner_and_allows_at_most_five_roles(): void
    {
        $input = $this->registration([
            'account_type' => 'corporate', 'organization_type' => 'ООО', 'organization_name' => 'Ромашка',
        ]);
        $input['administrators'] = [['role' => 'admin', 'identifier' => $input['email']]];
        $this->postRegistration($input)->assertUnprocessable()
            ->assertJsonPath('error', 'Первая строка должна содержать единственного владельца аккаунта.');

        $input['administrators'] = [
            ['role' => 'admin', 'identifier' => 'member@example.com'],
            ['role' => 'owner', 'identifier' => $input['email']],
        ];
        $this->postRegistration($input)->assertUnprocessable()
            ->assertJsonPath('error', 'Первая строка должна содержать единственного владельца аккаунта.');

        $input['administrators'] = [['role' => 'owner', 'identifier' => $input['email']]];
        for ($index = 1; $index <= 5; $index++) {
            $input['administrators'][] = ['role' => 'admin', 'identifier' => "member{$index}@example.com"];
        }
        $this->postRegistration($input)->assertUnprocessable();
        $this->assertDatabaseMissing('users', ['username' => $input['username']]);
    }

    public function test_existing_username_can_be_used_for_an_email_invitation(): void
    {
        Mail::fake();
        $invitee = $this->createUser();
        $invitee->forceFill([
            'username' => '@Existing'.bin2hex(random_bytes(3)),
            'email' => 'existing-admin@example.com',
            'first_name' => 'Данияр',
            'middle_name' => 'Рафаилевич',
        ])->save();
        $input = $this->registration([
            'account_type' => 'corporate', 'organization_type' => 'ООО', 'organization_name' => 'Ромашка',
        ]);
        $input['administrators'] = [
            ['role' => 'owner', 'identifier' => $input['email']],
            ['role' => 'support', 'identifier' => $invitee->username],
        ];

        $this->postRegistration($input)->assertCreated();
        $this->assertDatabaseHas('corporate_account_members', [
            'email' => 'existing-admin@example.com', 'role' => 'support', 'user_id' => null,
        ]);
        Mail::assertSent(CorporateAccountInvitation::class, fn (CorporateAccountInvitation $mail): bool => $mail->hasTo('existing-admin@example.com')
            && $mail->recipientName === 'Данияр Рафаилевич');
    }

    public function test_admin_identifier_validation_rejects_unknown_usernames_and_accepts_registered_usernames(): void
    {
        $this->postAuth(['action' => 'validate_corporate_admin_identifier', 'identifier' => '@MissingUser'])
            ->assertUnprocessable()
            ->assertJsonPath('error', 'Не удалось найти пользователя с таким логином и e-mail.');

        $username = '@Known'.bin2hex(random_bytes(3));
        $user = $this->createUser();
        $user->forceFill(['username' => $username, 'email' => 'known-admin@example.com'])->save();

        $this->postAuth(['action' => 'validate_corporate_admin_identifier', 'identifier' => $username])
            ->assertOk()->assertJsonPath('data.valid', true);
    }

    public function test_registration_username_availability_reports_personal_and_organization_conflicts_early(): void
    {
        $personalUsername = '@Personal'.bin2hex(random_bytes(3));
        $user = $this->createUser();
        $user->forceFill(['username' => $personalUsername])->save();

        $this->postAuth(['action' => 'validate_registration_username', 'username' => $personalUsername])
            ->assertConflict()->assertJsonPath('error', 'Этот логин уже используется личным аккаунтом.');

        $rootUsername = '@Company'.bin2hex(random_bytes(3));
        DB::table('corporate_accounts')->insert([
            'root_username' => $rootUsername,
            'root_email' => 'root-'.bin2hex(random_bytes(3)).'@example.com',
            'root_password_hash' => Hash::make('RootPassword123!'),
        ]);
        $this->postAuth(['action' => 'validate_registration_username', 'username' => $rootUsername])
            ->assertConflict()->assertJsonPath('error', 'Этот логин уже используется аккаунтом организации.');

        $this->postAuth(['action' => 'validate_registration_username', 'username' => '@Available'.bin2hex(random_bytes(3))])
            ->assertOk()->assertJsonPath('data.available', true);
        $this->postAuth(['action' => 'validate_registration_username', 'username' => 'bad name'])
            ->assertUnprocessable();
    }

    public function test_registration_email_availability_preserves_cross_account_email_rule(): void
    {
        $existing = $this->createUser();
        $existing->forceFill(['email' => 'taken@example.com'])->save();

        $this->postAuth([
            'action' => 'validate_registration_email',
            'email' => 'TAKEN@example.com',
            'account_type' => 'individual',
        ])->assertConflict()->assertJsonPath('error', 'Этот e-mail уже привязан к личному аккаунту.');

        $this->postAuth([
            'action' => 'validate_registration_email',
            'email' => 'taken@example.com',
            'account_type' => 'corporate',
        ])->assertOk()->assertJsonPath('data.available', true);
    }

    public function test_registration_email_lookup_reports_existing_account_types_and_blocks_fully_used_email(): void
    {
        Mail::fake();
        $email = 'email-status-'.bin2hex(random_bytes(5)).'@example.com';
        $user = $this->createUser();
        $user->forceFill(['email' => $email, 'account_type' => 'individual'])->save();

        $this->postAuth(['action' => 'check_registration_email', 'email' => strtoupper($email)])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['existing_accounts' => ['individual']]]);

        DB::table('corporate_accounts')->insert([
            'root_username' => '@EmailStatus'.bin2hex(random_bytes(3)),
            'root_email' => $email,
            'root_password_hash' => Hash::make('Corporate123!'),
            'organization_name' => 'Email status',
        ]);

        $this->postAuth(['action' => 'check_registration_email', 'email' => $email])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['existing_accounts' => ['individual', 'corporate']]]);
        $this->postAuth(['action' => 'send_verification_code', 'email' => $email])
            ->assertConflict()->assertJsonPath('error', 'Этот e-mail уже связан с личным и корпоративным аккаунтами. Войдите в нужный аккаунт или восстановите пароль.');
        Mail::assertNothingOutgoing();
        $this->assertNull(Cache::get('email-verification-code:'.hash('sha256', $email)));
    }

    public function test_corporate_administrator_invitation_is_emailed_and_linked_after_acceptance_and_signup(): void
    {
        Mail::fake();
        $inviteEmail = 'new-admin@example.com';
        $input = $this->registration([
            'account_type' => 'corporate', 'organization_type' => 'ООО', 'organization_name' => 'Ромашка',
        ]);
        $input['administrators'] = [
            ['role' => 'owner', 'identifier' => $input['email']],
            ['role' => 'manager', 'identifier' => $inviteEmail],
        ];

        $response = $this->postRegistration($input)->assertCreated();
        $member = DB::table('corporate_account_members')->where('email', $inviteEmail)->first();
        $this->assertNotNull($member);
        $this->assertSame('manager', $member->role);
        $this->assertNull($member->user_id);
        $this->assertNotNull($member->invitation_token_hash);

        $invitationUrl = null;
        Mail::assertSent(CorporateAccountInvitation::class, function (CorporateAccountInvitation $mail) use (&$invitationUrl, $inviteEmail): bool {
            $invitationUrl = $mail->invitationUrl;

            return $mail->hasTo($inviteEmail) && str_contains($mail->invitationUrl, '/pages/corporate-invitation.html?token=');
        });
        parse_str((string) parse_url((string) $invitationUrl, PHP_URL_QUERY), $query);
        $token = $query['token'] ?? '';
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/D', $token);

        $this->postAuth(['action' => 'accept_corporate_invitation', 'token' => $token])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['registered' => false, 'role' => 'manager']]);
        $this->assertNotNull(DB::table('corporate_account_members')->where('id', $member->id)->value('accepted_at'));

        $newAdmin = $this->registration([
            'username' => '@NewAdmin', 'email' => $inviteEmail,
        ]);
        $this->postRegistration($newAdmin)->assertCreated();
        $this->assertSame(User::query()->where('email', $inviteEmail)->value('id'), DB::table('corporate_account_members')->where('id', $member->id)->value('user_id'));
        $this->assertNull(DB::table('corporate_accounts')->value('created_by_user_id'));
    }

    public function test_verification_code_is_emailed_and_only_its_hash_is_cached(): void
    {
        Mail::fake();
        $email = ' Verify@Example.com ';

        $response = $this->postAuth(['action' => 'send_verification_code', 'email' => $email])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['sent' => true]]);

        Mail::assertSent(EmailVerificationCode::class, fn (EmailVerificationCode $mail): bool => preg_match('/^[0-9]{6}$/D', $mail->code) === 1);
        $cacheKey = 'email-verification-code:'.hash('sha256', strtolower(trim($email)));
        $cachedCode = Cache::get($cacheKey);
        $this->assertIsArray($cachedCode);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $cachedCode['hash']);
        $this->assertSame(0, $cachedCode['attempts']);
        $this->assertStringNotContainsString($cachedCode['hash'], $response->getContent());
    }

    public function test_local_registration_code_is_fixed_and_does_not_send_email(): void
    {
        $this->app['env'] = 'local';
        Mail::fake();
        $email = 'local-beta@example.com';

        $this->postAuth(['action' => 'send_verification_code', 'email' => $email])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['sent' => true, 'test_code' => '285868']]);
        Mail::assertNothingOutgoing();

        $this->postAuth(['action' => 'verify_email_code', 'email' => $email, 'code' => '285868'])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['verified' => true]]);
        $this->assertSame($email, $this->app['session.store']->get('registration_verified_email'));
    }

    public function test_verification_code_is_not_sent_to_invalid_email_but_can_be_used_by_a_second_account_type(): void
    {
        Mail::fake();
        $this->postAuth(['action' => 'send_verification_code', 'email' => 'not-an-email'])->assertUnprocessable();

        $user = $this->createUser();
        $user->forceFill(['email' => 'taken@example.com'])->save();
        $this->postAuth(['action' => 'send_verification_code', 'email' => 'TAKEN@example.com'])
            ->assertOk()->assertJsonPath('data.existing_accounts', ['individual']);

        $code = null;
        Mail::assertSent(EmailVerificationCode::class, function (EmailVerificationCode $mail) use (&$code): bool {
            $code = $mail->code;

            return true;
        });
        $this->assertIsString($code);
        $this->postAuth(['action' => 'verify_email_code', 'email' => 'TAKEN@example.com', 'code' => $code])
            ->assertOk()->assertJsonPath('data.existing_accounts', ['individual']);
    }

    public function test_correct_verification_code_is_consumed_and_bound_to_the_session(): void
    {
        Mail::fake();
        $email = 'verify-'.bin2hex(random_bytes(5)).'@example.com';
        $this->postAuth(['action' => 'send_verification_code', 'email' => $email])->assertOk();

        $code = null;
        Mail::assertSent(EmailVerificationCode::class, function (EmailVerificationCode $mail) use (&$code): bool {
            $code = $mail->code;

            return true;
        });
        $this->assertIsString($code);

        $this->postAuth(['action' => 'verify_email_code', 'email' => $email, 'code' => $code])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['verified' => true]]);
        $this->assertSame($email, $this->app['session.store']->get('registration_verified_email'));
        $this->assertNull(Cache::get('email-verification-code:'.hash('sha256', $email)));
    }

    public function test_password_reset_link_is_sent_for_personal_account_and_only_token_hash_is_cached(): void
    {
        Mail::fake();
        $email = 'reset-'.bin2hex(random_bytes(5)).'@example.com';
        $user = $this->createUser();
        $user->forceFill(['email' => $email, 'account_type' => 'individual', 'first_name' => 'Данияр', 'middle_name' => 'Рафаилевич'])->save();

        $response = $this->postAuth(['action' => 'request_password_reset', 'email' => strtoupper($email)])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['sent' => true]]);

        $resetUrl = null;
        Mail::assertSent(PasswordResetLink::class, function (PasswordResetLink $mail) use (&$resetUrl, $email): bool {
            $resetUrl = $mail->resetUrl;

            return $mail->hasTo($email) && $mail->recipientName === 'Данияр Рафаилевич';
        });
        parse_str(ltrim((string) parse_url((string) $resetUrl, PHP_URL_FRAGMENT), '#'), $query);
        $token = $query['token'] ?? '';
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/D', $token);
        $tokenHash = hash('sha256', $token);
        $cached = Cache::get('password-reset-token:'.$tokenHash);
        $this->assertSame(['user_id' => (int) $user->id, 'email' => $email], $cached);
        $this->assertStringNotContainsString($token, $response->getContent());
    }

    public function test_unknown_email_gets_the_same_password_reset_response_without_email(): void
    {
        Mail::fake();

        $this->postAuth(['action' => 'request_password_reset', 'email' => 'missing@example.com'])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['sent' => true]]);

        Mail::assertNothingOutgoing();
    }

    public function test_password_reset_changes_hash_and_consumes_link_once(): void
    {
        Mail::fake();
        $email = 'reset-'.bin2hex(random_bytes(5)).'@example.com';
        $user = $this->createUser();
        $user->forceFill(['email' => $email, 'account_type' => 'individual'])->save();
        $oldHash = $user->password_hash;
        $this->postAuth(['action' => 'request_password_reset', 'email' => $email])->assertOk();

        $token = null;
        Mail::assertSent(PasswordResetLink::class, function (PasswordResetLink $mail) use (&$token): bool {
            parse_str(ltrim((string) parse_url($mail->resetUrl, PHP_URL_FRAGMENT), '#'), $query);
            $token = $query['token'] ?? null;

            return true;
        });
        $this->assertIsString($token);
        $tokenHash = hash('sha256', $token);

        $this->postAuth([
            'action' => 'reset_password', 'token' => $token,
            'password' => 'NewPassword123!', 'confirm_password' => 'NewPassword123!',
        ])->assertOk()->assertExactJson(['success' => true, 'data' => ['reset' => true]]);

        $user->refresh();
        $this->assertNotSame($oldHash, $user->password_hash);
        $this->assertTrue(Hash::check('NewPassword123!', $user->password_hash));
        $this->assertSame('argon2id', password_get_info($user->password_hash)['algoName']);
        $this->assertNull(Cache::get('password-reset-token:'.$tokenHash));

        $this->postAuth([
            'action' => 'reset_password', 'token' => $token,
            'password' => 'AnotherPassword123!', 'confirm_password' => 'AnotherPassword123!',
        ])->assertUnprocessable();
        $this->assertTrue(Hash::check('NewPassword123!', $user->fresh()->password_hash));
    }

    public function test_registration_cannot_skip_email_verification(): void
    {
        $this->postAuth($this->registration())->assertUnprocessable()
            ->assertJsonPath('error', 'Сначала подтвердите e-mail.');
        $this->assertSame(0, User::count());
        $this->assertGuest();
    }

    public function test_username_errors_explain_the_specific_problem(): void
    {
        $this->postRegistration($this->registration(['username' => '@логин']))
            ->assertUnprocessable()->assertJsonPath('error', 'Используйте только латинские буквы.');
        $this->postRegistration($this->registration(['username' => '@1user']))
            ->assertUnprocessable()->assertJsonPath('error', 'После @ логин должен начинаться с латинской буквы.');
        $this->postRegistration($this->registration(['username' => '@ab']))
            ->assertUnprocessable()->assertJsonPath('error', 'Логин вместе с @ должен содержать не менее 4 символов.');
        $this->postRegistration($this->registration(['username' => '@user.name']))
            ->assertUnprocessable()->assertJsonPath('error', 'После @ разрешены латинские буквы, цифры, дефис и подчёркивание.');
    }

    #[DataProvider('invalidRegistrationFields')]
    public function test_invalid_registration_input_is_rejected_without_partial_rows(array $changes): void
    {
        $users = User::count();
        $boards = Board::count();

        $this->postRegistration($this->registration($changes))
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
            'short username' => [['username' => '@a']],
            'three-character username' => [['username' => '@ab']],
            'long username' => [['username' => '@'.str_repeat('a', 24)]],
            'username whitespace not trimmed' => [['username' => ' @NewUser ']],
            'non-string username' => [['username' => ['NewUser']]],
            'non-latin username' => [['username' => '@Новый']],
            'numeric username' => [['username' => '@12345']],
            'username starts with symbol' => [['username' => '@-user']],
            'username symbol not permitted' => [['username' => '@new.name']],
            'invalid first name' => [['first_name' => 'Имя!']],
            'invalid last name' => [['last_name' => 'Фамилия_']],
            'invalid middle name' => [['middle_name' => 'Отчество!']],
            'personal name digits rejected' => [['first_name' => 'Имя2']],
            'corporate organization name without letters' => [['account_type' => 'corporate', 'organization_type' => 'ООО', 'organization_name' => '123 №']],
            'corporate organization name unsupported symbols' => [['account_type' => 'corporate', 'organization_type' => 'ООО', 'organization_name' => 'Ромашка!']],
            'invalid organization type' => [['account_type' => 'corporate', 'organization_type' => 'АО', 'organization_name' => 'Ромашка']],
            'short password' => [['password' => 'Ab12', 'confirm_password' => 'Ab12']],
            'long password' => [['password' => str_repeat('a', 128).'1', 'confirm_password' => str_repeat('a', 128).'1']],
            'non-string password' => [['password' => ['Password123']]],
            'no password digit' => [['password' => 'Password!', 'confirm_password' => 'Password!']],
            'no password letter' => [['password' => '123456', 'confirm_password' => '123456']],
            'no lowercase password letter' => [['password' => 'PASSWORD123!', 'confirm_password' => 'PASSWORD123!']],
            'no uppercase password letter' => [['password' => 'password123!', 'confirm_password' => 'password123!']],
            'no password symbol' => [['password' => 'Password123', 'confirm_password' => 'Password123']],
            'password whitespace' => [['password' => 'Pass 123', 'confirm_password' => 'Pass 123']],
            'non-ascii password' => [['password' => 'Пароль123', 'confirm_password' => 'Пароль123']],
            'confirmation mismatch' => [['confirm_password' => 'Another123']],
            'confirmation not trimmed' => [['confirm_password' => 'Password123 ']],
            'non-string confirmation' => [['confirm_password' => true]],
            'bad email' => [['email' => 'not-an-email']],
            'missing email' => [['email' => '']],
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

        $user->username = '@'.$user->username;
        $user->save();
        $this->postRegistration($this->registration(['username' => $user->username]))
            ->assertConflict()
            ->assertExactJson(['success' => false, 'error' => 'Этот логин уже используется личным аккаунтом.']);

        $this->assertSame($boards, Board::count());
        $this->assertGuest();
    }

    public function test_duplicate_normalized_email_is_a_conflict(): void
    {
        $user = $this->createUser();
        $user->update(['email' => 'person@example.com']);

        $this->postRegistration($this->registration(['email' => 'PERSON@EXAMPLE.COM']))->assertConflict();
        $this->assertFalse(User::where('username', '@NewUser')->exists());
    }

    public function test_failure_to_create_the_default_board_rolls_back_the_user(): void
    {
        Board::creating(fn () => throw new RuntimeException('Private board creation error'));

        $this->postRegistration($this->registration())
            ->assertStatus(500)
            ->assertExactJson(['success' => false, 'error' => 'Не удалось выполнить запрос. Попробуйте позже.']);

        $this->assertFalse(User::where('username', '@NewUser')->exists());
        $this->getAuth()->assertJsonPath('data.user', null);
    }

    public function test_a_128_character_password_is_not_truncated_at_72_bytes(): void
    {
        $password = str_repeat('a', 124).'Aa1!';
        $response = $this->postRegistration($this->registration(['password' => $password, 'confirm_password' => $password]))->assertCreated();
        $user = User::findOrFail($response->json('data.user.id'));

        $this->assertTrue(Hash::check($password, $user->getAuthPassword()));
        $this->assertFalse(Hash::check(str_repeat('a', 124).'Aa2!', $user->getAuthPassword()));

        $this->postAuth(['action' => 'logout'])->assertOk();
        $this->postAuth(['action' => 'login', 'username' => $user->username, 'password' => $password])->assertOk();
    }

    public function test_a_password_that_looks_like_a_hash_is_hashed_as_plain_input(): void
    {
        $password = 'A!'.password_hash('SomeOther123', PASSWORD_BCRYPT, ['cost' => 4]);
        $response = $this->postRegistration($this->registration(['password' => $password, 'confirm_password' => $password]))->assertCreated();
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
                'data' => ['user' => ['id' => $id, 'username' => 'OldUser', 'account_type' => 'individual'], 'corporate_account' => null],
            ]);

        $this->assertSame($hash, DB::table('users')->where('id', $id)->value('password_hash'));
        $this->assertNotSame($oldId, $this->app['session.store']->getId());
        $this->assertNotSame($oldToken, $this->app['session.store']->token());
        $this->getAuth()->assertJsonPath('data.user.id', $id);
    }

    public function test_email_login_offers_account_choice_for_shared_personal_and_corporate_email(): void
    {
        $email = 'dual-login-'.bin2hex(random_bytes(5)).'@example.com';
        $personal = $this->createUser();
        $personal->forceFill(['email' => $email, 'account_type' => 'individual'])->save();
        $corporateId = DB::table('corporate_accounts')->insertGetId([
            'root_username' => '@DualRoot'.bin2hex(random_bytes(3)),
            'root_email' => $email,
            'root_password_hash' => Hash::make('Corporate123!'),
            'organization_name' => 'Dual login',
        ]);

        $this->postAuth(['action' => 'check_login_email', 'email' => strtoupper($email)])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['account_choices' => ['individual', 'corporate']]]);
        $this->postAuth(['action' => 'login', 'username' => strtoupper($email), 'password' => 'TestPassword123'])
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['account_choices' => ['individual', 'corporate']]]);
        $this->assertGuest();

        $this->postAuth(['action' => 'login', 'username' => $email, 'password' => 'TestPassword123', 'account_type' => 'individual'])
            ->assertOk()->assertJsonPath('data.user.id', $personal->id)->assertJsonPath('data.corporate_account', null);
        $this->postAuth(['action' => 'logout'])->assertOk();

        $this->postAuth(['action' => 'login', 'username' => $email, 'password' => 'Corporate123!', 'account_type' => 'corporate'])
            ->assertOk()->assertJsonPath('data.user', null)->assertJsonPath('data.corporate_account.id', $corporateId);
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
            'action' => 'register', 'username' => '@NewUser', 'first_name' => 'Имя', 'last_name' => 'Фамилия',
            'email' => 'new-'.bin2hex(random_bytes(6)).'@example.com',
            'password' => 'Password123!', 'confirm_password' => 'Password123!',
            'personal_data_consent' => true, 'marketing_consent' => false,
        ], $changes);
    }

    private function postRegistration(array $input): TestResponse
    {
        $email = $input['email'] ?? null;
        if (is_string($email) && filter_var(trim($email), FILTER_VALIDATE_EMAIL) !== false) {
            $this->withSession(['registration_verified_email' => strtolower(trim($email))]);
        }

        return $this->postAuth($input);
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
