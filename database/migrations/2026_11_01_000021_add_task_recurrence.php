<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE tasks
                ADD COLUMN repeat_interval VARCHAR(8),
                ADD COLUMN repeat_series_id UUID,
                ADD COLUMN repeat_anchor_date DATE,
                ADD COLUMN repeat_sequence INTEGER NOT NULL DEFAULT 0,
                ADD CONSTRAINT tasks_repeat_interval_check CHECK (repeat_interval IS NULL OR repeat_interval IN ('daily', 'weekly', 'monthly', 'yearly')),
                ADD CONSTRAINT tasks_repeat_sequence_check CHECK (repeat_sequence >= 0),
                ADD CONSTRAINT tasks_repeat_series_check CHECK (repeat_series_id IS NULL OR repeat_anchor_date IS NOT NULL);
            CREATE UNIQUE INDEX tasks_repeat_series_sequence_unique ON tasks (repeat_series_id, repeat_sequence);
            CREATE INDEX tasks_repeat_pending_idx ON tasks (repeat_series_id, repeat_sequence DESC) WHERE repeat_interval IS NOT NULL;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP INDEX tasks_repeat_pending_idx;
            DROP INDEX tasks_repeat_series_sequence_unique;
            ALTER TABLE tasks
                DROP CONSTRAINT tasks_repeat_series_check,
                DROP CONSTRAINT tasks_repeat_sequence_check,
                DROP CONSTRAINT tasks_repeat_interval_check,
                DROP COLUMN repeat_sequence,
                DROP COLUMN repeat_anchor_date,
                DROP COLUMN repeat_series_id,
                DROP COLUMN repeat_interval;
            SQL);
    }
};
