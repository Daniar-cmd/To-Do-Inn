<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Mail\CorporateAccountInvitation;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Mail\EmailVerificationCode;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class AuthController
{
    private const CONSENT_VERSION = '2026-10-draft-1';

    public function __invoke(Request $request): JsonResponse
    {
        if ($request->isMethod('GET')) {
            $rootAccountId = $request->session()->get('corporate_root_account_id');
            $rootAccount = is_int($rootAccountId)
                ? DB::table('corporate_accounts')->where('id', $rootAccountId)->select([
                    'id', 'root_username', 'organization_name', 'description', 'secondary_email', 'github_url', 'telegram_url', 'preferred_theme', 'avatar_mime',
                ])->selectRaw("encode(avatar_data, 'base64') AS avatar_base64")->first()
                : null;

            return $this->success([
                'csrf_token' => $request->session()->token(),
                'user' => $this->publicUser($request->user()),
                'corporate_account' => $rootAccount === null ? null : [
                    'id' => (int) $rootAccount->id,
                    'username' => $rootAccount->root_username,
                    'name' => $rootAccount->organization_name,
                    'description' => $rootAccount->description,
                    'secondary_email' => $rootAccount->secondary_email,
                    'github_url' => $rootAccount->github_url,
                    'telegram_url' => $rootAccount->telegram_url,
                    'preferred_theme' => $rootAccount->preferred_theme,
                    'avatar' => $rootAccount->avatar_mime === null ? null : 'data:'.$rootAccount->avatar_mime.';base64,'.str_replace(["\r", "\n"], '', $rootAccount->avatar_base64),
                ],
            ]);
        }

        // Read only the checked JSON body, never action or credentials from the query string.
        $input = $request->json()->all();
        $action = $input['action'] ?? '';
        if (!is_string($action)) {
            return $this->error(400, 'Invalid action');
        }

        return match ($action) {
            'send_verification_code' => $this->sendVerificationCode($request, $input),
            'verify_email_code' => $this->verifyEmailCode($request, $input),
            'accept_corporate_invitation' => $this->acceptCorporateInvitation($input),
            'validate_corporate_admin_identifier' => $this->validateCorporateAdminIdentifier($input),
            'validate_registration_username' => $this->validateRegistrationUsername($input),
            'validate_registration_email' => $this->validateRegistrationEmail($input),
            'register' => $this->register($request, $input),
            'login' => $this->login($request, $input),
            'logout' => $this->logout($request),
            default => $this->error(400, 'Unknown action'),
        };
    }

    private function sendVerificationCode(Request $request, #[\SensitiveParameter] array $input): JsonResponse
    {
        $email = $input['email'] ?? null;
        if (!is_string($email) || strlen(trim($email)) > 254
            || filter_var(trim($email), FILTER_VALIDATE_EMAIL) === false) {
            return $this->error(422, 'Проверьте формат e-mail.');
        }

        $email = strtolower(trim($email));
        $isLocal = app()->environment('local');
        $code = $isLocal ? '285868' : (string) random_int(100000, 999999);
        $cacheKey = 'email-verification-code:'.hash('sha256', $email);
        $codeHash = hash_hmac('sha256', $code, (string) config('app.key'));
        $expiresAt = now()->addMinutes(10);
        try {
            Cache::put($cacheKey, ['hash' => $codeHash, 'attempts' => 0, 'expires_at' => $expiresAt->timestamp], $expiresAt);
            if (!$isLocal) {
                Mail::to($email)->send(new EmailVerificationCode($code));
            }
        } catch (\Throwable) {
            Cache::forget($cacheKey);
            return $this->error(503, 'Не удалось отправить письмо. Попробуйте позже.');
        }
        $request->session()->forget('registration_verified_email');

        return $this->success($isLocal ? ['sent' => true, 'test_code' => $code] : ['sent' => true]);
    }

    private function verifyEmailCode(Request $request, #[\SensitiveParameter] array $input): JsonResponse
    {
        $email = $input['email'] ?? null;
        $code = $input['code'] ?? null;
        if (!is_string($email) || strlen(trim($email)) > 254
            || filter_var(trim($email), FILTER_VALIDATE_EMAIL) === false
            || !is_string($code) || !preg_match('/^[0-9]{6}$/D', $code)) {
            return $this->error(422, 'Проверьте e-mail и шестизначный код.');
        }

        $email = strtolower(trim($email));
        $cacheKey = 'email-verification-code:'.hash('sha256', $email);
        $record = Cache::get($cacheKey);
        if (!is_array($record) || !is_string($record['hash'] ?? null)
            || !is_int($record['expires_at'] ?? null) || $record['expires_at'] <= now()->timestamp) {
            Cache::forget($cacheKey);
            return $this->error(422, 'Код истёк. Запросите новый код.');
        }

        $attempts = (int) ($record['attempts'] ?? 0);
        if ($attempts >= 5) {
            Cache::forget($cacheKey);
            return $this->error(429, 'Слишком много попыток. Запросите новый код.');
        }

        $submittedHash = hash_hmac('sha256', $code, (string) config('app.key'));
        if (!hash_equals($record['hash'], $submittedHash)) {
            $attempts++;
            if ($attempts >= 5) {
                Cache::forget($cacheKey);
                return $this->error(429, 'Слишком много попыток. Запросите новый код.');
            }
            $record['attempts'] = $attempts;
            Cache::put($cacheKey, $record, now()->addSeconds(max(1, $record['expires_at'] - now()->timestamp)));

            return $this->error(422, 'Неверный код. Проверьте письмо и попробуйте ещё раз.');
        }

        Cache::forget($cacheKey);
        $request->session()->put('registration_verified_email', $email);

        return $this->success(['verified' => true]);
    }

    private function register(Request $request, #[\SensitiveParameter] array $input): JsonResponse
    {
        $input['email'] = $input['email'] ?? '';
        $input['account_type'] = $input['account_type'] ?? 'individual';

        $data = Validator::make($input, [
            'username' => ['bail', 'required', 'string', function (string $attribute, mixed $value, \Closure $fail): void {
                if (!str_starts_with($value, '@')) {
                    $fail('Логин должен начинаться с символа @.');
                } elseif (preg_match('/[^\x00-\x7F]/u', substr($value, 1))) {
                    $fail('Используйте только латинские буквы.');
                } elseif (!preg_match('/^@[A-Za-z]/D', $value)) {
                    $fail('После @ логин должен начинаться с латинской буквы.');
                } elseif (preg_match('/^@[A-Za-z][A-Za-z0-9_-]*$/D', $value) !== 1) {
                    $fail('После @ разрешены латинские буквы, цифры, дефис и подчёркивание.');
                } elseif (strlen($value) < 4) {
                    $fail('Логин вместе с @ должен содержать не менее 4 символов.');
                } elseif (strlen($value) > 24) {
                    $fail('Логин вместе с @ должен содержать не более 24 символов.');
                }
            }],
            'first_name' => ['bail', 'required_if:account_type,individual', 'nullable', 'string', 'max:60', 'regex:/^(?=.*[A-Za-zА-Яа-яЁё])[A-Za-zА-Яа-яЁё\-–—]{1,60}$/uD'],
            'last_name' => ['bail', 'required_if:account_type,individual', 'nullable', 'string', 'max:60', 'regex:/^(?=.*[A-Za-zА-Яа-яЁё])[A-Za-zА-Яа-яЁё\-–—]{1,60}$/uD'],
            'middle_name' => ['bail', 'nullable', 'string', 'max:60', 'regex:/^(?=.*[A-Za-zА-Яа-яЁё])[A-Za-zА-Яа-яЁё\-–—]{1,60}$/uD'],
            'password' => [
                'bail', 'required', 'string', 'min:8', 'max:128',
                'regex:/^[\x21-\x7E]+$/D', 'regex:/[a-z]/', 'regex:/[A-Z]/', 'regex:/[0-9]/', 'regex:/[^A-Za-z0-9]/',
            ],
            'confirm_password' => ['bail', 'required', 'string', 'same:password'],
            'email' => ['bail', 'required', 'string', 'max:254', function (string $attribute, mixed $value, \Closure $fail): void {
                if (filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
                    $fail('Проверьте формат e-mail.');
                }
            }],
            'account_type' => ['bail', 'required', 'string', Rule::in(['individual', 'corporate'])],
            'organization_type' => ['bail', 'required_if:account_type,corporate', 'nullable', 'string', Rule::in(['ИП', 'ООО', 'ПАО', 'НПАО', 'НКО', 'ГУП', 'МУП', 'Другое'])],
            'organization_name' => ['bail', 'required_if:account_type,corporate', 'nullable', 'string', 'max:160', function (string $attribute, mixed $value, \Closure $fail): void {
                if (!is_string($value) || preg_match("/^(?=.*[A-Za-zА-Яа-яЁё])[A-Za-zА-Яа-яЁё0-9 .,\"'«»‘’\\-–—‐‑№&]+$/uD", $value) !== 1) {
                    $fail('Название организации должно содержать хотя бы одну латинскую или кириллическую букву; разрешены также цифры, пробелы и символы . , кавычки, дефисы, № и &.');
                }
            }],
            'administrators' => ['required_if:account_type,corporate', 'prohibited_if:account_type,individual', 'array', 'min:1', 'max:5'],
            'administrators.*.role' => ['required', 'string', Rule::in(['owner', 'admin', 'manager', 'support'])],
            'administrators.*.identifier' => ['required', 'string', 'max:254'],
            'secondary_email' => ['nullable', 'string', 'max:254'],
            'about' => ['nullable', 'string', 'max:1200'],
            'github_url' => ['nullable', 'string', 'max:255', function (string $attribute, mixed $value, \Closure $fail): void {
                if ($value !== null && $value !== '' && (!is_string($value)
                    || preg_match('~^https://github\.com/[A-Za-z0-9-]{1,39}/?$~iD', $value) !== 1)) {
                    $fail('Укажите ссылку вида https://github.com/username.');
                }
            }],
            'telegram_url' => ['nullable', 'string', 'max:255', function (string $attribute, mixed $value, \Closure $fail): void {
                if ($value !== null && $value !== '' && (!is_string($value)
                    || preg_match('~^https://t\.me/[A-Za-z0-9_]{5,32}/?$~iD', $value) !== 1)) {
                    $fail('Укажите ссылку вида https://t.me/username.');
                }
            }],
            'preferred_theme' => ['nullable', 'string', Rule::in(['light', 'dark', 'system'])],
            'avatar' => ['nullable', 'string'],
            'personal_data_consent' => ['accepted'],
            'marketing_consent' => ['sometimes', 'boolean'],
        ], [
            'first_name.*' => 'Имя должно содержать только кириллические или латинские буквы и тире.',
            'last_name.*' => 'Фамилия должна содержать только кириллические или латинские буквы и тире.',
            'middle_name.*' => 'Отчество должно содержать только кириллические или латинские буквы и тире.',
            'password.*' => 'Пароль должен содержать 8–128 символов, строчную и заглавную латинские буквы, цифру и специальный символ; пробелы не допускаются.',
            'confirm_password.*' => 'Пароли должны совпадать.',
            'email.*' => 'Проверьте формат e-mail.',
            'account_type.*' => 'Invalid account type',
            'organization_type.*' => 'Выберите тип организации из списка.',
            'organization_name.*' => 'Введите корректное название организации.',
            'personal_data_consent.accepted' => 'Для регистрации необходимо согласиться на обработку персональных данных.',
        ])->stopOnFirstFailure()->validate();

        $email = strtolower($data['email']);
        $secondaryEmail = strtolower(trim((string) ($data['secondary_email'] ?? '')));
        if ($secondaryEmail !== '' && (filter_var($secondaryEmail, FILTER_VALIDATE_EMAIL) === false
            || strlen($secondaryEmail) > 254 || $secondaryEmail === $email)) {
            return $this->error(422, 'Проверьте дополнительную почту: она должна отличаться от основной.');
        }
        $githubUrl = trim((string) ($data['github_url'] ?? ''));
        if ($githubUrl !== '' && preg_match('~^https://github\.com/[A-Za-z0-9-]{1,39}/?$~iD', $githubUrl) !== 1) {
            return $this->error(422, 'Укажите ссылку вида https://github.com/username.');
        }
        $telegramUrl = trim((string) ($data['telegram_url'] ?? ''));
        if ($telegramUrl !== '' && preg_match('~^https://t\.me/[A-Za-z0-9_]{5,32}/?$~iD', $telegramUrl) !== 1) {
            return $this->error(422, 'Укажите ссылку вида https://t.me/username.');
        }
        $avatar = ['base64' => null, 'mime' => null];
        if (($data['avatar'] ?? null) !== null) {
            $validatedAvatar = $this->validateAvatar($data['avatar']);
            if ($validatedAvatar instanceof JsonResponse) {
                return $validatedAvatar;
            }
            $avatar = $validatedAvatar;
        }
        $verifiedEmail = $request->session()->get('registration_verified_email');
        if (!is_string($verifiedEmail) || !hash_equals($verifiedEmail, $email)) {
            return $this->error(422, 'Сначала подтвердите e-mail.');
        }

        if ($data['account_type'] === 'individual'
            && User::query()->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            return $this->error(409, 'Этот e-mail уже привязан к личному аккаунту.');
        }
        if ($data['account_type'] === 'corporate'
            && DB::table('corporate_accounts')->whereRaw('LOWER(root_email) = ?', [$email])->exists()) {
            return $this->error(409, 'Эта почта уже привязана к аккаунту организации.');
        }
        if (User::query()->whereRaw('LOWER(username) = ?', [strtolower($data['username'])])->exists()) {
            return $this->error(409, 'Этот логин уже используется личным аккаунтом.');
        }
        if (DB::table('corporate_accounts')->whereRaw('LOWER(root_username) = ?', [strtolower($data['username'])])->exists()) {
            return $this->error(409, 'Этот логин уже используется аккаунтом организации.');
        }

        $administratorInvitations = [];
        if ($data['account_type'] === 'corporate') {
            $owners = array_filter($data['administrators'], static fn (array $administrator): bool => $administrator['role'] === 'owner');
            if (count($owners) !== 1 || ($data['administrators'][0]['role'] ?? null) !== 'owner') {
                return $this->error(422, 'Первая строка должна содержать единственного владельца аккаунта.');
            }

            $seenEmails = [];
            foreach ($data['administrators'] as $administrator) {
                $identifier = $administrator['identifier'];
                if ($identifier !== trim($identifier)) {
                    return $this->error(422, 'Уберите пробелы в логине или e-mail администратора.');
                }

                if ($administrator['role'] === 'owner') {
                    if (filter_var($identifier, FILTER_VALIDATE_EMAIL) !== false) {
                        $inviteEmail = strtolower($identifier);
                    } elseif (preg_match('/^@[A-Za-z][A-Za-z0-9_-]{2,23}$/D', $identifier) === 1) {
                        $ownerUser = User::query()->whereRaw('LOWER(username) = ?', [strtolower($identifier)])->first();
                        if ($ownerUser === null || !is_string($ownerUser->email) || filter_var($ownerUser->email, FILTER_VALIDATE_EMAIL) === false) {
                            return $this->error(422, 'По логину владельца не найден пользователь с e-mail. Укажите адрес почты для приглашения.');
                        }
                        $inviteEmail = strtolower($ownerUser->email);
                    } else {
                        return $this->error(422, 'Введите корректный e-mail или зарегистрированный логин владельца.');
                    }
                } elseif (filter_var($identifier, FILTER_VALIDATE_EMAIL) !== false) {
                    $inviteEmail = strtolower($identifier);
                } elseif (preg_match('/^@[A-Za-z][A-Za-z0-9_-]{2,23}$/D', $identifier) === 1) {
                    $existingUser = User::query()->whereRaw('LOWER(username) = ?', [strtolower($identifier)])->first();
                    if ($existingUser === null || !is_string($existingUser->email) || $existingUser->email === '') {
                        return $this->error(422, 'По этому логину не найден пользователь с e-mail. Укажите адрес почты для приглашения.');
                    }
                    $inviteEmail = strtolower($existingUser->email);
                } else {
                    return $this->error(422, 'Введите корректный e-mail или зарегистрированный логин администратора.');
                }

                $normalizedEmail = strtolower($inviteEmail);
                if (isset($seenEmails[$normalizedEmail])) {
                    return $this->error(422, 'Один и тот же пользователь указан несколько раз.');
                }
                $seenEmails[$normalizedEmail] = true;

                $token = bin2hex(random_bytes(32));
                $administratorInvitations[] = [
                    'email' => $normalizedEmail,
                    'role' => $administrator['role'],
                    'token' => $token,
                    'token_hash' => hash('sha256', $token),
                ];
            }
        }

        $passwordHash = Hash::make($data['password']);
        $sentInvitations = [];

        try {
            $result = DB::transaction(function () use ($data, $passwordHash, $administratorInvitations, $secondaryEmail, $githubUrl, $telegramUrl, $avatar, &$sentInvitations): array {
                if ($data['account_type'] === 'corporate') {
                    $accountId = DB::table('corporate_accounts')->insertGetId([
                        'root_username' => $data['username'],
                        'root_email' => strtolower($data['email']),
                        'root_password_hash' => $passwordHash,
                        'organization_type' => $data['organization_type'],
                        'organization_name' => $data['organization_name'],
                        'secondary_email' => $secondaryEmail === '' ? null : $secondaryEmail,
                        'description' => trim((string) ($data['about'] ?? '')),
                        'github_url' => $githubUrl === '' ? null : $githubUrl,
                        'telegram_url' => $telegramUrl === '' ? null : $telegramUrl,
                        'preferred_theme' => $data['preferred_theme'] ?? 'system',
                        'personal_data_consent_at' => now(),
                        'personal_data_consent_version' => self::CONSENT_VERSION,
                        'marketing_consent' => (bool) ($data['marketing_consent'] ?? false),
                        'marketing_consent_at' => ($data['marketing_consent'] ?? false) ? now() : null,
                    ], 'id');
                    if ($avatar['base64'] !== null) {
                        DB::update("UPDATE corporate_accounts SET avatar_data = decode(?, 'base64'), avatar_mime = ? WHERE id = ?", [
                            $avatar['base64'], $avatar['mime'], $accountId,
                        ]);
                    }

                    foreach ($administratorInvitations as $invitation) {
                        DB::table('corporate_account_members')->insert([
                            'corporate_account_id' => $accountId,
                            'email' => $invitation['email'],
                            'role' => $invitation['role'],
                            'invitation_token_hash' => $invitation['token_hash'],
                            'invitation_expires_at' => now()->addDays(7),
                        ]);
                        $sentInvitations[] = $invitation;
                    }

                    return ['corporate_account_id' => $accountId, 'user' => null];
                }

                $user = User::create([
                    'username' => $data['username'],
                    'first_name' => $data['first_name'] ?? '',
                    'last_name' => $data['last_name'] ?? '',
                    'middle_name' => $data['middle_name'] ?? null,
                    'email' => strtolower($data['email']),
                    'password_hash' => $passwordHash,
                    'account_type' => 'individual',
                    'secondary_email' => $secondaryEmail === '' ? null : $secondaryEmail,
                    'about' => trim((string) ($data['about'] ?? '')),
                    'github_url' => $githubUrl === '' ? null : $githubUrl,
                    'telegram_url' => $telegramUrl === '' ? null : $telegramUrl,
                    'preferred_theme' => $data['preferred_theme'] ?? 'system',
                    'personal_data_consent_at' => now(),
                    'personal_data_consent_version' => self::CONSENT_VERSION,
                    'marketing_consent' => (bool) ($data['marketing_consent'] ?? false),
                    'marketing_consent_at' => ($data['marketing_consent'] ?? false) ? now() : null,
                ]);
                if ($avatar['base64'] !== null) {
                    DB::update("UPDATE users SET avatar_data = decode(?, 'base64'), avatar_mime = ? WHERE id = ?", [
                        $avatar['base64'], $avatar['mime'], $user->id,
                    ]);
                }
                $board = $user->boards()->create(['name' => '👋 Hello World!', 'is_default' => true]);
                DB::table('task_lists')->insert([
                    'user_id' => $user->id,
                    'board_id' => $board->id,
                    'name' => '👋 Hello World!',
                    'description' => 'Это ваш первый список',
                ]);

                $acceptedOwnerAccounts = DB::table('corporate_account_members')
                    ->whereRaw('LOWER(email) = ?', [strtolower($data['email'])])
                    ->whereNull('user_id')
                    ->whereNotNull('accepted_at')
                    ->where('role', 'owner')
                    ->pluck('corporate_account_id');
                DB::table('corporate_account_members')
                    ->whereRaw('LOWER(email) = ?', [strtolower($data['email'])])
                    ->whereNull('user_id')
                    ->whereNotNull('accepted_at')
                    ->update(['user_id' => $user->id]);
                foreach ($acceptedOwnerAccounts as $accountId) {
                    $this->ensureCorporateBoard((int) $accountId, $user->id);
                }

                return ['corporate_account_id' => null, 'user' => $user];
            });
        } catch (QueryException $exception) {
            if ($exception->getCode() === '23505') {
                return $this->error(409, 'Логин или e-mail уже используется.');
            }

            throw $exception;
        }

        $user = $result['user'];

        $deliveryFailures = [];
        foreach ($sentInvitations as $invitation) {
            $invitationUrl = rtrim((string) config('app.frontend_url'), '/').'/pages/corporate-invitation.html?token='.$invitation['token'];
            try {
                Mail::to($invitation['email'])->send(new CorporateAccountInvitation(
                    $data['organization_type'],
                    $data['organization_name'],
                    $invitation['role'],
                    $invitationUrl,
                ));
            } catch (\Throwable $exception) {
                Log::warning('Corporate account invitation email could not be sent.', [
                    'recipient_hash' => hash('sha256', $invitation['email']),
                    'exception' => $exception::class,
                ]);
                $deliveryFailures[] = $invitation['email'];
            }
        }

        // The session guard rotates the session ID; also explicitly replace the pre-login CSRF token.
        if ($user instanceof User) {
            Auth::login($user);
        }
        $request->session()->forget('registration_verified_email');
        $request->session()->regenerateToken();

        return $this->success([
            'user' => $this->publicUser($user),
            'corporate_account' => $result['corporate_account_id'] === null ? null : [
                'id' => $result['corporate_account_id'],
                'name' => $data['organization_name'],
            ],
            'invitation_delivery_failures' => $deliveryFailures,
        ], 201);
    }

    private function acceptCorporateInvitation(#[\SensitiveParameter] array $input): JsonResponse
    {
        $token = $input['token'] ?? null;
        if (!is_string($token) || preg_match('/^[a-f0-9]{64}$/D', $token) !== 1) {
            return $this->error(422, 'Ссылка приглашения некорректна или истекла.');
        }

        $invitation = DB::transaction(function () use ($token): ?array {
            $member = DB::table('corporate_account_members')
                ->where('invitation_token_hash', hash('sha256', $token))
                ->lockForUpdate()
                ->first();
            if ($member === null || $member->accepted_at !== null
                || $member->invitation_expires_at === null
                || now()->greaterThanOrEqualTo($member->invitation_expires_at)) {
                return null;
            }

            $user = User::query()->whereRaw('LOWER(email) = ?', [strtolower($member->email)])->first();
            DB::table('corporate_account_members')->where('id', $member->id)->update([
                'user_id' => $user?->id,
                'accepted_at' => now(),
                'invitation_token_hash' => null,
                'invitation_expires_at' => null,
            ]);

            if ($user !== null && $member->role === 'owner') {
                $this->ensureCorporateBoard((int) $member->corporate_account_id, $user->id);
            }

            return ['registered' => $user !== null, 'role' => $member->role];
        });

        if ($invitation === null) {
            return $this->error(422, 'Ссылка приглашения некорректна, уже использована или истекла.');
        }

        return $this->success($invitation);
    }

    private function ensureCorporateBoard(int $corporateAccountId, int $ownerUserId): void
    {
        if (DB::table('boards')->where('corporate_account_id', $corporateAccountId)->exists()) {
            return;
        }

        $accountName = DB::table('corporate_accounts')->where('id', $corporateAccountId)->value('organization_name');
        $boardId = DB::table('boards')->insertGetId([
            'user_id' => $ownerUserId,
            'corporate_account_id' => $corporateAccountId,
            'name' => mb_substr((string) ($accountName ?: 'Рабочая среда'), 0, 60),
            'description' => '',
            'board_type' => 'corporate',
        ]);
        DB::table('task_lists')->insert([
            'user_id' => $ownerUserId,
            'board_id' => $boardId,
            'name' => '👋 Hello World!',
            'description' => 'Первый список организации',
        ]);
    }

    private function validateAvatar(mixed $value): array|JsonResponse
    {
        if (!is_string($value)
            || !preg_match('/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/D', $value, $matches)) {
            return $this->error(422, 'Аватар должен быть изображением JPEG, PNG или WebP.');
        }

        $bytes = base64_decode($matches[2], true);
        if ($bytes === false || strlen($bytes) > 1_048_576) {
            return $this->error(422, 'Размер аватара не должен превышать 1 МБ.');
        }

        $info = @getimagesizefromstring($bytes);
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
        if ($info === false || $mime !== $matches[1]
            || $info[0] < 1 || $info[1] < 1 || $info[0] > 2048 || $info[1] > 2048) {
            return $this->error(422, 'Не удалось проверить изображение. Поддерживаются JPEG, PNG и WebP размером до 2048×2048.');
        }

        return ['base64' => base64_encode($bytes), 'mime' => $mime];
    }

    private function validateCorporateAdminIdentifier(#[\SensitiveParameter] array $input): JsonResponse
    {
        $identifier = $input['identifier'] ?? null;
        if (!is_string($identifier) || $identifier === '' || $identifier !== trim($identifier) || strlen($identifier) > 254) {
            return $this->error(422, 'Введите корректный e-mail или логин администратора.');
        }

        if (filter_var($identifier, FILTER_VALIDATE_EMAIL) !== false) {
            return $this->success(['valid' => true]);
        }

        if (preg_match('/^@[A-Za-z][A-Za-z0-9_-]{2,23}$/D', $identifier) !== 1) {
            return $this->error(422, 'Введите корректный e-mail или логин администратора.');
        }

        $user = User::query()->whereRaw('LOWER(username) = ?', [strtolower($identifier)])->first();
        if ($user === null || !is_string($user->email) || filter_var($user->email, FILTER_VALIDATE_EMAIL) === false) {
            return $this->error(422, 'Не удалось найти пользователя с таким логином и e-mail.');
        }

        return $this->success(['valid' => true]);
    }

    private function validateRegistrationUsername(#[\SensitiveParameter] array $input): JsonResponse
    {
        $username = $input['username'] ?? null;
        if (!is_string($username) || preg_match('/^@[A-Za-z][A-Za-z0-9_-]{2,22}$/D', $username) !== 1) {
            return $this->error(422, 'Проверьте формат логина.');
        }

        if (User::query()->whereRaw('LOWER(username) = ?', [strtolower($username)])->exists()) {
            return $this->error(409, 'Этот логин уже используется личным аккаунтом.');
        }
        if (DB::table('corporate_accounts')->whereRaw('LOWER(root_username) = ?', [strtolower($username)])->exists()) {
            return $this->error(409, 'Этот логин уже используется аккаунтом организации.');
        }

        return $this->success(['available' => true]);
    }

    private function validateRegistrationEmail(#[\SensitiveParameter] array $input): JsonResponse
    {
        $email = $input['email'] ?? null;
        $accountType = $input['account_type'] ?? null;
        if (!is_string($email) || strlen(trim($email)) > 254
            || filter_var(trim($email), FILTER_VALIDATE_EMAIL) === false
            || !in_array($accountType, ['individual', 'corporate'], true)) {
            return $this->error(422, 'Проверьте e-mail и тип аккаунта.');
        }

        $email = strtolower(trim($email));
        if ($accountType === 'individual'
            && User::query()->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            return $this->error(409, 'Этот e-mail уже привязан к личному аккаунту.');
        }
        if ($accountType === 'corporate'
            && DB::table('corporate_accounts')->whereRaw('LOWER(root_email) = ?', [$email])->exists()) {
            return $this->error(409, 'Эта почта уже привязана к аккаунту организации.');
        }

        return $this->success(['available' => true]);
    }

    private function login(Request $request, #[\SensitiveParameter] array $input): JsonResponse
    {
        $username = $input['username'] ?? null;
        $password = $input['password'] ?? null;
        // Preserve legacy login semantics, including significant whitespace; the JSON body is bounded to 8 KiB.
        if (!is_string($username) || !is_string($password) || $username === '' || $password === '') {
            return $this->error(422, 'Введите логин и пароль.');
        }

        if (Auth::attempt(['username' => $username, 'password' => $password])) {
            $request->session()->forget('corporate_root_account_id');
            $request->session()->regenerateToken();

            return $this->success(['user' => $this->publicUser(Auth::user()), 'corporate_account' => null]);
        }

        $corporateAccount = DB::table('corporate_accounts')
            ->whereRaw('LOWER(root_username) = ?', [strtolower($username)])->first();
        if ($corporateAccount === null || !is_string($corporateAccount->root_password_hash)
            || !Hash::check($password, $corporateAccount->root_password_hash)) {
            return $this->error(401, 'Неверный логин или пароль.');
        }

        Auth::logout();
        $request->session()->put('corporate_root_account_id', (int) $corporateAccount->id);
        $request->session()->regenerate();
        $request->session()->regenerateToken();

        return $this->success([
            'user' => null,
            'corporate_account' => [
                'id' => (int) $corporateAccount->id,
                'username' => $corporateAccount->root_username,
                'name' => $corporateAccount->organization_name,
            ],
        ]);
    }

    private function logout(Request $request): JsonResponse
    {
        Auth::logout();
        $request->session()->forget('corporate_root_account_id');
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return $this->success(['logged_out' => true]);
    }

    private function publicUser(?User $user): ?array
    {
        return $user === null ? null : [
            'id' => (int) $user->id,
            'username' => $user->username,
            'account_type' => $user->account_type,
        ];
    }

    private function success(array $data, int $status = 200): JsonResponse
    {
        return response()->json(['success' => true, 'data' => $data], $status);
    }

    private function error(int $status, string $message): JsonResponse
    {
        return response()->json(['success' => false, 'error' => $message], $status);
    }
}
