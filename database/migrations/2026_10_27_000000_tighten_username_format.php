<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Keep three-character legacy usernames valid in stored rows; API validation requires four for new names.
        DB::unprepared(<<<'SQL'
            ALTER TABLE users DROP CONSTRAINT users_username_format;
            ALTER TABLE users ADD CONSTRAINT users_username_format
                CHECK (username ~ '^[A-Za-z][A-Za-z0-9_@-]{2,23}$');
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users DROP CONSTRAINT users_username_format;
            ALTER TABLE users ADD CONSTRAINT users_username_format
                CHECK (username ~ '^[A-Za-z0-9_@-]{3,24}$');
            SQL);
    }
};
