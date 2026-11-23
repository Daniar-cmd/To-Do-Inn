WITH account AS (
    INSERT INTO users (username, email, password_hash, about, avatar_data, avatar_mime, registration_version)
    VALUES ('@PreservedUser', 'preserved@example.test',
            '$2y$04$6eEgCvvRo0MbLeXvVALT/e3s3UalydUfLemIQqXyNoBcn7zSzOGaG',
            'Данные до миграции',
            decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=', 'base64'),
            'image/png', 1)
    RETURNING id, avatar_data
), board AS (
    INSERT INTO boards (user_id, name, description, is_default)
    SELECT id, 'Старая доска', 'Описание до миграции', true FROM account
    RETURNING id, user_id
), list AS (
    INSERT INTO task_lists (user_id, board_id, name, sort_order)
    SELECT user_id, id, 'Старый список', 17 FROM board
    RETURNING id, user_id, board_id
), task AS (
    INSERT INTO tasks (user_id, board_id, list_id, title, description, sort_order, is_completed)
    SELECT list.user_id, list.board_id, list.id, entry.title, entry.description, entry.sort_order, entry.completed
    FROM list CROSS JOIN (VALUES
        ('Старая задача', 'Сохранить содержимое', 93, true),
        ('Первая по порядку', '', 41, false)
    ) AS entry(title, description, sort_order, completed)
)
INSERT INTO notes (user_id, board_id, title, body, sort_order, image_data, image_mime, image_offset)
SELECT board.user_id, board.id, 'Старая заметка', E'Текст 📝\nВторая строка', 23, account.avatar_data, 'image/png', 8
FROM board JOIN account ON account.id = board.user_id;
