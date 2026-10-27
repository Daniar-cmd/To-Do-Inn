<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class ProfileController
{
    public function __invoke(Request $request): JsonResponse
    {
        // Never take a profile ID from the JSON body, query string or session's legacy "user" field.
        $userId = (int) $request->user()->getAuthIdentifier();
        if ($request->isMethod('GET')) {
            return $this->success($this->readProfile($userId));
        }

        return $this->update($userId, $request->json()->all());
    }

    private function update(int $userId, #[\SensitiveParameter] array $input): JsonResponse
    {
        $storedPreferences = DB::table('users')->where('id', $userId)->first(['github_url', 'telegram_url', 'preferred_theme']);
        $input['github_url'] ??= $storedPreferences?->github_url ?? '';
        $input['telegram_url'] ??= $storedPreferences?->telegram_url ?? '';
        $input['preferred_theme'] ??= $storedPreferences?->preferred_theme ?? 'system';
        foreach (['email', 'secondary_email', 'about', 'current_password', 'new_password', 'confirm_password'] as $field) {
            $input[$field] = $input[$field] ?? '';
        }
        if (is_string($input['username'] ?? null)) {
            $input['username'] = trim($input['username']);
        }

        $data = Validator::make($input, [
            'username' => ['bail', 'required', 'string', 'regex:/^(?:[A-Za-z][A-Za-z0-9_@-]{3,23}|@[A-Za-z][A-Za-z0-9_-]{2,22})$/D'],
            'email' => ['string'],
            'secondary_email' => ['string'],
            'about' => ['bail', 'string', 'max:1200'],
            'github_url' => ['bail', 'nullable', 'string', 'max:255', function (string $attribute, mixed $value, \Closure $fail): void {
                if ($value !== null && $value !== '' && (!is_string($value)
                    || preg_match('~^https://github\.com/[A-Za-z0-9-]{1,39}/?$~iD', $value) !== 1)) {
                    $fail('Укажите ссылку вида https://github.com/username.');
                }
            }],
            'telegram_url' => ['bail', 'nullable', 'string', 'max:255', function (string $attribute, mixed $value, \Closure $fail): void {
                if ($value !== null && $value !== '' && (!is_string($value)
                    || preg_match('~^https://t\.me/[A-Za-z0-9_]{5,32}/?$~iD', $value) !== 1)) {
                    $fail('Укажите ссылку вида https://t.me/username.');
                }
            }],
            'preferred_theme' => ['bail', 'required', 'string', Rule::in(['light', 'dark', 'system'])],
            'account_type' => ['bail', 'required', 'string', Rule::in(['individual', 'team', 'corporate'])],
        ], ['*' => 'Проверьте логин и остальные данные профиля.'])
            ->stopOnFirstFailure()->validate();

        $data['email'] = strtolower(trim($data['email']));
        $data['secondary_email'] = strtolower(trim($data['secondary_email']));
        foreach ([$data['email'], $data['secondary_email']] as $email) {
            if (strlen($email) > 254 || ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false)) {
                return $this->error(422, 'Проверьте формат электронной почты.');
            }
        }
        if ($data['email'] !== '' && $data['email'] === $data['secondary_email']) {
            return $this->error(422, 'Основная и дополнительная почта должны различаться.');
        }

        $currentPassword = $input['current_password'];
        $newPassword = $input['new_password'];
        $confirmation = $input['confirm_password'];
        if ($currentPassword !== '' || $newPassword !== '' || $confirmation !== '') {
            if (!is_string($currentPassword) || !is_string($newPassword) || !is_string($confirmation)
                || $currentPassword === '' || strlen($newPassword) < 6 || strlen($newPassword) > 128
                || !preg_match('/^[\x21-\x7E]+$/D', $newPassword)
                || !preg_match('/[A-Za-z]/', $newPassword) || !preg_match('/[0-9]/', $newPassword)
                || !hash_equals($newPassword, $confirmation)) {
                return $this->error(422, 'Введите текущий пароль и два совпадающих новых пароля (6–128 символов, буква и цифра).');
            }
        }

        $avatarWasSent = array_key_exists('avatar', $input);
        $avatar = ['base64' => null, 'mime' => null];
        if ($avatarWasSent && $input['avatar'] !== null) {
            $avatar = $this->validateAvatar($input['avatar']);
            if ($avatar instanceof JsonResponse) {
                return $avatar;
            }
        }

        if ($newPassword !== '') {
            // Account-scoped, so changing the IP or session cannot reset current-password guesses.
            $key = 'profile-password:'.$userId;
            if (RateLimiter::tooManyAttempts($key, 5)) {
                return $this->error(429, 'Слишком много запросов. Попробуйте позже.')
                    ->header('Retry-After', (string) RateLimiter::availableIn($key));
            }
            RateLimiter::hit($key, 60);
        }

        try {
            $result = DB::transaction(function () use ($userId, $data, $currentPassword, $newPassword, $avatarWasSent, $avatar): array|JsonResponse {
                // Re-read under a row lock: concurrent requests cannot bypass the 24-hour rename rule
                // or overwrite a password after another request has already changed it.
                $user = User::query()->whereKey($userId)->lockForUpdate()->first();
                if ($user === null) {
                    throw new AuthenticationException;
                }

                $usernameChanged = $user->username !== $data['username'];
                if ($usernameChanged && $user->username_changed_at !== null
                    && $user->username_changed_at->getTimestamp() > now()->getTimestamp() - 86400) {
                    return $this->error(429, 'Логин можно менять не чаще одного раза в 24 часа.');
                }

                $fields = [
                    'username' => $data['username'],
                    'email' => $data['email'] === '' ? null : $data['email'],
                    'secondary_email' => $data['secondary_email'] === '' ? null : $data['secondary_email'],
                    'about' => trim($data['about']),
                    'github_url' => trim((string) $data['github_url']) === '' ? null : trim((string) $data['github_url']),
                    'telegram_url' => trim((string) $data['telegram_url']) === '' ? null : trim((string) $data['telegram_url']),
                    'preferred_theme' => $data['preferred_theme'],
                    'account_type' => $data['account_type'],
                ];
                if ($usernameChanged) {
                    // Include the timezone explicitly; the PostgreSQL server need not use PHP's UTC timezone.
                    $fields['username_changed_at'] = now()->format('Y-m-d H:i:s.uP');
                }
                if ($newPassword !== '') {
                    if (!Hash::check($currentPassword, $user->getAuthPassword())) {
                        return $this->error(403, 'Текущий пароль указан неверно.');
                    }
                    $fields['password_hash'] = Hash::make($newPassword);
                }

                User::query()->whereKey($userId)->update($fields);
                if ($avatarWasSent) {
                    // A bound base64 parameter avoids PDO's binary/text ambiguity for PostgreSQL BYTEA.
                    // decode(NULL, 'base64') is NULL, so explicit avatar deletion uses the same safe query.
                    DB::update("UPDATE users SET avatar_data = decode(?, 'base64'), avatar_mime = ? WHERE id = ?", [
                        $avatar['base64'], $avatar['mime'], $userId,
                    ]);
                }

                return $this->readProfile($userId);
            });
        } catch (QueryException $exception) {
            if ($exception->getCode() === '23505') {
                return $this->error(409, 'Логин или электронная почта уже используются.');
            }
            if ($exception->getCode() === '23514') {
                return $this->error(422, 'Проверьте данные профиля.');
            }

            throw $exception;
        }

        // Keep the current session and CSRF token valid, as the existing React form expects.
        return $result instanceof JsonResponse ? $result : $this->success($result);
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

        // Invalid/truncated input can emit warnings; turn expected validation failures into JSON 422, not debug output.
        $info = @getimagesizefromstring($bytes);
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
        if ($info === false || $mime !== $matches[1]
            || $info[0] < 1 || $info[1] < 1 || $info[0] > 2048 || $info[1] > 2048) {
            return $this->error(422, 'Не удалось проверить изображение. Поддерживаются JPEG, PNG и WebP размером до 2048×2048.');
        }

        return ['base64' => base64_encode($bytes), 'mime' => $mime];
    }

    private function readProfile(int $userId): array
    {
        $user = User::query()->select([
            'id', 'username', 'email', 'secondary_email', 'account_type', 'about', 'github_url', 'telegram_url', 'preferred_theme', 'username_changed_at', 'avatar_mime',
        ])->selectRaw("username_changed_at + INTERVAL '24 hours' AS username_change_available_at")
            ->selectRaw("encode(avatar_data, 'base64') AS avatar_base64")
            ->whereKey($userId)->first();
        if ($user === null) {
            throw new AuthenticationException;
        }

        $avatar = null;
        if ($user->avatar_base64 !== null && in_array($user->avatar_mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            $avatar = 'data:'.$user->avatar_mime.';base64,'.str_replace(["\r", "\n"], '', $user->avatar_base64);
        }

        return [
            'id' => (int) $user->id,
            'username' => $user->username,
            'email' => $user->email,
            'secondary_email' => $user->secondary_email,
            'account_type' => $user->account_type,
            'about' => $user->about,
            'github_url' => $user->github_url,
            'telegram_url' => $user->telegram_url,
            'preferred_theme' => $user->preferred_theme,
            'username_changed_at' => $user->getRawOriginal('username_changed_at'),
            'username_change_available_at' => $user->getRawOriginal('username_change_available_at'),
            'avatar' => $avatar,
        ];
    }

    private function success(array $profile): JsonResponse
    {
        return response()->json(['success' => true, 'data' => ['profile' => $profile]]);
    }

    private function error(int $status, string $message): JsonResponse
    {
        return response()->json(['success' => false, 'error' => $message], $status);
    }
}
