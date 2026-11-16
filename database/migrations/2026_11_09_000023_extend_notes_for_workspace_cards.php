<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE notes
                ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0,
                ADD COLUMN due_date DATE;

            WITH ordered_notes AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY created_at DESC, id DESC) - 1 AS position
                FROM notes
            )
            UPDATE notes SET sort_order = ordered_notes.position
            FROM ordered_notes WHERE notes.id = ordered_notes.id;

            CREATE INDEX notes_board_order_idx ON notes (board_id, is_pinned DESC, sort_order, id);
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP INDEX notes_board_order_idx;
            ALTER TABLE notes DROP COLUMN due_date, DROP COLUMN sort_order, DROP COLUMN is_pinned;
            SQL);
    }
};
