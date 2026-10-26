<?php

// Development router for the Laravel API (npm run dev:api). Never use bare php -S ... -t public for the migrated app.
$publicPath = __DIR__.'/public';
$uri = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/');
$file = realpath($publicPath.$uri);

if (!str_starts_with($uri, '/api/')
    && !preg_match('~(?:^|/)\.~', $uri)
    && $file !== false
    && str_starts_with($file, $publicPath.DIRECTORY_SEPARATOR)
    && is_file($file)
    && strtolower(pathinfo($file, PATHINFO_EXTENSION)) !== 'php') {
    return false;
}

// Never execute physical legacy PHP endpoints in the Laravel app.
// PHP's built-in server otherwise reports /api/auth.php as the script/base URL because the file exists.
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = $publicPath.'/index.php';
unset($_SERVER['PATH_INFO'], $_SERVER['ORIG_PATH_INFO']);

require $publicPath.'/index.php';
