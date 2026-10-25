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

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $message): never
{
    respond($status, ['success' => false, 'error' => $message]);
}

function publicUser(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'account_type' => $user['account_type'],
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!isset($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    respond(200, [
        'success' => true,
        'data' => [
            'csrf_token' => $_SESSION['csrf_token'],
            'user' => $_SESSION['user'] ?? null,
        ],
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: GET, POST');
    fail(405, 'Method not allowed');
}

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
if (!preg_match('/^application\/json(?:\s*;|$)/i', $contentType)) {
    fail(415, 'Expected a JSON request');
}

$rawBody = file_get_contents('php://input', false, null, 0, 8193);
if ($rawBody === false || strlen($rawBody) > 8192) {
    fail(413, 'Request is too large');
}

$input = json_decode($rawBody, true);
if (!is_array($input) || json_last_error() !== JSON_ERROR_NONE) {
    fail(400, 'Invalid JSON request');
}

$csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
if (!is_string($csrfToken) || !isset($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $csrfToken)) {
    fail(403, 'Session expired. Refresh the page and try again.');
}

$action = $input['action'] ?? '';
if (!is_string($action)) {
    fail(400, 'Invalid action');
}

try {
    require dirname(__DIR__, 2) . '/includes/db.php';

    if ($action === 'register') {
        $username = $input['username'] ?? null;
        $password = $input['password'] ?? null;
        $confirmation = $input['confirm_password'] ?? null;
        $email = $input['email'] ?? '';
        $accountType = $input['account_type'] ?? 'individual';

        if (!is_string($username) || !preg_match('/^[A-Za-z][A-Za-z0-9_]{2,23}$/D', $username)) {
            fail(422, 'Проверьте логин.');
        }

        if (!is_string($password)
            || strlen($password) < 6
            || strlen($password) > 128
            || !preg_match('/^[\x21-\x7E]+$/D', $password)
            || !preg_match('/[A-Za-z]/', $password)
            || !preg_match('/[0-9]/', $password)) {
            fail(422, 'Пароль должен содержать 6–128 символов, латинскую букву и цифру; пробелы не допускаются.');
        }

        if (!is_string($confirmation) || !hash_equals($password, $confirmation)) {
            fail(422, 'Пароли должны совпадать.');
        }

        if (!is_string($email) || strlen($email) > 254 || ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false)) {
            fail(422, 'Проверьте формат e-mail.');
        }

        $allowedAccountTypes = ['individual', 'team', 'corporate'];
        if (!is_string($accountType) || !in_array($accountType, $allowedAccountTypes, true)) {
            fail(422, 'Invalid account type');
        }

        $email = $email === '' ? null : strtolower($email);
        $passwordHash = password_hash($password, PASSWORD_DEFAULT);
        if ($passwordHash === false) {
            throw new RuntimeException('Password hashing failed.');
        }

        $pdo->beginTransaction();
        $statement = $pdo->prepare(
            'INSERT INTO users (username, email, password_hash, account_type)
             VALUES (:username, :email, :password_hash, :account_type)
             RETURNING id, username, account_type'
        );
        $statement->execute([
            'username' => $username,
            'email' => $email,
            'password_hash' => $passwordHash,
            'account_type' => $accountType,
        ]);
        $user = $statement->fetch();

        $boardStatement = $pdo->prepare(
            'INSERT INTO boards (user_id, name, is_default)
             VALUES (:user_id, :name, TRUE)'
        );
        $boardStatement->execute([
            'user_id' => $user['id'],
            'name' => '👋 Hello World!',
        ]);
        $pdo->commit();

        session_regenerate_id(true);
        $_SESSION['user'] = publicUser($user);
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        respond(201, ['success' => true, 'data' => ['user' => $_SESSION['user']]]);
    }

    if ($action === 'login') {
        $username = $input['username'] ?? null;
        $password = $input['password'] ?? null;

        if (!is_string($username) || !is_string($password) || $username === '' || $password === '') {
            fail(422, 'Введите логин и пароль.');
        }

        $statement = $pdo->prepare(
            'SELECT id, username, account_type, password_hash FROM users WHERE username = :username'
        );
        $statement->execute(['username' => $username]);
        $user = $statement->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            fail(401, 'Неверный логин или пароль.');
        }

        session_regenerate_id(true);
        $_SESSION['user'] = publicUser($user);
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        respond(200, ['success' => true, 'data' => ['user' => $_SESSION['user']]]);
    }

    if ($action === 'logout') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $cookie = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $cookie['path'],
                'secure' => $cookie['secure'],
                'httponly' => $cookie['httponly'],
                'samesite' => $cookie['samesite'],
            ]);
        }
        session_destroy();
        respond(200, ['success' => true, 'data' => ['logged_out' => true]]);
    }

    fail(400, 'Unknown action');
} catch (PDOException $exception) {
    if ($exception->getCode() === '23505') {
        fail(409, 'Логин или e-mail уже используется.');
    }

    error_log('Authentication database error: ' . $exception->getMessage());
    fail(500, 'Не удалось выполнить запрос. Попробуйте позже.');
} catch (Throwable $exception) {
    error_log('Authentication error: ' . $exception->getMessage());
    fail(500, 'Не удалось выполнить запрос. Попробуйте позже.');
}
