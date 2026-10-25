<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

ini_set('session.use_strict_mode', '1');
session_set_cookie_params([
    'httponly' => true,
    'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Lax',
    'path' => '/',
]);
session_start();

function profileRespond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function profileFail(int $status, string $message): never
{
    profileRespond($status, ['success' => false, 'error' => $message]);
}

$sessionUser = $_SESSION['user'] ?? null;
if (!is_array($sessionUser) || !isset($sessionUser['id'])) {
    profileFail(401, 'Требуется войти в аккаунт.');
}

try {
    require dirname(__DIR__, 2) . '/includes/db.php';

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $statement = $pdo->prepare(
            "SELECT id, username, email, secondary_email, account_type, about,
                    username_changed_at,
                    username_changed_at + INTERVAL '24 hours' AS username_change_available_at,
                    avatar_mime, encode(avatar_data, 'base64') AS avatar_base64
             FROM users WHERE id = :id"
        );
        $statement->execute(['id' => $sessionUser['id']]);
        $profile = $statement->fetch();
        if (!$profile) profileFail(401, 'Требуется войти в аккаунт.');
        $avatar = null;
        if ($profile['avatar_base64'] !== null && $profile['avatar_mime'] !== null) {
            $avatarBase64 = str_replace(["\r", "\n"], '', $profile['avatar_base64']);
            $avatar = 'data:' . $profile['avatar_mime'] . ';base64,' . $avatarBase64;
        }
        profileRespond(200, [
            'success' => true,
            'data' => [
                'profile' => [
                    'id' => (int) $profile['id'],
                    'username' => $profile['username'],
                    'email' => $profile['email'],
                    'secondary_email' => $profile['secondary_email'],
                    'account_type' => $profile['account_type'],
                    'about' => $profile['about'],
                    'username_changed_at' => $profile['username_changed_at'],
                    'username_change_available_at' => $profile['username_change_available_at'],
                    'avatar' => $avatar,
                ],
            ],
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        header('Allow: GET, POST');
        profileFail(405, 'Method not allowed');
    }

    $csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($csrfToken)
        || !isset($_SESSION['csrf_token'])
        || !hash_equals($_SESSION['csrf_token'], $csrfToken)) {
        profileFail(403, 'Сессия истекла. Обновите страницу.');
    }

    $rawBody = file_get_contents('php://input', false, null, 0, 1_500_001);
    if ($rawBody === false || strlen($rawBody) > 1_500_000) {
        profileFail(413, 'Запрос слишком большой.');
    }
    $input = json_decode($rawBody, true);
    if (!is_array($input) || json_last_error() !== JSON_ERROR_NONE) {
        profileFail(400, 'Некорректный JSON-запрос.');
    }

    $username = $input['username'] ?? null;
    $email = $input['email'] ?? '';
    $secondaryEmail = $input['secondary_email'] ?? '';
    $about = $input['about'] ?? '';
    $accountType = $input['account_type'] ?? null;
    $currentPassword = $input['current_password'] ?? '';
    $newPassword = $input['new_password'] ?? '';
    $confirmation = $input['confirm_password'] ?? '';
    if (!is_string($username) || !preg_match('/^[A-Za-z][A-Za-z0-9_]{2,23}$/D', trim($username))
        || !is_string($email) || !is_string($secondaryEmail)
        || !is_string($about) || mb_strlen($about) > 1200
        || !is_string($accountType) || !in_array($accountType, ['individual', 'team', 'corporate'], true)) {
        profileFail(422, 'Проверьте логин и остальные данные профиля.');
    }
    $username = trim($username);
    $email = strtolower(trim($email));
    $secondaryEmail = strtolower(trim($secondaryEmail));
    foreach ([$email, $secondaryEmail] as $address) {
        if (strlen($address) > 254 || ($address !== '' && filter_var($address, FILTER_VALIDATE_EMAIL) === false)) {
            profileFail(422, 'Проверьте формат электронной почты.');
        }
    }
    if ($email !== '' && $email === $secondaryEmail) {
        profileFail(422, 'Основная и дополнительная почта должны различаться.');
    }
    if ($currentPassword !== '' || $newPassword !== '' || $confirmation !== '') {
        if (!is_string($currentPassword) || !is_string($newPassword) || !is_string($confirmation)
            || $currentPassword === '' || strlen($newPassword) < 6 || strlen($newPassword) > 128
            || !preg_match('/^[\x21-\x7E]+$/D', $newPassword)
            || !preg_match('/[A-Za-z]/', $newPassword) || !preg_match('/[0-9]/', $newPassword)
            || !hash_equals($newPassword, $confirmation)) {
            profileFail(422, 'Введите текущий пароль и два совпадающих новых пароля (6–128 символов, буква и цифра).');
        }
    }

    $avatarWasSent = array_key_exists('avatar', $input);
    $avatarBase64 = null;
    $avatarMime = null;
    if ($avatarWasSent && $input['avatar'] !== null) {
        if (!is_string($input['avatar'])
            || !preg_match('/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/D', $input['avatar'], $matches)) {
            profileFail(422, 'Аватар должен быть изображением JPEG, PNG или WebP.');
        }
        $avatarMime = $matches[1];
        $avatarBase64 = $matches[2];
        $avatarBytes = base64_decode($avatarBase64, true);
        if ($avatarBytes === false || strlen($avatarBytes) > 1_048_576) {
            profileFail(422, 'Размер аватара не должен превышать 1 МБ.');
        }
        $imageInfo = getimagesizefromstring($avatarBytes);
        $detectedMime = (new finfo(FILEINFO_MIME_TYPE))->buffer($avatarBytes);
        if ($imageInfo === false || $detectedMime !== $avatarMime
            || $imageInfo[0] > 2048 || $imageInfo[1] > 2048) {
            profileFail(422, 'Не удалось проверить изображение. Поддерживаются JPEG, PNG и WebP размером до 2048×2048.');
        }
    }

    $pdo->beginTransaction();
    $userQuery = $pdo->prepare(
        'SELECT username, password_hash, username_changed_at FROM users WHERE id = :id FOR UPDATE'
    );
    $userQuery->execute(['id' => $sessionUser['id']]);
    $currentUser = $userQuery->fetch();
    if (!$currentUser) {
        $pdo->rollBack();
        profileFail(401, 'Требуется войти в аккаунт.');
    }
    $usernameChanged = $username !== $currentUser['username'];
    if ($usernameChanged && $currentUser['username_changed_at'] !== null
        && strtotime($currentUser['username_changed_at']) > time() - 86400) {
        $pdo->rollBack();
        profileFail(429, 'Логин можно менять не чаще одного раза в 24 часа.');
    }
    $passwordHash = $currentUser['password_hash'];
    if ($newPassword !== '') {
        if (!password_verify($currentPassword, $currentUser['password_hash'])) {
            $pdo->rollBack();
            profileFail(403, 'Текущий пароль указан неверно.');
        }
        $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
        if ($passwordHash === false) throw new RuntimeException('Password hashing failed.');
    }

    if ($avatarWasSent && $avatarBase64 === null) {
        $avatarSql = ', avatar_data = NULL, avatar_mime = NULL';
    } elseif ($avatarWasSent) {
        $avatarSql = ', avatar_data = decode(:avatar_base64, \'base64\'), avatar_mime = :avatar_mime';
    } else {
        $avatarSql = '';
    }
    $update = $pdo->prepare(
        'UPDATE users SET username = :username,
             username_changed_at = CASE WHEN :username_changed THEN CURRENT_TIMESTAMP ELSE username_changed_at END,
             email = :email, secondary_email = :secondary_email, about = :about,
             account_type = :account_type, password_hash = :password_hash' . $avatarSql . '
         WHERE id = :id'
    );
    $parameters = [
        'username' => $username,
        'username_changed' => $usernameChanged,
        'email' => $email === '' ? null : $email,
        'secondary_email' => $secondaryEmail === '' ? null : $secondaryEmail,
        'about' => trim($about),
        'account_type' => $accountType,
        'password_hash' => $passwordHash,
        'id' => $sessionUser['id'],
    ];
    if ($avatarWasSent) {
        $parameters['avatar_base64'] = $avatarBase64;
        $parameters['avatar_mime'] = $avatarMime;
    }
    $update->execute($parameters);
    $pdo->commit();

    $_SESSION['user']['username'] = $username;
    $_SESSION['user']['account_type'] = $accountType;
    $statement = $pdo->prepare(
        "SELECT id, username, email, secondary_email, account_type, about,
                username_changed_at,
                username_changed_at + INTERVAL '24 hours' AS username_change_available_at,
                avatar_mime, encode(avatar_data, 'base64') AS avatar_base64
         FROM users WHERE id = :id"
    );
    $statement->execute(['id' => $sessionUser['id']]);
    $profile = $statement->fetch();
    $avatar = null;
    if ($profile['avatar_base64'] !== null && $profile['avatar_mime'] !== null) {
        $avatar = 'data:' . $profile['avatar_mime'] . ';base64,'
            . str_replace(["\r", "\n"], '', $profile['avatar_base64']);
    }
    profileRespond(200, [
        'success' => true,
        'data' => [
            'profile' => [
                'id' => (int) $profile['id'],
                'username' => $profile['username'],
                'email' => $profile['email'],
                'secondary_email' => $profile['secondary_email'],
                'account_type' => $profile['account_type'],
                'about' => $profile['about'],
                'username_changed_at' => $profile['username_changed_at'],
                'username_change_available_at' => $profile['username_change_available_at'],
                'avatar' => $avatar,
            ],
        ],
    ]);
} catch (PDOException $exception) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    if ($exception->getCode() === '23505') profileFail(409, 'Логин или электронная почта уже используются.');
    if ($exception->getCode() === '23514') profileFail(422, 'Проверьте данные профиля.');
    error_log('Profile database error: ' . $exception->getMessage());
    profileFail(500, 'Не удалось сохранить профиль. Попробуйте позже.');
} catch (Throwable $exception) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    error_log('Profile error: ' . $exception->getMessage());
    profileFail(500, 'Не удалось сохранить профиль. Попробуйте позже.');
}
