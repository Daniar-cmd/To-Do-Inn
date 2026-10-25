<?php
declare(strict_types=1);

$configPath = dirname(__DIR__) . '/.env';
$config = is_file($configPath) ? parse_ini_file($configPath, false, INI_SCANNER_RAW) : false;

if ($config === false) {
    throw new RuntimeException('Database configuration is missing or invalid.');
}

$requiredConfig = ['PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USER', 'PG_PASSWORD'];
foreach ($requiredConfig as $key) {
    if (!isset($config[$key]) || !is_string($config[$key]) || $config[$key] === '') {
        throw new RuntimeException('Database configuration is incomplete.');
    }
}

$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s',
    $config['PG_HOST'],
    $config['PG_PORT'],
    $config['PG_DATABASE']
);

$pdo = new PDO($dsn, $config['PG_USER'], $config['PG_PASSWORD'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);
