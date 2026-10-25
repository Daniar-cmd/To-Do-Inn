<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

ini_set('session.use_strict_mode', '1');
session_set_cookie_params([
    'httponly' => true,
    'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Lax',
    'path' => '/',
]);
session_start();

function workspaceRespond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function workspaceFail(int $status, string $message): never
{
    workspaceRespond($status, ['success' => false, 'error' => $message]);
}

$user = $_SESSION['user'] ?? null;
if (!is_array($user) || !isset($user['id'])) {
    workspaceFail(401, 'Требуется войти в аккаунт.');
}

try {
    require dirname(__DIR__, 2) . '/includes/db.php';

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $boardStatement = $pdo->prepare(
            'SELECT id, name, description, board_type FROM boards
             WHERE user_id = :user_id
             ORDER BY is_default DESC, id ASC'
        );
        $boardStatement->execute(['user_id' => $user['id']]);
        $boards = $boardStatement->fetchAll();

        if (!$boards) {
            workspaceFail(404, 'Рабочая доска не найдена.');
        }

        $searchQuery = filter_input(INPUT_GET, 'search', FILTER_UNSAFE_RAW);
        if (is_string($searchQuery) && trim($searchQuery) !== '') {
            $searchQuery = trim($searchQuery);
            if (mb_strlen($searchQuery) > 120 || preg_match('/[\x00-\x1F\x7F]/u', $searchQuery)) {
                workspaceFail(422, 'Поисковый запрос слишком длинный или содержит недопустимые символы.');
            }
            $searchListsStatement = $pdo->prepare(
                'SELECT lists.id, lists.board_id, boards.name AS board_name, lists.name,
                        lists.description, lists.created_at, lists.is_important, lists.theme,
                        lists.flag_id, flags.name AS flag_name, flags.color AS flag_color
                 FROM task_lists AS lists
                 JOIN boards ON boards.id = lists.board_id AND boards.user_id = lists.user_id
                 LEFT JOIN user_flags AS flags
                   ON flags.id = lists.flag_id AND flags.user_id = lists.user_id AND flags.board_id = lists.board_id
                 WHERE lists.user_id = :user_id
                   AND (POSITION(LOWER(:name_query) IN LOWER(lists.name)) > 0
                     OR POSITION(LOWER(:description_query) IN LOWER(lists.description)) > 0
                     OR EXISTS (
                         SELECT 1 FROM tasks
                         WHERE tasks.list_id = lists.id AND tasks.user_id = lists.user_id
                           AND POSITION(LOWER(:task_query) IN LOWER(tasks.title)) > 0
                     ))
                 ORDER BY boards.name ASC, lists.created_at DESC, lists.id DESC'
            );
            $searchListsStatement->execute([
                'user_id' => $user['id'],
                'name_query' => $searchQuery,
                'description_query' => $searchQuery,
                'task_query' => $searchQuery,
            ]);
            $searchLists = $searchListsStatement->fetchAll();
            $listTasks = [];
            if ($searchLists) {
                $idParameters = [];
                $idPlaceholders = [];
                foreach ($searchLists as $index => $list) {
                    $parameter = 'list_id_' . $index;
                    $idPlaceholders[] = ':' . $parameter;
                    $idParameters[$parameter] = (int) $list['id'];
                }
                $matchingTasksStatement = $pdo->prepare(
                    'SELECT list_id, id, title, is_completed FROM tasks
                     WHERE user_id = :user_id AND list_id IN (' . implode(', ', $idPlaceholders) . ')
                     ORDER BY sort_order ASC, id ASC'
                );
                $matchingTasksStatement->execute([
                    'user_id' => $user['id'],
                    ...$idParameters,
                ]);
                foreach ($matchingTasksStatement->fetchAll() as $task) {
                    $listTasks[(int) $task['list_id']][] = [
                        'id' => (int) $task['id'],
                        'list_id' => (int) $task['list_id'],
                        'title' => $task['title'],
                        'is_completed' => (bool) $task['is_completed'],
                    ];
                }
            }

            $searchFlagsStatement = $pdo->prepare(
                'SELECT id, board_id, name, color FROM user_flags
                 WHERE user_id = :user_id ORDER BY name ASC'
            );
            $searchFlagsStatement->execute(['user_id' => $user['id']]);
            $flagsByBoard = [];
            foreach ($searchFlagsStatement->fetchAll() as $flag) {
                $flagsByBoard[(int) $flag['board_id']][] = [
                    'id' => (int) $flag['id'],
                    'board_id' => (int) $flag['board_id'],
                    'name' => $flag['name'],
                    'color' => $flag['color'],
                ];
            }

            workspaceRespond(200, [
                'success' => true,
                'data' => [
                    'results' => array_map(static function (array $list) use ($listTasks, $flagsByBoard): array {
                        return [
                            'id' => (int) $list['id'],
                            'board_id' => (int) $list['board_id'],
                            'board_name' => $list['board_name'],
                            'name' => $list['name'],
                            'description' => $list['description'],
                            'created_at' => $list['created_at'],
                            'is_important' => (bool) $list['is_important'],
                            'theme' => $list['theme'],
                            'flag' => $list['flag_id'] === null ? null : [
                                'id' => (int) $list['flag_id'],
                                'name' => $list['flag_name'],
                                'color' => $list['flag_color'],
                            ],
                            'flags' => $flagsByBoard[(int) $list['board_id']] ?? [],
                            'tasks' => $listTasks[(int) $list['id']] ?? [],
                        ];
                    }, $searchLists),
                ],
            ]);
        }

        $requestedBoardId = filter_input(INPUT_GET, 'board_id', FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);
        $board = $boards[0];

        if ($requestedBoardId !== null && $requestedBoardId !== false) {
            foreach ($boards as $candidate) {
                if ((int) $candidate['id'] === $requestedBoardId) {
                    $board = $candidate;
                    break;
                }
            }
            if ((int) $board['id'] !== $requestedBoardId) {
                workspaceFail(404, 'Рабочая доска не найдена.');
            }
        }

        $flagStatement = $pdo->prepare(
            'SELECT id, board_id, name, color FROM user_flags
             WHERE user_id = :user_id AND board_id = :board_id
             ORDER BY name ASC'
        );
        $flagStatement->execute(['user_id' => $user['id'], 'board_id' => $board['id']]);

        $listStatement = $pdo->prepare(
            'SELECT lists.id, lists.board_id, lists.name, lists.description, lists.created_at, lists.is_important, lists.theme, lists.flag_id,
                    flags.name AS flag_name, flags.color AS flag_color
             FROM task_lists AS lists
             LEFT JOIN user_flags AS flags
             ON flags.id = lists.flag_id AND flags.user_id = lists.user_id AND flags.board_id = lists.board_id
             WHERE lists.user_id = :user_id AND lists.board_id = :board_id
             ORDER BY lists.created_at ASC, lists.id ASC'
        );
        $listStatement->execute([
            'user_id' => $user['id'],
            'board_id' => $board['id'],
        ]);

        $taskStatement = $pdo->prepare(
            'SELECT tasks.id, tasks.list_id, tasks.title, tasks.is_completed
             FROM tasks JOIN task_lists ON task_lists.id = tasks.list_id
             WHERE tasks.user_id = :user_id AND task_lists.board_id = :board_id
             ORDER BY tasks.list_id ASC, tasks.sort_order ASC, tasks.id ASC'
        );
        $taskStatement->execute(['user_id' => $user['id'], 'board_id' => $board['id']]);

        workspaceRespond(200, [
            'success' => true,
            'data' => [
                'board' => ['id' => (int) $board['id'], 'name' => $board['name'], 'description' => $board['description'], 'board_type' => $board['board_type']],
                'boards' => array_map(static fn (array $item): array => [
                    'id' => (int) $item['id'],
                    'name' => $item['name'],
                    'description' => $item['description'],
                    'board_type' => $item['board_type'],
                ], $boards),
                'flags' => array_map(static function (array $flag): array {
                    return [
                        'id' => (int) $flag['id'],
                        'board_id' => (int) $flag['board_id'],
                        'name' => $flag['name'],
                        'color' => $flag['color'],
                    ];
                }, $flagStatement->fetchAll()),
                'lists' => array_map(static function (array $list): array {
                    return [
                        'id' => (int) $list['id'],
                        'board_id' => (int) $list['board_id'],
                        'name' => $list['name'],
                        'description' => $list['description'],
                        'created_at' => $list['created_at'],
                        'is_important' => (bool) $list['is_important'],
                        'theme' => $list['theme'],
                        'flag' => $list['flag_id'] === null ? null : [
                            'id' => (int) $list['flag_id'],
                            'name' => $list['flag_name'],
                            'color' => $list['flag_color'],
                        ],
                    ];
                }, $listStatement->fetchAll()),
                'tasks' => array_map(static fn (array $task): array => [
                    'id' => (int) $task['id'],
                    'list_id' => (int) $task['list_id'],
                    'title' => $task['title'],
                    'is_completed' => (bool) $task['is_completed'],
                ], $taskStatement->fetchAll()),
            ],
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($csrfToken)
            || !isset($_SESSION['csrf_token'])
            || !hash_equals($_SESSION['csrf_token'], $csrfToken)) {
            workspaceFail(403, 'Сессия истекла. Обновите страницу.');
        }
        $boardId = filter_input(INPUT_GET, 'board_id', FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);
        if ($boardId !== null) {
            if ($boardId === false) workspaceFail(422, 'Некорректная доска.');
            $pdo->beginTransaction();
            $lockUser = $pdo->prepare('SELECT id FROM users WHERE id = :user_id FOR UPDATE');
            $lockUser->execute(['user_id' => $user['id']]);
            $boardQuery = $pdo->prepare(
                'SELECT id, is_default FROM boards WHERE id = :id AND user_id = :user_id FOR UPDATE'
            );
            $boardQuery->execute(['id' => $boardId, 'user_id' => $user['id']]);
            $boardToDelete = $boardQuery->fetch();
            if (!$boardToDelete) {
                $pdo->rollBack();
                workspaceFail(404, 'Доска не найдена.');
            }
            $countBoards = $pdo->prepare('SELECT COUNT(*) FROM boards WHERE user_id = :user_id');
            $countBoards->execute(['user_id' => $user['id']]);
            if ((int) $countBoards->fetchColumn() <= 1) {
                $pdo->rollBack();
                workspaceFail(409, 'Нельзя удалить последнюю доску.');
            }
            $replacementQuery = $pdo->prepare(
                'SELECT id FROM boards WHERE user_id = :user_id AND id <> :id
                 ORDER BY is_default DESC, created_at ASC, id ASC LIMIT 1'
            );
            $replacementQuery->execute(['user_id' => $user['id'], 'id' => $boardId]);
            $replacementBoardId = (int) $replacementQuery->fetchColumn();
            $removeBoard = $pdo->prepare('DELETE FROM boards WHERE id = :id AND user_id = :user_id');
            $removeBoard->execute(['id' => $boardId, 'user_id' => $user['id']]);
            if ((bool) $boardToDelete['is_default']) {
                $setDefault = $pdo->prepare('UPDATE boards SET is_default = TRUE WHERE id = :id AND user_id = :user_id');
                $setDefault->execute(['id' => $replacementBoardId, 'user_id' => $user['id']]);
            }
            $pdo->commit();
            workspaceRespond(200, ['success' => true, 'data' => ['deleted' => true, 'replacement_board_id' => $replacementBoardId]]);
        }
        $listId = filter_input(INPUT_GET, 'list_id', FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);
        if ($listId === false || $listId === null) {
            workspaceFail(422, 'Некорректный список.');
        }
        $pdo->beginTransaction();
        $deleteList = $pdo->prepare(
            'DELETE FROM task_lists WHERE id = :id AND user_id = :user_id RETURNING id, board_id, flag_id'
        );
        $deleteList->execute(['id' => $listId, 'user_id' => $user['id']]);
        $deletedList = $deleteList->fetch();
        if (!$deletedList) {
            $pdo->rollBack();
            workspaceFail(404, 'Список не найден.');
        }
        if ($deletedList['flag_id'] !== null) {
            $deleteUnusedFlag = $pdo->prepare(
                'DELETE FROM user_flags AS flags
                 WHERE flags.id = :flag_id AND flags.user_id = :user_id AND flags.board_id = :board_id
                   AND NOT EXISTS (SELECT 1 FROM task_lists WHERE task_lists.flag_id = flags.id)'
            );
            $deleteUnusedFlag->execute([
                'flag_id' => $deletedList['flag_id'],
                'user_id' => $user['id'],
                'board_id' => $deletedList['board_id'],
            ]);
        }
        $pdo->commit();
        workspaceRespond(200, ['success' => true, 'data' => ['deleted' => true]]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        header('Allow: GET, POST, DELETE');
        workspaceFail(405, 'Method not allowed');
    }

    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (!preg_match('/^application\/json(?:\s*;|$)/i', $contentType)) {
        workspaceFail(415, 'Expected a JSON request');
    }

    $csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($csrfToken)
        || !isset($_SESSION['csrf_token'])
        || !hash_equals($_SESSION['csrf_token'], $csrfToken)) {
        workspaceFail(403, 'Сессия истекла. Обновите страницу.');
    }

    $rawBody = file_get_contents('php://input', false, null, 0, 8193);
    if ($rawBody === false || strlen($rawBody) > 8192) {
        workspaceFail(413, 'Request is too large');
    }
    $input = json_decode($rawBody, true);
    if (!is_array($input) || json_last_error() !== JSON_ERROR_NONE) {
        workspaceFail(400, 'Invalid JSON request');
    }
    $action = $input['action'] ?? '';
    if ($action === 'create_board') {
        $boardName = $input['name'] ?? null;
        $description = $input['description'] ?? '';
        $boardType = $input['board_type'] ?? 'personal';
        if (!is_string($boardName) || trim($boardName) === '' || preg_match('/[\x00-\x1F\x7F]/u', $boardName)
            || mb_strlen(trim($boardName)) > 60 || !is_string($description) || mb_strlen($description) > 2000
            || !is_string($boardType) || !in_array($boardType, ['personal', 'community', 'corporate'], true)) {
            workspaceFail(422, 'Проверьте название, описание и тип доски.');
        }
        $createBoard = $pdo->prepare(
            'INSERT INTO boards (user_id, name, description, board_type)
             VALUES (:user_id, :name, :description, :board_type)
             RETURNING id, name, description, board_type'
        );
        $createBoard->execute([
            'user_id' => $user['id'],
            'name' => trim($boardName),
            'description' => trim($description),
            'board_type' => $boardType,
        ]);
        $createdBoard = $createBoard->fetch();
        workspaceRespond(201, [
            'success' => true,
            'data' => [
                'board' => [
                    'id' => (int) $createdBoard['id'],
                    'name' => $createdBoard['name'],
                    'description' => $createdBoard['description'],
                    'board_type' => $createdBoard['board_type'],
                ],
            ],
        ]);
    }
    if ($action === 'update_board') {
        $boardId = filter_var($input['board_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $boardName = $input['name'] ?? null;
        $description = $input['description'] ?? '';
        $boardType = $input['board_type'] ?? null;
        if ($boardId === false || !is_string($boardName) || trim($boardName) === ''
            || preg_match('/[\x00-\x1F\x7F]/u', $boardName) || mb_strlen(trim($boardName)) > 60
            || !is_string($description) || mb_strlen($description) > 2000
            || !is_string($boardType) || !in_array($boardType, ['personal', 'community', 'corporate'], true)) {
            workspaceFail(422, 'Проверьте название, описание и тип доски.');
        }
        $updateBoard = $pdo->prepare(
            'UPDATE boards
             SET name = :name, description = :description, board_type = :board_type
             WHERE id = :id AND user_id = :user_id
             RETURNING id, name, description, board_type'
        );
        $updateBoard->execute([
            'id' => $boardId,
            'user_id' => $user['id'],
            'name' => trim($boardName),
            'description' => trim($description),
            'board_type' => $boardType,
        ]);
        $updatedBoard = $updateBoard->fetch();
        if (!$updatedBoard) workspaceFail(404, 'Доска не найдена.');
        workspaceRespond(200, [
            'success' => true,
            'data' => [
                'board' => [
                    'id' => (int) $updatedBoard['id'],
                    'name' => $updatedBoard['name'],
                    'description' => $updatedBoard['description'],
                    'board_type' => $updatedBoard['board_type'],
                ],
            ],
        ]);
    }
    if ($action === 'create_task') {
        $listId = filter_var($input['list_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $title = $input['title'] ?? null;
        if ($listId === false || !is_string($title) || trim($title) === '' || mb_strlen(trim($title)) > 240) {
            workspaceFail(422, 'Введите название задачи (не более 240 символов).');
        }
        $insert = $pdo->prepare(
            'INSERT INTO tasks (list_id, user_id, title, sort_order)
             SELECT lists.id, lists.user_id, :title,
                    COALESCE((SELECT MAX(sort_order) + 1 FROM tasks WHERE list_id = lists.id), 0)
             FROM task_lists AS lists
             WHERE lists.id = :list_id AND lists.user_id = :user_id
             RETURNING id, list_id, title, is_completed'
        );
        $insert->execute(['list_id' => $listId, 'user_id' => $user['id'], 'title' => trim($title)]);
        $task = $insert->fetch();
        if (!$task) workspaceFail(404, 'Список не найден.');
        workspaceRespond(201, ['success' => true, 'data' => ['task' => ['id' => (int) $task['id'], 'list_id' => (int) $task['list_id'], 'title' => $task['title'], 'is_completed' => (bool) $task['is_completed']]]]);
    }
    if ($action === 'toggle_task') {
        $taskId = filter_var($input['task_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($taskId === false || !is_bool($input['is_completed'] ?? null)) workspaceFail(422, 'Некорректная задача.');
        $update = $pdo->prepare('UPDATE tasks SET is_completed = :completed WHERE id = :id AND user_id = :user_id RETURNING id');
        $update->execute(['completed' => $input['is_completed'], 'id' => $taskId, 'user_id' => $user['id']]);
        if (!$update->fetch()) workspaceFail(404, 'Задача не найдена.');
        workspaceRespond(200, ['success' => true, 'data' => ['updated' => true]]);
    }
    if ($action === 'reorder_task') {
        $taskId = filter_var($input['task_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $targetTaskId = filter_var($input['target_task_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($taskId === false || $targetTaskId === false) {
            workspaceFail(422, 'Некорректная задача.');
        }
        $sourceQuery = $pdo->prepare('SELECT list_id FROM tasks WHERE id = :id AND user_id = :user_id');
        $sourceQuery->execute(['id' => $taskId, 'user_id' => $user['id']]);
        $listId = $sourceQuery->fetchColumn();
        if ($listId === false) {
            workspaceFail(404, 'Задача не найдена.');
        }
        $pdo->beginTransaction();
        $orderQuery = $pdo->prepare(
            'SELECT id FROM tasks WHERE list_id = :list_id AND user_id = :user_id
             ORDER BY sort_order ASC, id ASC FOR UPDATE'
        );
        $orderQuery->execute(['list_id' => $listId, 'user_id' => $user['id']]);
        $taskIds = array_map('intval', $orderQuery->fetchAll(PDO::FETCH_COLUMN));
        $sourceIndex = array_search((int) $taskId, $taskIds, true);
        $targetIndex = array_search((int) $targetTaskId, $taskIds, true);
        if ($sourceIndex === false || $targetIndex === false) {
            $pdo->rollBack();
            workspaceFail(404, 'Задача не найдена в этом списке.');
        }
        if ($sourceIndex !== $targetIndex) {
            $movingTask = array_splice($taskIds, $sourceIndex, 1)[0];
            array_splice($taskIds, $targetIndex, 0, [$movingTask]);
            $saveOrder = $pdo->prepare('UPDATE tasks SET sort_order = :sort_order WHERE id = :id AND user_id = :user_id');
            foreach ($taskIds as $position => $orderedTaskId) {
                $saveOrder->execute(['sort_order' => $position, 'id' => $orderedTaskId, 'user_id' => $user['id']]);
            }
        }
        $pdo->commit();
        workspaceRespond(200, ['success' => true, 'data' => ['updated' => true]]);
    }
    if ($action === 'update_task') {
        $taskId = filter_var($input['task_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $title = $input['title'] ?? null;
        if ($taskId === false || !is_string($title) || trim($title) === '' || mb_strlen(trim($title)) > 240) {
            workspaceFail(422, 'Название задачи должно содержать от 1 до 240 символов.');
        }
        $update = $pdo->prepare('UPDATE tasks SET title = :title WHERE id = :id AND user_id = :user_id RETURNING id');
        $update->execute(['title' => trim($title), 'id' => $taskId, 'user_id' => $user['id']]);
        if (!$update->fetch()) workspaceFail(404, 'Задача не найдена.');
        workspaceRespond(200, ['success' => true, 'data' => ['updated' => true]]);
    }
    if ($action === 'update_list') {
        $listId = filter_var($input['list_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $listName = $input['name'] ?? null;
        $description = $input['description'] ?? '';
        $listTheme = $input['theme'] ?? 'blue';
        $listFlagId = $input['flag_id'] ?? null;
        $newFlagName = $input['new_flag_name'] ?? '';
        $important = $input['is_important'] ?? false;
        if ($listId === false || !is_string($listName) || trim($listName) === '' || mb_strlen(trim($listName)) > 80 || !is_string($description) || mb_strlen($description) > 2000 || !in_array($listTheme, ['blue', 'violet', 'green', 'amber', 'rose'], true) || !is_bool($important) || !is_string($newFlagName)) workspaceFail(422, 'Проверьте настройки списка.');
        $newFlagName = trim($newFlagName);
        if ($newFlagName !== '' && (mb_strlen($newFlagName) > 40 || preg_match('/[\x00-\x1F\x7F]/u', $newFlagName))) {
            workspaceFail(422, 'Название флага должно быть не длиннее 40 символов.');
        }
        if ($newFlagName !== '' && $listFlagId !== null) {
            workspaceFail(422, 'Выберите существующий флаг или создайте новый.');
        }
        $listBoardQuery = $pdo->prepare('SELECT board_id, flag_id FROM task_lists WHERE id = :id AND user_id = :user_id');
        $listBoardQuery->execute(['id' => $listId, 'user_id' => $user['id']]);
        $previousList = $listBoardQuery->fetch();
        if (!$previousList) workspaceFail(404, 'Список не найден.');
        $listBoardId = (int) $previousList['board_id'];
        $pdo->beginTransaction();
        if ($newFlagName !== '') {
            $flagInsert = $pdo->prepare(
                'INSERT INTO user_flags (user_id, board_id, name) VALUES (:user_id, :board_id, :name) RETURNING id'
            );
            $flagInsert->execute(['user_id' => $user['id'], 'board_id' => $listBoardId, 'name' => $newFlagName]);
            $listFlagId = (int) $flagInsert->fetchColumn();
        }
        if ($listFlagId !== null) {
            $listFlagId = filter_var($listFlagId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($listFlagId === false) {
                $pdo->rollBack();
                workspaceFail(422, 'Проверьте выбранный флаг.');
            }
            $flagCheck = $pdo->prepare('SELECT id FROM user_flags WHERE id = :id AND user_id = :user_id AND board_id = :board_id');
            $flagCheck->execute(['id' => $listFlagId, 'user_id' => $user['id'], 'board_id' => $listBoardId]);
            if (!$flagCheck->fetch()) {
                $pdo->rollBack();
                workspaceFail(404, 'Флаг не найден.');
            }
        }
        $update = $pdo->prepare('UPDATE task_lists SET name = :name, description = :description, theme = :theme, flag_id = :flag_id, is_important = :is_important WHERE id = :id AND user_id = :user_id RETURNING id');
        $update->execute(['name' => trim($listName), 'description' => trim($description), 'theme' => $listTheme, 'flag_id' => $listFlagId, 'is_important' => $important, 'id' => $listId, 'user_id' => $user['id']]);
        if (!$update->fetch()) {
            $pdo->rollBack();
            workspaceFail(404, 'Список не найден.');
        }
        if ($previousList['flag_id'] !== null && ($listFlagId === null || (int) $listFlagId !== (int) $previousList['flag_id'])) {
            $deleteUnusedFlag = $pdo->prepare(
                'DELETE FROM user_flags AS flags
                 WHERE flags.id = :flag_id AND flags.user_id = :user_id AND flags.board_id = :board_id
                   AND NOT EXISTS (SELECT 1 FROM task_lists WHERE task_lists.flag_id = flags.id)'
            );
            $deleteUnusedFlag->execute([
                'flag_id' => $previousList['flag_id'],
                'user_id' => $user['id'],
                'board_id' => $listBoardId,
            ]);
        }
        $pdo->commit();
        $savedFlag = null;
        if ($listFlagId !== null) {
            $savedFlagQuery = $pdo->prepare('SELECT id, board_id, name, color FROM user_flags WHERE id = :id AND user_id = :user_id AND board_id = :board_id');
            $savedFlagQuery->execute(['id' => $listFlagId, 'user_id' => $user['id'], 'board_id' => $listBoardId]);
            $savedFlag = $savedFlagQuery->fetch();
            if ($savedFlag) {
                $savedFlag['id'] = (int) $savedFlag['id'];
                $savedFlag['board_id'] = (int) $savedFlag['board_id'];
            }
        }
        workspaceRespond(200, ['success' => true, 'data' => ['updated' => true, 'flag' => $savedFlag]]);
    }
    if ($action !== 'create_list') workspaceFail(400, 'Unknown action');

    $name = $input['name'] ?? null;
    $boardId = filter_var($input['board_id'] ?? null, FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 1],
    ]);
    $important = $input['is_important'] ?? false;
    $theme = $input['theme'] ?? 'blue';
    $flagId = $input['flag_id'] ?? null;
    $newFlagName = $input['new_flag_name'] ?? '';
    $allowedThemes = ['blue', 'violet', 'green', 'amber', 'rose'];

    if (!is_string($name) || trim($name) === '' || preg_match('/[\x00-\x1F\x7F]/u', $name)) {
        workspaceFail(422, 'Введите название списка.');
    }
    preg_match_all('/./us', trim($name), $nameCharacters);
    if (count($nameCharacters[0]) > 80) {
        workspaceFail(422, 'Название списка должно быть не длиннее 80 символов.');
    }
    if ($boardId === false || !is_bool($important) || !is_string($theme) || !in_array($theme, $allowedThemes, true)) {
        workspaceFail(422, 'Проверьте настройки списка.');
    }
    if (!is_string($newFlagName)) {
        workspaceFail(422, 'Проверьте название флага.');
    }
    $newFlagName = trim($newFlagName);
    if ($newFlagName !== '') {
        if ($flagId !== null) {
            workspaceFail(422, 'Выберите существующий флаг или создайте новый.');
        }
        preg_match_all('/./us', $newFlagName, $flagCharacters);
        if (count($flagCharacters[0]) > 40 || preg_match('/[\x00-\x1F\x7F]/u', $newFlagName)) {
            workspaceFail(422, 'Название флага должно быть не длиннее 40 символов.');
        }
    }

    $boardCheck = $pdo->prepare('SELECT id FROM boards WHERE id = :id AND user_id = :user_id');
    $boardCheck->execute(['id' => $boardId, 'user_id' => $user['id']]);
    if (!$boardCheck->fetch()) {
        workspaceFail(404, 'Рабочая доска не найдена.');
    }

    $pdo->beginTransaction();
    if ($newFlagName !== '') {
        $flagInsert = $pdo->prepare(
            'INSERT INTO user_flags (user_id, board_id, name) VALUES (:user_id, :board_id, :name) RETURNING id'
        );
        $flagInsert->execute(['user_id' => $user['id'], 'board_id' => $boardId, 'name' => $newFlagName]);
        $flagId = (int) $flagInsert->fetchColumn();
    } elseif ($flagId !== null) {
        $flagId = filter_var($flagId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($flagId === false) {
            $pdo->rollBack();
            workspaceFail(422, 'Проверьте выбранный флаг.');
        }
        $flagCheck = $pdo->prepare('SELECT id FROM user_flags WHERE id = :id AND user_id = :user_id AND board_id = :board_id');
        $flagCheck->execute(['id' => $flagId, 'user_id' => $user['id'], 'board_id' => $boardId]);
        if (!$flagCheck->fetch()) {
            $pdo->rollBack();
            workspaceFail(404, 'Флаг не найден.');
        }
    }

    $createList = $pdo->prepare(
        'INSERT INTO task_lists (user_id, board_id, flag_id, name, description, is_important, theme)
         VALUES (:user_id, :board_id, :flag_id, :name, :description, :is_important, :theme)
         RETURNING id, name, is_important, theme, flag_id'
    );
    $createList->bindValue(':user_id', (int) $user['id'], PDO::PARAM_INT);
    $createList->bindValue(':board_id', $boardId, PDO::PARAM_INT);
    if ($flagId === null) {
        $createList->bindValue(':flag_id', null, PDO::PARAM_NULL);
    } else {
        $createList->bindValue(':flag_id', (int) $flagId, PDO::PARAM_INT);
    }
    $createList->bindValue(':name', trim($name), PDO::PARAM_STR);
    $createList->bindValue(':description', '', PDO::PARAM_STR);
    $createList->bindValue(':is_important', $important, PDO::PARAM_BOOL);
    $createList->bindValue(':theme', $theme, PDO::PARAM_STR);
    $createList->execute();
    $list = $createList->fetch();
    $pdo->commit();

    $flag = null;
    if ($list['flag_id'] !== null) {
        $flagQuery = $pdo->prepare('SELECT id, name, color FROM user_flags WHERE id = :id AND user_id = :user_id AND board_id = :board_id');
        $flagQuery->execute(['id' => $list['flag_id'], 'user_id' => $user['id'], 'board_id' => $boardId]);
        $flag = $flagQuery->fetch();
        $flag['id'] = (int) $flag['id'];
    }

    workspaceRespond(201, [
        'success' => true,
        'data' => [
            'list' => [
                'id' => (int) $list['id'],
                'name' => $list['name'],
                'is_important' => (bool) $list['is_important'],
                'theme' => $list['theme'],
                'flag' => $flag,
            ],
        ],
    ]);
} catch (PDOException $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if ($exception->getCode() === '23505') {
        workspaceFail(409, 'Это название уже используется. Выберите другое.');
    }
    error_log('Workspace database error: ' . $exception->getMessage());
    workspaceFail(500, 'Не удалось сохранить изменения. Попробуйте позже.');
} catch (Throwable $exception) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('Workspace error: ' . $exception->getMessage());
    workspaceFail(500, 'Не удалось загрузить рабочее пространство.');
}
