<?php

namespace App\Http\Controllers;

use App\Mail\CorporateAccountInvitation;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class WorkspaceController
{
    private const THEMES = ['blue', 'violet', 'green', 'amber', 'rose'];
    private const BOARD_TYPES = ['personal', 'community', 'corporate'];

    public function __invoke(Request $request): JsonResponse
    {
        $userId = (int) $request->user()->getAuthIdentifier();
        try {
            if ($request->isMethod('GET')) {
                return $this->read($request, $userId);
            }

            return DB::transaction(function () use ($request, $userId): JsonResponse {
                // A consistent account lock serializes workspace writes, including last-board deletion,
                // unused-flag cleanup, task append and reorder. Never lock another client's account ID.
                if (!DB::table('users')->where('id', $userId)->lockForUpdate()->first(['id'])) {
                    $this->fail(401, 'Требуется войти в аккаунт.');
                }
                if ($request->isMethod('DELETE')) {
                    return $this->delete($request, $userId);
                }
                $input = $request->json()->all();

                return match ($input['action'] ?? '') {
                    'create_board' => $this->saveBoard($input, $userId, false),
                    'update_board' => $this->saveBoard($input, $userId, true),
                    'create_list' => $this->saveList($input, $userId, false),
                    'update_list' => $this->saveList($input, $userId, true),
                    'create_flag' => $this->createFlag($input, $userId),
                    'invite_member' => $this->inviteMember($input, $userId),
                    'create_task', 'update_task', 'toggle_task', 'reorder_task' => $this->saveTask($input, $userId),
                    default => $this->fail(400, 'Unknown action'),
                };
            });
        } catch (QueryException $exception) {
            if ($exception->getCode() === '23505') {
                $this->fail(409, 'Это название уже используется. Выберите другое.');
            }
            throw $exception;
        }
    }

    private function read(Request $request, int $userId): JsonResponse
    {
        $corporateAccountIds = $this->corporateAccountIds($userId);
        $boards = DB::table('boards')->where(function ($query) use ($userId, $corporateAccountIds): void {
            $query->where('user_id', $userId);
            if ($corporateAccountIds !== []) {
                $query->orWhereIn('corporate_account_id', $corporateAccountIds);
            }
        })->orderByRaw('CASE WHEN corporate_account_id IS NOT NULL THEN 0 ELSE 1 END')
            ->orderByDesc('is_default')->orderBy('id')
            ->get(['id', 'user_id', 'corporate_account_id', 'name', 'description', 'board_type']);
        if ($boards->isEmpty()) {
            $this->fail(404, 'Рабочая доска не найдена.');
        }
        $search = $request->query('search');
        $search = is_string($search) ? trim($search) : '';
        if ($search !== '' && (mb_strlen($search) > 120 || preg_match('/[\x00-\x1F\x7F]/u', $search))) {
            $this->fail(422, 'Поисковый запрос слишком длинный или содержит недопустимые символы.');
        }
        $boardIds = $boards->pluck('id')->map(fn ($id) => (int) $id)->all();
        $lists = DB::table('task_lists as lists')->leftJoin('user_flags as flags', function ($join): void {
            $join->on('flags.id', '=', 'lists.flag_id')->on('flags.user_id', '=', 'lists.user_id')
                ->on('flags.board_id', '=', 'lists.board_id');
        })->whereIn('lists.board_id', $boardIds)->select([
            'lists.id', 'lists.board_id', 'lists.name', 'lists.description', 'lists.created_at',
            'lists.is_important', 'lists.theme', 'lists.flag_id', 'flags.name as flag_name', 'flags.color as flag_color',
        ]);
        if ($search !== '') {
            $found = $lists->join('boards', 'boards.id', '=', 'lists.board_id')
                ->addSelect('boards.name as board_name')
                // POSITION is a literal substring search: % and _ must not become LIKE wildcards.
                ->where(function ($query) use ($search): void {
                    $query->whereRaw('POSITION(LOWER(?) IN LOWER(lists.name)) > 0', [$search])
                        ->orWhereRaw('POSITION(LOWER(?) IN LOWER(lists.description)) > 0', [$search])
                        ->orWhereExists(function ($tasks) use ($search): void {
                            $tasks->selectRaw('1')->from('tasks')->whereColumn('tasks.list_id', 'lists.id')
                                ->whereColumn('tasks.user_id', 'lists.user_id')
                                ->whereRaw('POSITION(LOWER(?) IN LOWER(tasks.title)) > 0', [$search]);
                        });
                })->orderBy('boards.name')->orderByDesc('lists.created_at')->orderByDesc('lists.id')->get();
            $tasks = DB::table('tasks')->whereIn('list_id', $found->pluck('id'))
                ->orderBy('sort_order')->orderBy('id')->get(['id', 'list_id', 'title', 'is_completed'])->groupBy('list_id');
            $flags = DB::table('user_flags')->whereIn('board_id', $boardIds)->orderBy('name')
                ->get(['id', 'board_id', 'name', 'color'])->groupBy('board_id');

            return $this->success(['results' => $found->map(function ($list) use ($tasks, $flags): array {
                return $this->listData($list) + [
                    'board_name' => $list->board_name,
                    'flags' => ($flags->get($list->board_id) ?? collect())->map(fn ($flag) => $this->flagData($flag, true))->all(),
                    'tasks' => ($tasks->get($list->id) ?? collect())->map(fn ($task) => $this->taskData($task))->all(),
                ];
            })->all()]);
        }

        $board = $boards->first();
        $requested = $this->id($request->query('board_id'));
        if ($requested !== false) {
            $board = $boards->first(fn ($candidate) => (int) $candidate->id === $requested);
            if ($board === null) {
                $this->fail(404, 'Рабочая доска не найдена.');
            }
        }
        $boardOwnerId = (int) $board->user_id;
        $flags = DB::table('user_flags')->where('user_id', $boardOwnerId)->where('board_id', $board->id)
            ->orderBy('name')->get(['id', 'board_id', 'name', 'color']);
        $tasks = DB::table('tasks')->join('task_lists', 'task_lists.id', '=', 'tasks.list_id')
            ->where('tasks.user_id', $boardOwnerId)->where('task_lists.user_id', $boardOwnerId)->where('task_lists.board_id', $board->id)
            ->orderBy('tasks.list_id')->orderBy('tasks.sort_order')->orderBy('tasks.id')
            ->get(['tasks.id', 'tasks.list_id', 'tasks.title', 'tasks.is_completed']);

        return $this->success([
            'board' => $this->boardData($board),
            'boards' => $boards->map(fn ($item) => $this->boardData($item))->all(),
            'corporate_accounts' => DB::table('corporate_account_members as members')
                ->join('corporate_accounts as accounts', 'accounts.id', '=', 'members.corporate_account_id')
                ->where('members.user_id', $userId)->whereNotNull('members.accepted_at')
                ->orderBy('accounts.organization_name')
                ->get(['accounts.id', 'accounts.organization_name as name', 'members.role'])
                ->map(fn ($account) => ['id' => (int) $account->id, 'name' => $account->name, 'role' => $account->role])->all(),
            'flags' => $flags->map(fn ($flag) => $this->flagData($flag, true))->all(),
            'lists' => $lists->where('lists.board_id', $board->id)->orderBy('lists.created_at')->orderBy('lists.id')
                ->get()->map(fn ($list) => $this->listData($list))->all(),
            'tasks' => $tasks->map(fn ($task) => $this->taskData($task))->all(),
        ]);
    }

    private function saveBoard(array $input, int $userId, bool $update): JsonResponse
    {
        $id = $this->id($input['board_id'] ?? null);
        $name = $input['name'] ?? null;
        $description = $input['description'] ?? '';
        $type = $input['board_type'] ?? ($update ? null : 'personal');
        if (($update && $id === false) || !is_string($name) || trim($name) === ''
            || preg_match('/[\x00-\x1F\x7F]/u', $name) || mb_strlen(trim($name)) > 60
            || !is_string($description) || mb_strlen($description) > 2000 || !in_array($type, self::BOARD_TYPES, true)) {
            $this->fail(422, 'Проверьте название, описание и тип доски.');
        }
        $corporateAccountId = $this->id($input['corporate_account_id'] ?? null);
        $fields = ['name' => trim($name), 'description' => trim($description), 'board_type' => $type];
        if ($update) {
            $board = $this->accessibleBoard((int) $id, $userId);
            if ($board === null) {
                $this->fail(404, 'Доска не найдена.');
            }
            if ($board->corporate_account_id !== null) {
                $this->requireCorporateOwner((int) $board->corporate_account_id, $userId);
                if ($type !== 'corporate') {
                    $this->fail(422, 'Тип доски организации нельзя изменить.');
                }
            } elseif ($type === 'corporate') {
                $this->fail(422, 'Нельзя преобразовать личную доску в корпоративную.');
            }
            DB::table('boards')->where('id', $id)->update($fields);
        } else {
            $boardOwnerId = $userId;
            if ($type === 'corporate') {
                if ($corporateAccountId === false) {
                    $this->fail(422, 'Выберите организацию для корпоративной доски.');
                }
                $this->requireCorporateOwner($corporateAccountId, $userId);
                $boardOwnerId = (int) DB::table('corporate_account_members')->where('corporate_account_id', $corporateAccountId)
                    ->where('user_id', $userId)->value('user_id');
            }
            $id = DB::table('boards')->insertGetId($fields + [
                'user_id' => $boardOwnerId,
                'corporate_account_id' => $type === 'corporate' ? $corporateAccountId : null,
            ]);
            DB::table('task_lists')->insert([
                'user_id' => $boardOwnerId,
                'board_id' => $id,
                'name' => '👋 Hello World!',
                'description' => 'Это ваш первый список',
            ]);
        }

        return $this->success(['board' => ['id' => $id] + $fields + [
            'corporate_account_id' => $update ? ($board->corporate_account_id === null ? null : (int) $board->corporate_account_id)
                : ($type === 'corporate' ? $corporateAccountId : null),
        ]], $update ? 200 : 201);
    }

    private function saveList(array $input, int $userId, bool $update): JsonResponse
    {
        $id = $this->id($input['list_id'] ?? null);
        $boardId = $this->id($input['board_id'] ?? null);
        $name = $input['name'] ?? null;
        $description = $input['description'] ?? '';
        $theme = $input['theme'] ?? 'blue';
        $important = $input['is_important'] ?? false;
        $flagId = $input['flag_id'] ?? null;
        $newFlag = $input['new_flag_name'] ?? '';
        if ($update) {
            if ($id === false || !is_string($name) || trim($name) === '' || mb_strlen(trim($name)) > 80
                || !is_string($description) || mb_strlen($description) > 2000
                || !in_array($theme, self::THEMES, true) || !is_bool($important) || !is_string($newFlag)) {
                $this->fail(422, 'Проверьте настройки списка.');
            }
        } else {
            if (!is_string($name) || trim($name) === '' || preg_match('/[\x00-\x1F\x7F]/u', $name)) {
                $this->fail(422, 'Введите название списка.');
            }
            if (mb_strlen(trim($name)) > 80) {
                $this->fail(422, 'Название списка должно быть не длиннее 80 символов.');
            }
            if ($boardId === false || !is_bool($important) || !in_array($theme, self::THEMES, true)) {
                $this->fail(422, 'Проверьте настройки списка.');
            }
            if (!is_string($newFlag)) {
                $this->fail(422, 'Проверьте название флага.');
            }
        }
        $newFlag = trim($newFlag);
        if (!$update && $newFlag !== '' && $flagId !== null) {
            $this->fail(422, 'Выберите существующий флаг или создайте новый.');
        }
        if ($newFlag !== '' && (mb_strlen($newFlag) > 40 || preg_match('/[\x00-\x1F\x7F]/u', $newFlag))) {
            $this->fail(422, 'Название флага должно быть не длиннее 40 символов.');
        }
        if ($newFlag !== '' && $flagId !== null) {
            $this->fail(422, 'Выберите существующий флаг или создайте новый.');
        }
        $previous = null;
        $boardOwnerId = $userId;
        if ($update) {
            $previous = DB::table('task_lists')->where('id', $id)->first();
            if ($previous === null) {
                $this->fail(404, 'Список не найден.');
            }
            $boardId = (int) $previous->board_id;
            $board = $this->accessibleBoard($boardId, $userId);
            if ($board === null) {
                $this->fail(404, 'Список не найден.');
            }
            $boardOwnerId = (int) $board->user_id;
        } else {
            $board = $this->accessibleBoard((int) $boardId, $userId);
            if ($board === null) {
                $this->fail(404, 'Рабочая доска не найдена.');
            }
            $boardOwnerId = (int) $board->user_id;
        }
        if ($newFlag !== '') {
            $flagId = DB::table('user_flags')->insertGetId(['user_id' => $boardOwnerId, 'board_id' => $boardId, 'name' => $newFlag]);
        } elseif ($flagId !== null) {
            $flagId = $this->id($flagId);
            if ($flagId === false) {
                $this->fail(422, 'Проверьте выбранный флаг.');
            }
            if (!DB::table('user_flags')->where('id', $flagId)->where('user_id', $boardOwnerId)->where('board_id', $boardId)->exists()) {
                $this->fail(404, 'Флаг не найден.');
            }
        }
        // create_list historically ignores the description field; only update_list saves it.
        $fields = ['name' => trim($name), 'description' => $update ? trim($description) : '',
            'theme' => $theme, 'flag_id' => $flagId, 'is_important' => $important];
        if ($update) {
            DB::table('task_lists')->where('id', $id)->where('user_id', $boardOwnerId)->update($fields);
            if ($previous->flag_id !== null && (int) $previous->flag_id !== $flagId) {
                $this->deleteUnusedFlag((int) $previous->flag_id, $boardId, $boardOwnerId);
            }
        } else {
            $id = DB::table('task_lists')->insertGetId($fields + ['user_id' => $boardOwnerId, 'board_id' => $boardId]);
        }
        $flag = $flagId === null ? null : DB::table('user_flags')->where('id', $flagId)
            ->where('user_id', $boardOwnerId)->where('board_id', $boardId)->first(['id', 'board_id', 'name', 'color']);
        if ($update) {
            return $this->success(['updated' => true, 'flag' => $flag === null ? null : $this->flagData($flag, true)]);
        }

        return $this->success(['list' => ['id' => $id, 'name' => $fields['name'], 'is_important' => $important,
            'theme' => $theme, 'flag' => $flag === null ? null : $this->flagData($flag, false)]], 201);
    }

    private function createFlag(array $input, int $userId): JsonResponse
    {
        $boardId = $this->id($input['board_id'] ?? null);
        $name = $input['name'] ?? null;
        if ($boardId === false || !is_string($name) || trim($name) === ''
            || mb_strlen(trim($name)) > 40 || preg_match('/[\x00-\x1F\x7F]/u', $name)) {
            $this->fail(422, 'Проверьте название флага.');
        }
        $board = $boardId === false ? null : $this->accessibleBoard($boardId, $userId);
        if ($board === null) {
            $this->fail(404, 'Рабочая доска не найдена.');
        }
        $boardOwnerId = (int) $board->user_id;

        $id = DB::table('user_flags')->insertGetId([
            'user_id' => $boardOwnerId,
            'board_id' => $boardId,
            'name' => trim($name),
        ]);
        $flag = DB::table('user_flags')->where('id', $id)->first(['id', 'board_id', 'name', 'color']);

        return $this->success(['flag' => $this->flagData($flag, true)], 201);
    }

    private function inviteMember(array $input, int $userId): JsonResponse
    {
        $corporateAccountId = $this->id($input['corporate_account_id'] ?? null);
        $identifier = $input['identifier'] ?? null;
        $role = $input['role'] ?? null;
        if ($corporateAccountId === false || !is_string($identifier) || $identifier === ''
            || $identifier !== trim($identifier) || strlen($identifier) > 254
            || !is_string($role) || !in_array($role, ['admin', 'manager', 'support'], true)) {
            $this->fail(422, 'Проверьте контакт и роль участника.');
        }
        $this->requireCorporateOwner($corporateAccountId, $userId);

        if (filter_var($identifier, FILTER_VALIDATE_EMAIL) !== false) {
            $email = strtolower($identifier);
        } elseif (preg_match('/^@[A-Za-z][A-Za-z0-9_-]{2,23}$/D', $identifier) === 1) {
            $invitee = DB::table('users')->whereRaw('LOWER(username) = ?', [strtolower($identifier)])->first(['email']);
            if ($invitee === null || !is_string($invitee->email) || filter_var($invitee->email, FILTER_VALIDATE_EMAIL) === false) {
                $this->fail(422, 'По этому логину не найден пользователь с e-mail. Укажите адрес почты для приглашения.');
            }
            $email = strtolower($invitee->email);
        } else {
            $this->fail(422, 'Введите корректный e-mail или зарегистрированный логин участника.');
        }

        if (DB::table('corporate_account_members')->where('corporate_account_id', $corporateAccountId)
            ->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            $this->fail(409, 'Этот пользователь уже добавлен или приглашён.');
        }

        $token = bin2hex(random_bytes(32));
        DB::table('corporate_account_members')->insert([
            'corporate_account_id' => $corporateAccountId,
            'email' => $email,
            'role' => $role,
            'invitation_token_hash' => hash('sha256', $token),
            'invitation_expires_at' => now()->addDays(7),
        ]);

        $account = DB::table('corporate_accounts')->where('id', $corporateAccountId)->first(['organization_type', 'organization_name']);
        $accountName = (string) ($account->organization_name ?? '');
        $invitationUrl = rtrim((string) config('app.frontend_url'), '/').'/pages/corporate-invitation.html?token='.$token;
        $invitee = DB::table('users')->whereRaw('LOWER(email) = ?', [$email])->first(['first_name', 'middle_name']);
        $recipientName = trim(implode(' ', array_filter([
            is_string($invitee->first_name ?? null) ? trim($invitee->first_name) : '',
            is_string($invitee->middle_name ?? null) ? trim($invitee->middle_name) : '',
        ], static fn (string $part): bool => $part !== '')));
        $sent = true;
        try {
            Mail::to($email)->send(new CorporateAccountInvitation((string) ($account->organization_type ?? ''), $accountName, $role, $invitationUrl, $recipientName));
        } catch (\Throwable $exception) {
            Log::warning('Corporate account invitation email could not be sent.', [
                'recipient_hash' => hash('sha256', $email),
                'exception' => $exception::class,
            ]);
            $sent = false;
        }

        return $this->success(['invited' => true, 'email_sent' => $sent], 201);
    }

    private function saveTask(array $input, int $userId): JsonResponse
    {
        $action = $input['action'];
        $id = $this->id($input[$action === 'create_task' ? 'list_id' : 'task_id'] ?? null);
        $title = $input['title'] ?? null;
        if (in_array($action, ['create_task', 'update_task'], true)) {
            if ($id === false || !is_string($title) || trim($title) === '' || mb_strlen(trim($title)) > 240) {
                $this->fail(422, $action === 'create_task' ? 'Введите название задачи (не более 240 символов).'
                    : 'Название задачи должно содержать от 1 до 240 символов.');
            }
        } elseif ($id === false || ($action === 'toggle_task' && !is_bool($input['is_completed'] ?? null))
            || ($action === 'reorder_task' && $this->id($input['target_task_id'] ?? null) === false)) {
            $this->fail(422, 'Некорректная задача.');
        }
        if ($action === 'create_task') {
            $list = DB::table('task_lists')->where('id', $id)->first();
            $board = $list === null ? null : $this->accessibleBoard((int) $list->board_id, $userId);
            if ($list === null || $board === null) {
                $this->fail(404, 'Список не найден.');
            }
            $boardOwnerId = (int) $board->user_id;
            $maximum = DB::table('tasks')->where('user_id', $boardOwnerId)->where('list_id', $id)->max('sort_order');
            $taskId = DB::table('tasks')->insertGetId(['user_id' => $boardOwnerId, 'list_id' => $id,
                'title' => trim($title), 'sort_order' => $maximum === null ? 0 : $maximum + 1]);

            return $this->success(['task' => ['id' => $taskId, 'list_id' => $id, 'title' => trim($title), 'is_completed' => false]], 201);
        }
        $task = DB::table('tasks')->where('id', $id)->first();
        $list = $task === null ? null : DB::table('task_lists')->where('id', $task->list_id)->where('user_id', $task->user_id)->first();
        $board = $list === null ? null : $this->accessibleBoard((int) $list->board_id, $userId);
        if ($task === null || $list === null || $board === null || (int) $task->user_id !== (int) $board->user_id) {
            $this->fail(404, 'Задача не найдена.');
        }
        $boardOwnerId = (int) $board->user_id;
        if ($action === 'reorder_task') {
            $ids = DB::table('tasks')->where('list_id', $task->list_id)->where('user_id', $boardOwnerId)
                ->orderBy('sort_order')->orderBy('id')->lockForUpdate()->pluck('id')->map(fn ($value) => (int) $value)->all();
            $source = array_search($id, $ids, true);
            $target = array_search($this->id($input['target_task_id']), $ids, true);
            if ($source === false || $target === false) {
                $this->fail(404, 'Задача не найдена в этом списке.');
            }
            if ($source !== $target) {
                $moving = array_splice($ids, $source, 1)[0];
                array_splice($ids, $target, 0, [$moving]);
                foreach ($ids as $position => $orderedId) {
                    DB::table('tasks')->where('id', $orderedId)->where('user_id', $boardOwnerId)->update(['sort_order' => $position]);
                }
            }
        } else {
            DB::table('tasks')->where('id', $id)->where('user_id', $boardOwnerId)->update($action === 'toggle_task'
                ? ['is_completed' => $input['is_completed']] : ['title' => trim($title)]);
        }

        return $this->success(['updated' => true]);
    }

    private function delete(Request $request, int $userId): JsonResponse
    {
        if (array_key_exists('board_id', $request->query())) {
            $id = $this->id($request->query('board_id'));
            if ($id === false) {
                $this->fail(422, 'Некорректная доска.');
            }
            $board = $this->accessibleBoard((int) $id, $userId, true);
            if ($board === null) {
                $this->fail(404, 'Доска не найдена.');
            }
            if ($board->corporate_account_id !== null) {
                $this->requireCorporateOwner((int) $board->corporate_account_id, $userId);
            }
            $scope = DB::table('boards');
            if ($board->corporate_account_id !== null) {
                $scope->where('corporate_account_id', $board->corporate_account_id);
            } else {
                $scope->where('user_id', $userId)->whereNull('corporate_account_id');
            }
            if ($scope->count() <= 1) {
                $this->fail(409, 'Нельзя удалить последнюю доску.');
            }
            $replacementQuery = DB::table('boards')->where('id', '<>', $id);
            if ($board->corporate_account_id !== null) {
                $replacementQuery->where('corporate_account_id', $board->corporate_account_id);
            } else {
                $replacementQuery->where('user_id', $userId)->whereNull('corporate_account_id');
            }
            $replacement = (int) $replacementQuery
                ->orderByDesc('is_default')->orderBy('created_at')->orderBy('id')->value('id');
            DB::table('boards')->where('id', $id)->delete();
            if ($board->is_default) {
                DB::table('boards')->where('id', $replacement)->update(['is_default' => true]);
            }

            return $this->success(['deleted' => true, 'replacement_board_id' => $replacement]);
        }
        $id = $this->id($request->query('list_id'));
        if ($id === false) {
            $this->fail(422, 'Некорректный список.');
        }
        $list = DB::table('task_lists')->where('id', $id)->first();
        $board = $list === null ? null : $this->accessibleBoard((int) $list->board_id, $userId);
        if ($list === null || $board === null || (int) $list->user_id !== (int) $board->user_id) {
            $this->fail(404, 'Список не найден.');
        }
        $boardOwnerId = (int) $board->user_id;
        DB::table('task_lists')->where('id', $id)->where('user_id', $boardOwnerId)->delete();
        if ($list->flag_id !== null) {
            $this->deleteUnusedFlag((int) $list->flag_id, (int) $list->board_id, $boardOwnerId);
        }

        return $this->success(['deleted' => true]);
    }

    private function deleteUnusedFlag(int $flagId, int $boardId, int $userId): void
    {
        DB::table('user_flags')->where('id', $flagId)->where('board_id', $boardId)->where('user_id', $userId)
            ->whereNotExists(fn ($query) => $query->selectRaw('1')->from('task_lists')->whereColumn('task_lists.flag_id', 'user_flags.id'))
            ->delete();
    }

    /** @return list<int> */
    private function corporateAccountIds(int $userId): array
    {
        return DB::table('corporate_account_members')->where('user_id', $userId)
            ->whereNotNull('accepted_at')->pluck('corporate_account_id')->map(fn ($id) => (int) $id)->all();
    }

    private function accessibleBoard(int $boardId, int $userId, bool $lock = false): ?object
    {
        $board = DB::table('boards')->where('id', $boardId)->first();
        if ($board === null) {
            return null;
        }
        if ((int) $board->user_id === $userId && $board->corporate_account_id === null) {
            return $lock ? DB::table('boards')->where('id', $boardId)->lockForUpdate()->first() : $board;
        }
        if ($board->corporate_account_id === null || !DB::table('corporate_account_members')
            ->where('corporate_account_id', $board->corporate_account_id)->where('user_id', $userId)
            ->whereNotNull('accepted_at')->exists()) {
            return null;
        }

        return $lock ? DB::table('boards')->where('id', $boardId)->lockForUpdate()->first() : $board;
    }

    private function requireCorporateOwner(int $corporateAccountId, int $userId): void
    {
        $isOwner = DB::table('corporate_account_members')->where('corporate_account_id', $corporateAccountId)
            ->where('user_id', $userId)->where('role', 'owner')->whereNotNull('accepted_at')->exists();
        if (!$isOwner) {
            $this->fail(403, 'Только owner может управлять досками организации и приглашать участников.');
        }
    }

    private function id(mixed $value): int|false
    {
        return filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    }

    private function boardData(object $board): array
    {
        return ['id' => (int) $board->id, 'name' => $board->name, 'description' => $board->description,
            'board_type' => $board->board_type, 'corporate_account_id' => isset($board->corporate_account_id) ? (int) $board->corporate_account_id : null];
    }

    private function taskData(object $task): array
    {
        return ['id' => (int) $task->id, 'list_id' => (int) $task->list_id, 'title' => $task->title, 'is_completed' => (bool) $task->is_completed];
    }

    private function flagData(object $flag, bool $withBoard): array
    {
        return ['id' => (int) $flag->id, 'name' => $flag->name, 'color' => $flag->color]
            + ($withBoard ? ['board_id' => (int) $flag->board_id] : []);
    }

    private function listData(object $list): array
    {
        return ['id' => (int) $list->id, 'board_id' => (int) $list->board_id, 'name' => $list->name,
            'description' => $list->description, 'created_at' => $list->created_at, 'is_important' => (bool) $list->is_important,
            'theme' => $list->theme, 'flag' => $list->flag_id === null ? null
                : ['id' => (int) $list->flag_id, 'name' => $list->flag_name, 'color' => $list->flag_color]];
    }

    private function success(array $data, int $status = 200): JsonResponse
    {
        return response()->json(['success' => true, 'data' => $data], $status);
    }

    private function fail(int $status, string $message): never
    {
        // Throw inside transactions so validation/ownership failures roll back all preceding writes.
        throw new HttpResponseException(response()->json(['success' => false, 'error' => $message], $status)
            ->header('Cache-Control', 'no-store')->header('X-Content-Type-Options', 'nosniff'));
    }
}
