<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE tasks
                ADD COLUMN urgency SMALLINT NOT NULL DEFAULT 0
                    CONSTRAINT tasks_urgency_level_check CHECK (urgency BETWEEN 0 AND 4);

            UPDATE tasks SET urgency = 3 WHERE is_urgent;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE tasks DROP COLUMN urgency;
            SQL);
    }
};
