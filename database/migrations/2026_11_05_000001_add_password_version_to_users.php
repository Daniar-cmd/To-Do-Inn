<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE users ADD COLUMN password_version BIGINT NOT NULL DEFAULT 0 CHECK (password_version >= 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP COLUMN password_version');
    }
};
