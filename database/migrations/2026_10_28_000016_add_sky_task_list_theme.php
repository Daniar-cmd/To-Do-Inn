<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE task_lists DROP CONSTRAINT task_lists_theme_check;
            ALTER TABLE task_lists ADD CONSTRAINT task_lists_theme_check
                CHECK (theme IN ('blue', 'violet', 'green', 'amber', 'rose', 'sky'));
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE task_lists DROP CONSTRAINT task_lists_theme_check;
            ALTER TABLE task_lists ADD CONSTRAINT task_lists_theme_check
                CHECK (theme IN ('blue', 'violet', 'green', 'amber', 'rose'));
            SQL);
    }
};
