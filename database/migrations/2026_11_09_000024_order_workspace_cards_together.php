<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TEMP TABLE workspace_card_positions ON COMMIT DROP AS
            WITH ranked_lists AS (
                SELECT lists.id, lists.board_id, lists.is_pinned,
                    ROW_NUMBER() OVER (
                        PARTITION BY lists.board_id
                        ORDER BY lists.is_pinned DESC,
                            CASE WHEN boards.lists_order_customized THEN lists.sort_order END ASC NULLS LAST,
                            CASE WHEN NOT boards.lists_order_customized THEN lists.created_at END DESC,
                            lists.id DESC
                    ) AS local_position
                FROM task_lists AS lists
                JOIN boards ON boards.id = lists.board_id
            ),
            ranked_notes AS (
                SELECT id, board_id, is_pinned,
                    ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY sort_order, created_at DESC, id DESC) AS local_position
                FROM notes
            ),
            cards AS (
                SELECT 'list'::text AS item_type, id, board_id, is_pinned, 0 AS type_order, local_position FROM ranked_lists
                UNION ALL
                SELECT 'note'::text AS item_type, id, board_id, is_pinned, 1 AS type_order, local_position FROM ranked_notes
            ),
            positions AS (
                SELECT item_type, id,
                    ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY is_pinned DESC, type_order, local_position, id) - 1 AS card_position
                FROM cards
            )
            SELECT * FROM positions;

            UPDATE task_lists AS lists SET sort_order = positions.card_position
            FROM workspace_card_positions AS positions WHERE positions.item_type = 'list' AND positions.id = lists.id;

            UPDATE notes SET sort_order = positions.card_position
            FROM workspace_card_positions AS positions WHERE positions.item_type = 'note' AND positions.id = notes.id;

            UPDATE boards SET lists_order_customized = TRUE WHERE EXISTS (
                SELECT 1 FROM task_lists WHERE task_lists.board_id = boards.id
            );
            SQL);
    }

    public function down(): void
    {
        // The ordering backfill preserves each board's existing visual order and is intentionally retained.
    }
};
