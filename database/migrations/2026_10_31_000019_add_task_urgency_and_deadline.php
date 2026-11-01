<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE tasks
                ADD COLUMN is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN deadline DATE;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE tasks
                DROP COLUMN deadline,
                DROP COLUMN is_urgent;
            SQL);
    }
};
