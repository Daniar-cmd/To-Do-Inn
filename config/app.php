<?php

return [
    'name' => env('APP_NAME', 'To Do Inn'),
    'env' => env('APP_ENV', 'production'),
    'debug' => (bool) env('APP_DEBUG', false),
    'url' => env('APP_URL', 'http://127.0.0.1:8001'),
    'frontend_url' => env('FRONTEND_URL', env('APP_ENV') === 'local' ? 'http://localhost:5173' : env('APP_URL', 'http://localhost')),
    'timezone' => 'UTC',
    'locale' => 'ru',
    'fallback_locale' => 'en',
    'cipher' => 'AES-256-CBC',
    'key' => env('APP_KEY'),
    'previous_keys' => [],
    'maintenance' => ['driver' => 'file'],
];
