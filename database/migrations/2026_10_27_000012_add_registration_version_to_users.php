<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users
                ADD COLUMN registration_version SMALLINT NOT NULL DEFAULT 2,
                ADD CONSTRAINT users_registration_version_check CHECK (registration_version IN (1, 2));

            UPDATE users
            SET registration_version = 1
            WHERE password_hash LIKE '$2a$%'
               OR password_hash LIKE '$2b$%'
               OR password_hash LIKE '$2y$%';
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users
                DROP CONSTRAINT users_registration_version_check,
                DROP COLUMN registration_version;
            SQL);
    }
};
