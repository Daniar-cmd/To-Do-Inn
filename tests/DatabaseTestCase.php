<?php

namespace Tests;

use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use RuntimeException;

abstract class DatabaseTestCase extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $config = config('database.connections.pgsql');
        $legacy = is_file(base_path('.env')) ? parse_ini_file(base_path('.env'), false, INI_SCANNER_RAW) : [];

        // Check BEFORE connecting or migrating. Never use RefreshDatabase/migrate:fresh on a user's database.
        if (!$this->app->environment('testing')
            || config('database.default') !== 'pgsql'
            || !in_array($config['host'], ['127.0.0.1', 'localhost', '::1'], true)
            || $config['database'] !== 'todo_inn_laravel_test'
            || $config['database'] === ($legacy['PG_DATABASE'] ?? null)) {
            throw new RuntimeException('Database tests require the isolated local todo_inn_laravel_test database.');
        }

        $connection = DB::connection();
        if ($connection->selectOne('SELECT current_database() AS name')->name !== 'todo_inn_laravel_test') {
            throw new RuntimeException('Connected database does not match the isolated test database.');
        }

        if (Artisan::call('migrate', ['--no-interaction' => true]) !== 0) {
            throw new RuntimeException('Test migrations failed. No automatic wipe or retry will be attempted.');
        }

        $connection->beginTransaction();
        $this->beforeApplicationDestroyed(function () use ($connection): void {
            while ($connection->transactionLevel() > 0) {
                $connection->rollBack();
            }
        });
    }

    protected function createUser(): User
    {
        return User::create([
            'username' => 'Test'.bin2hex(random_bytes(5)),
            'password_hash' => 'TestPassword123',
        ]);
    }
}
