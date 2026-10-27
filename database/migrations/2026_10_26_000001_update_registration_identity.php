<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users
                ADD COLUMN first_name VARCHAR(60) NOT NULL DEFAULT '',
                ADD COLUMN last_name VARCHAR(60) NOT NULL DEFAULT '';
            ALTER TABLE users DROP CONSTRAINT users_username_format;
            ALTER TABLE users ADD CONSTRAINT users_username_format
                CHECK (username ~ '^[A-Za-z0-9_@-]{3,24}$');
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users DROP CONSTRAINT users_username_format;
            ALTER TABLE users ADD CONSTRAINT users_username_format
                CHECK (username ~ '^[A-Za-z][A-Za-z0-9_]{2,23}$');
            ALTER TABLE users DROP COLUMN first_name, DROP COLUMN last_name;
            SQL);
    }
};
