<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE task_lists
                ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN sort_order BIGINT NOT NULL DEFAULT 0;

            WITH ranked_lists AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY created_at DESC, id DESC) - 1 AS position
                FROM task_lists
            )
            UPDATE task_lists AS lists
            SET sort_order = ranked_lists.position
            FROM ranked_lists
            WHERE lists.id = ranked_lists.id;

            CREATE INDEX task_lists_board_order_idx ON task_lists (board_id, is_pinned DESC, sort_order, id);
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP INDEX task_lists_board_order_idx;
            ALTER TABLE task_lists DROP COLUMN is_pinned, DROP COLUMN sort_order;
            SQL);
    }
};
