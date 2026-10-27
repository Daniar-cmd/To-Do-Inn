<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users
                ADD COLUMN telegram_url VARCHAR(255),
                ADD CONSTRAINT users_telegram_url_format CHECK (
                    telegram_url IS NULL OR telegram_url ~* '^https://t\.me/[A-Za-z0-9_]{5,32}/?$'
                );

            ALTER TABLE corporate_accounts
                ADD COLUMN telegram_url VARCHAR(255),
                ADD CONSTRAINT corporate_accounts_telegram_url_format CHECK (
                    telegram_url IS NULL OR telegram_url ~* '^https://t\.me/[A-Za-z0-9_]{5,32}/?$'
                );
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE corporate_accounts
                DROP CONSTRAINT corporate_accounts_telegram_url_format,
                DROP COLUMN telegram_url;
            ALTER TABLE users
                DROP CONSTRAINT users_telegram_url_format,
                DROP COLUMN telegram_url;
            SQL);
    }
};
