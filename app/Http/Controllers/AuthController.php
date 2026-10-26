<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class AuthController
{
    public function __invoke(Request $request): JsonResponse
    {
        if ($request->isMethod('GET')) {
            return $this->success([
                'csrf_token' => $request->session()->token(),
                'user' => $this->publicUser($request->user()),
            ]);
        }

        // Read only the checked JSON body, never action or credentials from the query string.
        $input = $request->json()->all();
        $action = $input['action'] ?? '';
        if (!is_string($action)) {
            return $this->error(400, 'Invalid action');
        }

        return match ($action) {
            'register' => $this->register($request, $input),
            'login' => $this->login($request, $input),
            'logout' => $this->logout($request),
            default => $this->error(400, 'Unknown action'),
        };
    }

    private function register(Request $request, #[\SensitiveParameter] array $input): JsonResponse
    {
        $input['email'] = $input['email'] ?? '';
        $input['account_type'] = $input['account_type'] ?? 'individual';

        $data = Validator::make($input, [
            'username' => ['bail', 'required', 'string', 'regex:/^[A-Za-z][A-Za-z0-9_]{2,23}$/D'],
            'password' => [
                'bail', 'required', 'string', 'min:6', 'max:128',
                'regex:/^[\x21-\x7E]+$/D', 'regex:/[A-Za-z]/', 'regex:/[0-9]/',
            ],
            'confirm_password' => ['bail', 'required', 'string', 'same:password'],
            'email' => ['bail', 'string', 'max:254', function (string $attribute, mixed $value, \Closure $fail): void {
                if ($value !== '' && filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
                    $fail('Проверьте формат e-mail.');
                }
            }],
            'account_type' => ['bail', 'required', 'string', Rule::in(['individual', 'team', 'corporate'])],
        ], [
            'username.*' => 'Проверьте логин.',
            'password.*' => 'Пароль должен содержать 6–128 символов, латинскую букву и цифру; пробелы не допускаются.',
            'confirm_password.*' => 'Пароли должны совпадать.',
            'email.*' => 'Проверьте формат e-mail.',
            'account_type.*' => 'Invalid account type',
        ])->stopOnFirstFailure()->validate();

        // Explicitly hash even if the submitted password itself looks like a hash.
        $passwordHash = Hash::make($data['password']);

        try {
            $user = DB::transaction(function () use ($data, $passwordHash): User {
                $user = User::create([
                    'username' => $data['username'],
                    'email' => $data['email'] === '' ? null : strtolower($data['email']),
                    'password_hash' => $passwordHash,
                    'account_type' => $data['account_type'],
                ]);
                $user->boards()->create(['name' => '👋 Hello World!', 'is_default' => true]);

                return $user;
            });
        } catch (QueryException $exception) {
            if ($exception->getCode() === '23505') {
                return $this->error(409, 'Логин или e-mail уже используется.');
            }

            throw $exception;
        }

        // The session guard rotates the session ID; also explicitly replace the pre-login CSRF token.
        Auth::login($user);
        $request->session()->regenerateToken();

        return $this->success(['user' => $this->publicUser($user)], 201);
    }

    private function login(Request $request, #[\SensitiveParameter] array $input): JsonResponse
    {
        $username = $input['username'] ?? null;
        $password = $input['password'] ?? null;
        // Preserve legacy login semantics, including significant whitespace; the JSON body is bounded to 8 KiB.
        if (!is_string($username) || !is_string($password) || $username === '' || $password === '') {
            return $this->error(422, 'Введите логин и пароль.');
        }

        if (!Auth::attempt(['username' => $username, 'password' => $password])) {
            return $this->error(401, 'Неверный логин или пароль.');
        }

        $request->session()->regenerateToken();

        return $this->success(['user' => $this->publicUser(Auth::user())]);
    }

    private function logout(Request $request): JsonResponse
    {
        Auth::logout();
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
