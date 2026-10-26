<?php

use App\Support\LegacySchema;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (LegacySchema::TABLES as $table) {
            if (Schema::hasTable($table)) {
                throw new RuntimeException(
                    'Existing application tables found. Do not recreate them; run legacy:baseline first.',
                );
            }
        }

        // A clean starting schema, not the historical data-changing schema.sql script.
        // Raw PostgreSQL DDL preserves identity columns, partial indexes and composite foreign keys.
        DB::unprepared(<<<'SQL'
            CREATE TABLE users (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                username VARCHAR(24) NOT NULL UNIQUE,
                email VARCHAR(254) UNIQUE,
                secondary_email VARCHAR(254),
                password_hash TEXT NOT NULL,
                username_changed_at TIMESTAMPTZ,
                about TEXT NOT NULL DEFAULT '',
                avatar_data BYTEA,
                avatar_mime VARCHAR(24),
                account_type VARCHAR(16) NOT NULL DEFAULT 'individual'
                    CHECK (account_type IN ('individual', 'team', 'corporate')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z][A-Za-z0-9_]{2,23}$'),
                CONSTRAINT users_emails_different CHECK (email IS NULL OR secondary_email IS NULL OR email <> secondary_email),
                CONSTRAINT users_avatar_pair CHECK (
                    (avatar_data IS NULL AND avatar_mime IS NULL)
                    OR (avatar_data IS NOT NULL AND avatar_mime IN ('image/jpeg', 'image/png', 'image/webp'))
                )
            );
            CREATE UNIQUE INDEX users_secondary_email_unique ON users (secondary_email) WHERE secondary_email IS NOT NULL;

            CREATE TABLE boards (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                name VARCHAR(60) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                board_type VARCHAR(16) NOT NULL DEFAULT 'personal'
                    CHECK (board_type IN ('personal', 'community', 'corporate')),
                is_default BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (id, user_id),
                UNIQUE (user_id, name)
            );
            CREATE UNIQUE INDEX boards_one_default_per_user ON boards (user_id) WHERE is_default;

            CREATE TABLE user_flags (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                board_id BIGINT NOT NULL,
                name VARCHAR(40) NOT NULL,
                color VARCHAR(16) NOT NULL DEFAULT 'blue'
                    CHECK (color IN ('blue', 'violet', 'green', 'amber', 'rose')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (id, user_id),
                CONSTRAINT user_flags_id_user_board_key UNIQUE (id, user_id, board_id),
                CONSTRAINT user_flags_board_user_name_key UNIQUE (board_id, user_id, name),
                FOREIGN KEY (board_id, user_id) REFERENCES boards (id, user_id) ON DELETE CASCADE
            );

            CREATE TABLE task_lists (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                board_id BIGINT NOT NULL,
                flag_id BIGINT,
                name VARCHAR(80) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                is_important BOOLEAN NOT NULL DEFAULT FALSE,
                theme VARCHAR(16) NOT NULL DEFAULT 'blue'
                    CHECK (theme IN ('blue', 'violet', 'green', 'amber', 'rose')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (board_id, name),
                FOREIGN KEY (board_id, user_id) REFERENCES boards (id, user_id) ON DELETE CASCADE,
                CONSTRAINT task_lists_flag_board_fkey FOREIGN KEY (flag_id, user_id, board_id)
                    REFERENCES user_flags (id, user_id, board_id) ON DELETE SET NULL (flag_id)
            );

            CREATE TABLE tasks (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                list_id BIGINT NOT NULL REFERENCES task_lists (id) ON DELETE CASCADE,
                user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                title VARCHAR(240) NOT NULL,
                sort_order BIGINT NOT NULL DEFAULT 0,
                is_completed BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT tasks_title_not_empty CHECK (length(trim(title)) > 0)
            );
            CREATE INDEX tasks_list_order_idx ON tasks (list_id, sort_order, id);
            SQL);
    }

    public function down(): void
    {
        // A baseline may represent adopted legacy tables; rolling it back must never drop user data.
        throw new RuntimeException('The legacy baseline cannot be rolled back automatically. Restore a verified backup explicitly.');
    }
};
