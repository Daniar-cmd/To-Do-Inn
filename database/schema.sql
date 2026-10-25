CREATE TABLE IF NOT EXISTS users (
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
    CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z][A-Za-z0-9_]{2,23}$')
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS secondary_email VARCHAR(254);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime VARCHAR(24);
CREATE UNIQUE INDEX IF NOT EXISTS users_secondary_email_unique ON users (secondary_email) WHERE secondary_email IS NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_emails_different') THEN
        ALTER TABLE users ADD CONSTRAINT users_emails_different
            CHECK (email IS NULL OR secondary_email IS NULL OR email <> secondary_email);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_avatar_pair') THEN
        ALTER TABLE users ADD CONSTRAINT users_avatar_pair
            CHECK ((avatar_data IS NULL AND avatar_mime IS NULL) OR (avatar_data IS NOT NULL AND avatar_mime IN ('image/jpeg', 'image/png', 'image/webp')));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS boards (
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

ALTER TABLE boards ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE boards ADD COLUMN IF NOT EXISTS board_type VARCHAR(16) NOT NULL DEFAULT 'personal';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boards_board_type_check') THEN
        ALTER TABLE boards ADD CONSTRAINT boards_board_type_check
            CHECK (board_type IN ('personal', 'community', 'corporate'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS boards_one_default_per_user
    ON boards (user_id) WHERE is_default;

INSERT INTO boards (user_id, name, is_default)
SELECT id, '👋 Hello World!', TRUE FROM users
ON CONFLICT (user_id) WHERE is_default DO NOTHING;

CREATE TABLE IF NOT EXISTS user_flags (
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

ALTER TABLE user_flags ADD COLUMN IF NOT EXISTS board_id BIGINT;
ALTER TABLE user_flags DROP CONSTRAINT IF EXISTS user_flags_user_id_name_key;

CREATE TABLE IF NOT EXISTS task_lists (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    board_id BIGINT NOT NULL,
    flag_id BIGINT,
    name VARCHAR(80) NOT NULL,
    is_important BOOLEAN NOT NULL DEFAULT FALSE,
    theme VARCHAR(16) NOT NULL DEFAULT 'blue'
        CHECK (theme IN ('blue', 'violet', 'green', 'amber', 'rose')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (board_id, name),
    FOREIGN KEY (board_id, user_id) REFERENCES boards (id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (flag_id, user_id, board_id) REFERENCES user_flags (id, user_id, board_id) ON DELETE SET NULL (flag_id)
);

UPDATE user_flags AS flags
SET board_id = COALESCE(
    (SELECT lists.board_id
     FROM task_lists AS lists
     JOIN boards ON boards.id = lists.board_id
     WHERE lists.flag_id = flags.id AND lists.user_id = flags.user_id
     ORDER BY boards.is_default DESC, lists.created_at ASC, lists.board_id ASC
     LIMIT 1),
    (SELECT id FROM boards WHERE user_id = flags.user_id AND is_default LIMIT 1)
)
WHERE flags.board_id IS NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_flags_board_user_name_key') THEN
        ALTER TABLE user_flags ADD CONSTRAINT user_flags_board_user_name_key UNIQUE (board_id, user_id, name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_flags_id_user_board_key') THEN
        ALTER TABLE user_flags ADD CONSTRAINT user_flags_id_user_board_key UNIQUE (id, user_id, board_id);
    END IF;
END $$;

INSERT INTO user_flags (user_id, board_id, name, color)
SELECT DISTINCT flags.user_id, lists.board_id, flags.name, flags.color
FROM user_flags AS flags
JOIN task_lists AS lists ON lists.flag_id = flags.id AND lists.user_id = flags.user_id
WHERE flags.board_id <> lists.board_id
ON CONFLICT (board_id, user_id, name) DO NOTHING;

UPDATE task_lists AS lists
SET flag_id = board_flags.id
FROM user_flags AS original_flags
JOIN user_flags AS board_flags
  ON board_flags.user_id = original_flags.user_id
 AND board_flags.name = original_flags.name
WHERE lists.flag_id = original_flags.id
  AND lists.user_id = original_flags.user_id
  AND lists.board_id <> original_flags.board_id
  AND board_flags.board_id = lists.board_id;

DELETE FROM user_flags AS flags
WHERE NOT EXISTS (SELECT 1 FROM task_lists AS lists WHERE lists.flag_id = flags.id);

ALTER TABLE user_flags ALTER COLUMN board_id SET NOT NULL;
ALTER TABLE user_flags DROP CONSTRAINT IF EXISTS user_flags_board_id_user_id_fkey;
ALTER TABLE user_flags ADD CONSTRAINT user_flags_board_id_user_id_fkey
    FOREIGN KEY (board_id, user_id) REFERENCES boards (id, user_id) ON DELETE CASCADE;

ALTER TABLE task_lists DROP CONSTRAINT IF EXISTS task_lists_flag_id_user_id_fkey;
ALTER TABLE task_lists DROP CONSTRAINT IF EXISTS task_lists_flag_board_fkey;
ALTER TABLE task_lists ADD CONSTRAINT task_lists_flag_board_fkey
    FOREIGN KEY (flag_id, user_id, board_id) REFERENCES user_flags (id, user_id, board_id) ON DELETE SET NULL (flag_id);

ALTER TABLE task_lists ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS tasks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    list_id BIGINT NOT NULL REFERENCES task_lists (id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    sort_order BIGINT NOT NULL DEFAULT 0,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tasks_title_not_empty CHECK (length(trim(title)) > 0)
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order BIGINT;

WITH ordered_tasks AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY created_at, id) - 1 AS position
    FROM tasks
    WHERE sort_order IS NULL
)
UPDATE tasks
SET sort_order = ordered_tasks.position
FROM ordered_tasks
WHERE tasks.id = ordered_tasks.id;

ALTER TABLE tasks ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE tasks ALTER COLUMN sort_order SET NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_list_order_idx ON tasks (list_id, sort_order, id);

-- Existing accounts retain their original default board and data.
