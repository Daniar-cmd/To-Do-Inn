<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE task_lists
                ADD CONSTRAINT task_lists_id_user_board_key UNIQUE (id, user_id, board_id);

            ALTER TABLE tasks
                ADD COLUMN board_id BIGINT,
                ADD COLUMN description TEXT NOT NULL DEFAULT '',
                ADD COLUMN is_important BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN flag_id BIGINT,
                ADD COLUMN due_date DATE;

            UPDATE tasks
                SET board_id = task_lists.board_id
                FROM task_lists
                WHERE task_lists.id = tasks.list_id AND task_lists.user_id = tasks.user_id;

            ALTER TABLE tasks ALTER COLUMN board_id SET NOT NULL;
            ALTER TABLE tasks
                ADD CONSTRAINT tasks_list_user_board_fkey
                    FOREIGN KEY (list_id, user_id, board_id)
                    REFERENCES task_lists (id, user_id, board_id) ON DELETE CASCADE,
                ADD CONSTRAINT tasks_flag_user_board_fkey
                    FOREIGN KEY (flag_id, user_id, board_id)
                    REFERENCES user_flags (id, user_id, board_id) ON DELETE SET NULL (flag_id);
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE tasks
                DROP CONSTRAINT tasks_flag_user_board_fkey,
                DROP CONSTRAINT tasks_list_user_board_fkey,
                DROP COLUMN due_date,
                DROP COLUMN flag_id,
                DROP COLUMN is_important,
                DROP COLUMN description,
                DROP COLUMN board_id;

            ALTER TABLE task_lists DROP CONSTRAINT task_lists_id_user_board_key;
            SQL);
    }
};
