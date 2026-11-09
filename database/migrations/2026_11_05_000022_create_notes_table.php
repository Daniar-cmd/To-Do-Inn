<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TABLE notes (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                board_id BIGINT NOT NULL,
                flag_id BIGINT,
                title VARCHAR(80) NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                annotation TEXT NOT NULL DEFAULT '',
                is_important BOOLEAN NOT NULL DEFAULT FALSE,
                theme VARCHAR(16) NOT NULL DEFAULT 'blue'
                    CHECK (theme IN ('blue', 'violet', 'green', 'amber', 'rose', 'sky')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT notes_title_not_empty CHECK (length(trim(title)) > 0),
                CONSTRAINT notes_body_length CHECK (char_length(body) <= 1200),
                CONSTRAINT notes_annotation_length CHECK (char_length(annotation) <= 200),
                CONSTRAINT notes_id_user_board_key UNIQUE (id, user_id, board_id),
                FOREIGN KEY (board_id, user_id) REFERENCES boards (id, user_id) ON DELETE CASCADE,
                CONSTRAINT notes_flag_board_fkey FOREIGN KEY (flag_id, user_id, board_id)
                    REFERENCES user_flags (id, user_id, board_id) ON DELETE SET NULL (flag_id)
            );
            CREATE INDEX notes_board_created_idx ON notes (board_id, created_at DESC, id DESC);
            CREATE INDEX notes_flag_idx ON notes (flag_id) WHERE flag_id IS NOT NULL;
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP TABLE notes');
    }
};
