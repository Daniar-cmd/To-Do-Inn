<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE tasks
                ADD COLUMN location VARCHAR(160),
                ADD COLUMN scheduled_time TIME;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE tasks
                DROP COLUMN scheduled_time,
                DROP COLUMN location;
            SQL);
    }
};
