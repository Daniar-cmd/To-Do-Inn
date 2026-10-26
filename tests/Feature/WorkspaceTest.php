<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\DatabaseTestCase;

class WorkspaceTest extends DatabaseTestCase
{
    private User $user;
    private User $other;
    private int $board;
    private int $foreignBoard;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = $this->createUser();
        $this->other = $this->createUser();
        $this->board = $this->board($this->user->id, 'Default', true);
        $this->foreignBoard = $this->board($this->other->id, 'Foreign', true);
        $this->withSession(['_token' => str_repeat('a', 40)]);
        Auth::login($this->user);
    }

    public function test_empty_workspace_preserves_the_exact_json_contract(): void
    {
        $this->request()->assertOk()->assertExactJson(['success' => true, 'data' => [
            'board' => ['id' => $this->board, 'name' => 'Default', 'description' => '', 'board_type' => 'personal'],
            'boards' => [['id' => $this->board, 'name' => 'Default', 'description' => '', 'board_type' => 'personal']],
            'flags' => [], 'lists' => [], 'tasks' => [],
        ]])->assertHeader('Cache-Control', 'no-store, private')->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_board_selection_is_owned_and_invalid_get_ids_fall_back_to_default(): void
    {
        $second = $this->board($this->user->id, 'Second');
        $this->request(query: '?board_id='.$second)->assertJsonPath('data.board.id', $second);
        $this->request(query: '?board_id='.$this->foreignBoard)->assertNotFound();
        foreach (['abc', '0', '-1', '1.5', '', '9999999999999999999999999', '01'] as $invalid) {
            $this->request(query: '?board_id='.$invalid)->assertJsonPath('data.board.id', $this->board);
        }
        $this->request(query: '?board_id[]=1')->assertJsonPath('data.board.id', $this->board);
        DB::table('boards')->where('user_id', $this->user->id)->delete();
        $this->request()->assertNotFound()->assertJsonPath('error', 'Рабочая доска не найдена.');
    }

    public function test_board_create_update_and_duplicate_names_are_scoped_to_user(): void
    {
        $created = $this->postWorkspace(['action' => 'create_board', 'name' => ' Foreign ', 'description' => ' text ', 'board_type' => 'community',
            'user_id' => $this->other->id, 'is_default' => true])->assertCreated();
        $id = $created->json('data.board.id');
        $created->assertExactJson(['success' => true, 'data' => ['board' => [
            'id' => $id, 'name' => 'Foreign', 'description' => 'text', 'board_type' => 'community',
        ]]]);
        $this->assertSame($this->user->id, (int) DB::table('boards')->where('id', $id)->value('user_id'));
        $this->assertFalse(DB::table('boards')->where('id', $id)->value('is_default'));
        $this->postWorkspace(['action' => 'create_board', 'name' => 'Foreign'])->assertConflict()
            ->assertJsonPath('error', 'Это название уже используется. Выберите другое.');
        $this->postWorkspace(['action' => 'update_board', 'board_id' => $id, 'name' => 'Renamed', 'board_type' => 'corporate'])
            ->assertOk()->assertJsonPath('data.board.description', '')->assertJsonPath('data.board.name', 'Renamed');
        $this->postWorkspace(['action' => 'update_board', 'board_id' => $id, 'name' => 'Default', 'board_type' => 'personal'])->assertConflict();
        $this->assertSame('Renamed', DB::table('boards')->where('id', $id)->value('name'));
    }

    public function test_lists_flags_and_tasks_keep_the_response_shapes_and_order(): void
    {
        $list = $this->postWorkspace(['action' => 'create_list', 'board_id' => $this->board, 'name' => ' One ',
            'is_important' => true, 'theme' => 'rose', 'new_flag_name' => ' Flag ', 'description' => 'Ignored'])->assertCreated();
        $id = $list->json('data.list.id');
        $flag = $list->json('data.list.flag.id');
        $list->assertExactJson(['success' => true, 'data' => ['list' => ['id' => $id, 'name' => 'One',
            'is_important' => true, 'theme' => 'rose', 'flag' => ['id' => $flag, 'name' => 'Flag', 'color' => 'blue']]]]);
        $task = $this->postWorkspace(['action' => 'create_task', 'list_id' => $id, 'title' => ' First '])->assertCreated()->json('data.task.id');
        $second = $this->postWorkspace(['action' => 'create_task', 'list_id' => $id, 'title' => 'Second'])->assertCreated()->json('data.task.id');
        $response = $this->request()->assertOk()->assertJsonPath('data.lists.0.description', '')
            ->assertJsonPath('data.lists.0.flag', ['id' => $flag, 'name' => 'Flag', 'color' => 'blue'])
            ->assertJsonPath('data.flags.0.board_id', $this->board)
            ->assertJsonPath('data.tasks', [
                ['id' => $task, 'list_id' => $id, 'title' => 'First', 'is_completed' => false],
                ['id' => $second, 'list_id' => $id, 'title' => 'Second', 'is_completed' => false],
            ]);
        $this->assertSame(DB::table('task_lists')->where('id', $id)->value('created_at'), $response->json('data.lists.0.created_at'));
        $this->postWorkspace(['action' => 'update_list', 'list_id' => $id, 'name' => 'Updated', 'description' => ' New description ', 'flag_id' => $flag])
            ->assertExactJson(['success' => true, 'data' => ['updated' => true,
                'flag' => ['id' => $flag, 'board_id' => $this->board, 'name' => 'Flag', 'color' => 'blue']]]);
        $this->request()->assertJsonPath('data.lists.0.description', 'New description')
            ->assertJsonPath('data.lists.0.theme', 'blue')->assertJsonPath('data.lists.0.is_important', false);
    }

    public function test_toggle_both_directions_update_and_reorder_in_both_directions(): void
    {
        $list = $this->list($this->user->id, $this->board);
        $ids = [];
        foreach (['A', 'B', 'C'] as $title) {
            $ids[] = $this->postWorkspace(['action' => 'create_task', 'list_id' => $list, 'title' => $title])->assertCreated()->json('data.task.id');
        }
        foreach ([true, false] as $completed) {
            $this->postWorkspace(['action' => 'toggle_task', 'task_id' => $ids[0], 'is_completed' => $completed])->assertExactJson([
                'success' => true, 'data' => ['updated' => true],
            ]);
            $this->assertSame($completed, DB::table('tasks')->where('id', $ids[0])->value('is_completed'));
        }
        $this->postWorkspace(['action' => 'update_task', 'task_id' => $ids[0], 'title' => ' Новое имя '])->assertOk();
        $this->assertSame('Новое имя', DB::table('tasks')->where('id', $ids[0])->value('title'));
        $this->postWorkspace(['action' => 'reorder_task', 'task_id' => $ids[0], 'target_task_id' => $ids[2]])->assertOk();
        $this->assertSame([$ids[1], $ids[2], $ids[0]], $this->taskOrder($list));
        $this->postWorkspace(['action' => 'reorder_task', 'task_id' => $ids[0], 'target_task_id' => $ids[1]])->assertOk();
        $this->assertSame($ids, $this->taskOrder($list));
        $this->postWorkspace(['action' => 'reorder_task', 'task_id' => $ids[1], 'target_task_id' => $ids[1]])->assertOk();
        $this->assertSame($ids, $this->taskOrder($list));
        $this->assertSame([0, 1, 2], DB::table('tasks')->where('list_id', $list)->orderBy('sort_order')->pluck('sort_order')->all());
    }

    public function test_foreign_and_missing_resources_cannot_be_changed(): void
    {
        $foreignList = $this->list($this->other->id, $this->foreignBoard);
        $foreignTask = $this->task($this->other->id, $foreignList, 'Private');
        $before = $this->state();
        foreach ([$this->foreignBoard, PHP_INT_MAX] as $id) {
            $this->postWorkspace(['action' => 'update_board', 'board_id' => $id, 'name' => 'Hack', 'board_type' => 'personal'])->assertNotFound();
            $this->postWorkspace(['action' => 'create_list', 'board_id' => $id, 'name' => 'Hack'])->assertNotFound();
            $this->request('DELETE', query: '?board_id='.$id)->assertNotFound();
        }
        foreach ([$foreignList, PHP_INT_MAX] as $id) {
            $this->postWorkspace(['action' => 'update_list', 'list_id' => $id, 'name' => 'Hack', 'new_flag_name' => 'Not created'])->assertNotFound();
            $this->postWorkspace(['action' => 'create_task', 'list_id' => $id, 'title' => 'Hack'])->assertNotFound();
            $this->request('DELETE', query: '?list_id='.$id)->assertNotFound();
        }
        foreach ([$foreignTask, PHP_INT_MAX] as $id) {
            $this->postWorkspace(['action' => 'toggle_task', 'task_id' => $id, 'is_completed' => true])->assertNotFound();
            $this->postWorkspace(['action' => 'update_task', 'task_id' => $id, 'title' => 'Hack'])->assertNotFound();
            $this->postWorkspace(['action' => 'reorder_task', 'task_id' => $id, 'target_task_id' => $id])->assertNotFound();
        }
        $this->assertSame($before, $this->state());
    }

    public function test_flags_must_belong_to_same_user_and_board_for_create_and_update(): void
    {
        $secondBoard = $this->board($this->user->id, 'Second');
        $foreignFlag = $this->flag($this->other->id, $this->foreignBoard, 'Foreign');
        $secondFlag = $this->flag($this->user->id, $secondBoard, 'Other board');
        $list = $this->list($this->user->id, $this->board);
        $before = $this->state();
        foreach ([$foreignFlag, $secondFlag, PHP_INT_MAX] as $flag) {
            $this->postWorkspace(['action' => 'create_list', 'board_id' => $this->board, 'name' => 'Not saved', 'flag_id' => $flag])->assertNotFound();
            $this->postWorkspace(['action' => 'update_list', 'list_id' => $list, 'name' => 'Not saved', 'flag_id' => $flag])->assertNotFound();
        }
        $this->assertSame($before, $this->state());
    }

    public function test_shared_flags_survive_until_last_reference_is_removed(): void
    {
        $flag = $this->flag($this->user->id, $this->board, 'Shared');
        $one = $this->list($this->user->id, $this->board, 'One', $flag);
        $two = $this->list($this->user->id, $this->board, 'Two', $flag);
        $task = $this->task($this->user->id, $one, 'Cascade');
        $this->request('DELETE', query: '?list_id='.$one)->assertExactJson(['success' => true, 'data' => ['deleted' => true]]);
        $this->assertFalse(DB::table('tasks')->where('id', $task)->exists());
        $this->assertTrue(DB::table('user_flags')->where('id', $flag)->exists());
        $this->postWorkspace(['action' => 'update_list', 'list_id' => $two, 'name' => 'Two', 'new_flag_name' => 'Replacement'])->assertOk();
        $this->assertFalse(DB::table('user_flags')->where('id', $flag)->exists());
        $newFlag = DB::table('task_lists')->where('id', $two)->value('flag_id');
        $this->request('DELETE', query: '?list_id='.$two)->assertOk();
        $this->assertFalse(DB::table('user_flags')->where('id', $newFlag)->exists());
    }

    public function test_duplicate_list_or_flag_rolls_back_new_flags_and_other_changes(): void
    {
        $existing = $this->list($this->user->id, $this->board, 'Existing');
        $another = $this->list($this->user->id, $this->board, 'Another');
        $this->flag($this->user->id, $this->board, 'Taken');
        $before = $this->state();
        $this->postWorkspace(['action' => 'create_list', 'board_id' => $this->board, 'name' => 'Existing', 'new_flag_name' => 'Rollback'])->assertConflict();
        $this->postWorkspace(['action' => 'update_list', 'list_id' => $another, 'name' => 'Existing', 'new_flag_name' => 'Rollback'])->assertConflict();
        $this->postWorkspace(['action' => 'update_list', 'list_id' => $existing, 'name' => 'Renamed', 'new_flag_name' => 'Taken'])->assertConflict();
        $this->assertSame($before, $this->state());
    }

    public function test_delete_default_board_cascades_and_promotes_a_replacement_but_last_board_survives(): void
    {
        $flag = $this->flag($this->user->id, $this->board, 'Gone');
        $list = $this->list($this->user->id, $this->board, 'Gone', $flag);
        $task = $this->task($this->user->id, $list, 'Gone');
        $second = $this->board($this->user->id, 'Second');
        $this->request('DELETE', query: '?board_id='.$this->board.'&list_id='.$list)
            ->assertExactJson(['success' => true, 'data' => ['deleted' => true, 'replacement_board_id' => $second]]);
        foreach (['boards' => $this->board, 'task_lists' => $list, 'tasks' => $task, 'user_flags' => $flag] as $table => $id) {
            $this->assertFalse(DB::table($table)->where('id', $id)->exists());
        }
        $this->assertTrue(DB::table('boards')->where('id', $second)->value('is_default'));
        $this->request('DELETE', query: '?board_id='.$second)->assertConflict()->assertJsonPath('error', 'Нельзя удалить последнюю доску.');
        $this->assertTrue(DB::table('boards')->where('id', $this->foreignBoard)->exists());
        $third = $this->board($this->user->id, 'Third');
        $this->request('DELETE', query: '?board_id='.$third)->assertJsonPath('data.replacement_board_id', $second);
        $this->assertTrue(DB::table('boards')->where('id', $second)->value('is_default'));
    }

    public function test_reorder_cannot_cross_lists_or_accounts(): void
    {
        $one = $this->list($this->user->id, $this->board, 'One');
        $two = $this->list($this->user->id, $this->board, 'Two');
        $foreign = $this->list($this->other->id, $this->foreignBoard);
        $source = $this->task($this->user->id, $one, 'Source');
        foreach ([$this->task($this->user->id, $two, 'Other'), $this->task($this->other->id, $foreign, 'Foreign'), PHP_INT_MAX] as $target) {
            $before = $this->state();
            $this->postWorkspace(['action' => 'reorder_task', 'task_id' => $source, 'target_task_id' => $target])->assertNotFound()
                ->assertJsonPath('error', 'Задача не найдена в этом списке.');
            $this->assertSame($before, $this->state());
        }
    }

    public function test_search_matches_name_description_or_task_literally_and_returns_all_list_tasks_and_board_flags(): void
    {
        $otherBoard = $this->board($this->user->id, 'Another');
        $flag = $this->flag($this->user->id, $otherBoard, 'Search flag');
        $list = $this->list($this->user->id, $otherBoard, '100%_List', $flag);
        $this->task($this->user->id, $list, 'Needle');
        $this->task($this->user->id, $list, 'Unrelated');
        $foreignList = $this->list($this->other->id, $this->foreignBoard, '100%_List');
        $this->task($this->other->id, $foreignList, 'Needle');
        foreach (['needle', 'NEEDLE', '%_', '100%_'] as $query) {
            $this->request(query: '?search='.urlencode($query).'&board_id='.$this->foreignBoard)->assertOk()
                ->assertJsonCount(1, 'data.results')->assertJsonPath('data.results.0.id', $list)
                ->assertJsonPath('data.results.0.board_name', 'Another')->assertJsonCount(2, 'data.results.0.tasks')
                ->assertJsonPath('data.results.0.flags', [['id' => $flag, 'name' => 'Search flag', 'color' => 'blue', 'board_id' => $otherBoard]]);
        }
        DB::table('task_lists')->where('id', $list)->update(['description' => 'Описание']);
        $this->request(query: '?search='.urlencode('ОПИСАНИЕ'))->assertJsonCount(1, 'data.results');
        $this->request(query: '?search=Missing')->assertExactJson(['success' => true, 'data' => ['results' => []]]);
        $this->request(query: '?search=%20%20')->assertJsonPath('data.board.id', $this->board);
        $this->request(query: '?search[]=needle')->assertJsonPath('data.board.id', $this->board);
    }

    public function test_search_and_board_list_ordering_preserve_legacy_rules(): void
    {
        $a = $this->list($this->user->id, $this->board, 'Match A');
        $b = $this->list($this->user->id, $this->board, 'Match B');
        DB::table('task_lists')->where('id', $a)->update(['created_at' => '2020-01-01 00:00:00+00']);
        DB::table('task_lists')->where('id', $b)->update(['created_at' => '2020-01-01 00:00:00+00']);
        $this->assertSame([$a, $b], $this->request()->json('data.lists.*.id'));
        $this->assertSame([$b, $a], $this->request(query: '?search=Match')->json('data.results.*.id'));
        $earlier = $this->board($this->user->id, 'Alphabetical first');
        $c = $this->list($this->user->id, $earlier, 'Match C');
        $this->assertSame([$c, $b, $a], $this->request(query: '?search=Match')->json('data.results.*.id'));
        $this->assertSame([$this->board, $earlier], $this->request()->json('data.boards.*.id'));
    }

    #[DataProvider('invalidInputs')]
    public function test_invalid_inputs_are_rejected_without_any_writes(array $input, int $status, string $message): void
    {
        $input += ['board_id' => $this->board];
        $before = $this->state();
        $this->postWorkspace($input)->assertStatus($status)->assertExactJson(['success' => false, 'error' => $message]);
        $this->assertSame($before, $this->state());
    }

    public static function invalidInputs(): array
    {
        $boardError = 'Проверьте название, описание и тип доски.';
        $listError = 'Проверьте настройки списка.';
        return [
            'missing action' => [[], 400, 'Unknown action'],
            'array action' => [['action' => []], 400, 'Unknown action'],
            'task deletion not invented' => [['action' => 'delete_task'], 400, 'Unknown action'],
            'empty board' => [['action' => 'create_board', 'name' => ' '], 422, $boardError],
            'long board' => [['action' => 'create_board', 'name' => str_repeat('я', 61)], 422, $boardError],
            'board controls' => [['action' => 'create_board', 'name' => "X\nY"], 422, $boardError],
            'board description type' => [['action' => 'create_board', 'name' => 'X', 'description' => []], 422, $boardError],
            'board description length' => [['action' => 'create_board', 'name' => 'X', 'description' => str_repeat('я', 2001)], 422, $boardError],
            'board type' => [['action' => 'create_board', 'name' => 'X', 'board_type' => 'admin'], 422, $boardError],
            'update board needs type' => [['action' => 'update_board', 'name' => 'X'], 422, $boardError],
            'list controls' => [['action' => 'create_list', 'name' => "X\nY"], 422, 'Введите название списка.'],
            'list long' => [['action' => 'create_list', 'name' => str_repeat('я', 81)], 422, 'Название списка должно быть не длиннее 80 символов.'],
            'list boolean strict' => [['action' => 'create_list', 'name' => 'X', 'is_important' => 'true'], 422, $listError],
            'list theme' => [['action' => 'create_list', 'name' => 'X', 'theme' => []], 422, $listError],
            'flag name type' => [['action' => 'create_list', 'name' => 'X', 'new_flag_name' => []], 422, 'Проверьте название флага.'],
            'flag length' => [['action' => 'create_list', 'name' => 'X', 'new_flag_name' => str_repeat('я', 41)], 422, 'Название флага должно быть не длиннее 40 символов.'],
            'two flags' => [['action' => 'create_list', 'name' => 'X', 'new_flag_name' => 'Flag', 'flag_id' => 1], 422, 'Выберите существующий флаг или создайте новый.'],
            'flag invalid id' => [['action' => 'create_list', 'name' => 'X', 'flag_id' => []], 422, 'Проверьте выбранный флаг.'],
            'task empty' => [['action' => 'create_task', 'list_id' => 1, 'title' => ' '], 422, 'Введите название задачи (не более 240 символов).'],
            'task long' => [['action' => 'update_task', 'task_id' => 1, 'title' => str_repeat('я', 241)], 422, 'Название задачи должно содержать от 1 до 240 символов.'],
            'toggle strict bool' => [['action' => 'toggle_task', 'task_id' => 1, 'is_completed' => 1], 422, 'Некорректная задача.'],
            'reorder missing target' => [['action' => 'reorder_task', 'task_id' => 1], 422, 'Некорректная задача.'],
        ];
    }

    public function test_unicode_length_boundaries_and_ignored_client_columns(): void
    {
        $id = $this->postWorkspace(['action' => 'create_board', 'name' => str_repeat('я', 60), 'description' => str_repeat('я', 2000)])
            ->assertCreated()->json('data.board.id');
        $list = $this->postWorkspace(['action' => 'create_list', 'board_id' => $id, 'name' => str_repeat('я', 80), 'new_flag_name' => str_repeat('я', 40),
            'user_id' => $this->other->id, 'description' => ['ignored']])->assertCreated()->json('data.list.id');
        $task = $this->postWorkspace(['action' => 'create_task', 'list_id' => $list, 'title' => str_repeat('я', 240),
            'user_id' => $this->other->id, 'is_completed' => true, 'sort_order' => -99])->assertCreated()->json('data.task.id');
        $row = DB::table('tasks')->where('id', $task)->first();
        $this->assertSame($this->user->id, (int) $row->user_id);
        $this->assertSame(0, (int) $row->sort_order);
        $this->assertFalse($row->is_completed);
    }

    public function test_middleware_order_methods_csrf_and_json_envelope(): void
    {
        $before = $this->state();
        foreach (['PUT', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'] as $method) {
            $this->request($method, token: false)->assertStatus(405)->assertHeader('Allow', 'GET, POST, DELETE');
        }
        $this->request('POST', raw: '{', token: false, contentType: 'text/plain')->assertStatus(415);
        $this->request('POST', raw: '{', token: false)->assertForbidden()->assertJsonPath('error', 'Сессия истекла. Обновите страницу.');
        $this->request('DELETE', token: false)->assertForbidden();
        foreach (['{', '', '42', 'null'] as $raw) {
            $this->request('POST', raw: $raw)->assertBadRequest()->assertJsonPath('error', 'Invalid JSON request');
        }
        $this->request('POST', raw: str_pad('{"action":"unknown"}', 8192))->assertBadRequest()->assertJsonPath('error', 'Unknown action');
        $this->request('POST', raw: str_pad('{"action":"unknown"}', 8193))->assertStatus(413)->assertJsonPath('error', 'Request is too large');
        $this->request('POST', query: '?action=create_board&name=NotSaved', body: [])->assertBadRequest();
        $this->request('DELETE', body: ['board_id' => $this->board])->assertUnprocessable();
        $this->assertSame($before, $this->state());
    }

    public function test_guests_get_401_before_envelope_checks_even_with_legacy_session_data(): void
    {
        Auth::logout();
        $this->withSession(['user' => ['id' => $this->user->id]]);
        foreach (['GET', 'POST', 'DELETE', 'PUT', 'HEAD'] as $method) {
            $this->request($method, raw: '{', token: false, contentType: 'text/plain')->assertUnauthorized()->assertHeaderMissing('Location');
        }
    }

    public function test_search_bounds_and_invalid_delete_ids(): void
    {
        foreach ([str_repeat('я', 121), "hello\x01world", "hello\0world"] as $search) {
            $this->request(query: '?search='.urlencode($search))->assertUnprocessable();
        }
        $this->request(query: '?search='.urlencode(str_repeat('я', 120)))->assertOk();
        foreach (['', '?list_id=0', '?list_id[]=1', '?board_id=bad&list_id=1', '?board_id[]=1'] as $query) {
            $this->request('DELETE', query: $query)->assertUnprocessable();
        }
    }

    public function test_failures_after_writes_roll_back_reordering_and_hide_internal_details(): void
    {
        $list = $this->list($this->user->id, $this->board);
        $one = $this->task($this->user->id, $list, 'One', 10);
        $two = $this->task($this->user->id, $list, 'Two', 20);
        $before = $this->state();
        DB::listen(function ($query): void {
            if (str_starts_with($query->sql, 'update "tasks"')) {
                throw new RuntimeException('Private SQL and path');
            }
        });
        $this->postWorkspace(['action' => 'reorder_task', 'task_id' => $one, 'target_task_id' => $two])->assertStatus(500)
            ->assertExactJson(['success' => false, 'error' => 'Не удалось загрузить рабочее пространство.']);
        $this->assertSame($before, $this->state());
    }

    public function test_inconsistent_legacy_task_cannot_modify_a_foreign_list(): void
    {
        $foreignList = $this->list($this->other->id, $this->foreignBoard);
        $task = $this->task($this->user->id, $foreignList, 'Inconsistent legacy row');
        $this->postWorkspace(['action' => 'toggle_task', 'task_id' => $task, 'is_completed' => true])->assertNotFound();
        $this->request()->assertJsonCount(0, 'data.tasks');
    }

    public function test_clearing_a_flag_on_update_preserves_other_references_and_session(): void
    {
        $flag = $this->flag($this->user->id, $this->board, 'Shared');
        $one = $this->list($this->user->id, $this->board, 'One', $flag);
        $two = $this->list($this->user->id, $this->board, 'Two', $flag);
        $sessionId = $this->app['session.store']->getId();
        $token = $this->app['session.store']->token();
        $this->postWorkspace(['action' => 'update_list', 'list_id' => $one, 'name' => 'One', 'flag_id' => null])
            ->assertJsonPath('data.flag', null);
        $this->assertTrue(DB::table('user_flags')->where('id', $flag)->exists());
        $this->postWorkspace(['action' => 'update_list', 'list_id' => $two, 'name' => 'Two'])->assertJsonPath('data.flag', null);
        $this->assertFalse(DB::table('user_flags')->where('id', $flag)->exists());
        $this->assertSame($sessionId, $this->app['session.store']->getId());
        $this->assertSame($token, $this->app['session.store']->token());
    }

    #[DataProvider('transactionFailurePoints')]
    public function test_injected_failures_roll_back_multirecord_operations(string $operation): void
    {
        $flag = $this->flag($this->user->id, $this->board, 'Existing');
        $list = $this->list($this->user->id, $this->board, 'Existing', $flag);
        $this->task($this->user->id, $list, 'Existing');
        $this->board($this->user->id, 'Replacement');
        $before = $this->state();
        DB::listen(function ($query) use ($operation): void {
            $needle = match ($operation) {
                'create_list' => 'insert into "task_lists"',
                'update_list' => 'update "task_lists"',
                'delete_list' => 'delete from "user_flags"',
                'delete_board' => 'update "boards"',
            };
            if (str_starts_with($query->sql, $needle)) {
                throw new RuntimeException('Private operation failure');
            }
        });
        $response = match ($operation) {
            'create_list' => $this->postWorkspace(['action' => 'create_list', 'board_id' => $this->board, 'name' => 'New', 'new_flag_name' => 'New']),
            'update_list' => $this->postWorkspace(['action' => 'update_list', 'list_id' => $list, 'name' => 'New', 'new_flag_name' => 'New']),
            'delete_list' => $this->request('DELETE', query: '?list_id='.$list),
            'delete_board' => $this->request('DELETE', query: '?board_id='.$this->board),
        };
        $response->assertStatus(500)->assertExactJson(['success' => false, 'error' => 'Не удалось загрузить рабочее пространство.']);
        $this->assertSame($before, $this->state());
    }

    public static function transactionFailurePoints(): array
    {
        return [['create_list'], ['update_list'], ['delete_list'], ['delete_board']];
    }

    public function test_database_errors_are_json_without_sql_or_submitted_values(): void
    {
        $list = $this->list($this->user->id, $this->board);
        $before = $this->state();
        DB::listen(function ($query): void {
            if (str_starts_with($query->sql, 'insert into "tasks"')) {
                throw new QueryException('pgsql', $query->sql, $query->bindings, new RuntimeException('Private database failure'));
            }
        });
        $this->postWorkspace(['action' => 'create_task', 'list_id' => $list, 'title' => 'Private title'])
            ->assertStatus(500)->assertExactJson(['success' => false, 'error' => 'Не удалось сохранить изменения. Попробуйте позже.']);
        $this->assertSame($before, $this->state());
    }

    public function test_get_does_not_accept_body_board_or_search_and_post_ignores_query_fields(): void
    {
        $second = $this->board($this->user->id, 'Second');
        $this->request(body: ['board_id' => $second, 'search' => 'Second'])->assertJsonPath('data.board.id', $this->board);
        $this->request('POST', query: '?board_id='.$second.'&name=Injected', body: ['action' => 'create_list'])
            ->assertUnprocessable()->assertJsonPath('error', 'Введите название списка.');
    }

    private function postWorkspace(array $body): TestResponse
    {
        return $this->request('POST', body: $body);
    }

    private function request(string $method = 'GET', array $body = [], string $query = '', ?string $raw = null,
        bool $token = true, string $contentType = 'application/json'): TestResponse
    {
        $this->withCredentials()->withCookie(config('session.cookie'), $this->app['session.store']->getId());
        Auth::forgetGuards();
        $server = ['CONTENT_TYPE' => $contentType, 'HTTP_SEC_FETCH_SITE' => 'same-origin'];
        if ($token) {
            $server['HTTP_X_CSRF_TOKEN'] = $this->app['session.store']->token();
        }

        return $this->call($method, '/api/workspace.php'.$query, [], $this->prepareCookiesForRequest(), [], $server,
            $raw ?? json_encode($body, JSON_UNESCAPED_UNICODE));
    }

    private function board(int $user, string $name, bool $default = false): int
    {
        return DB::table('boards')->insertGetId(['user_id' => $user, 'name' => $name, 'is_default' => $default]);
    }

    private function list(int $user, int $board, string $name = 'List', ?int $flag = null): int
    {
        return DB::table('task_lists')->insertGetId(['user_id' => $user, 'board_id' => $board, 'name' => $name, 'flag_id' => $flag]);
    }

    private function flag(int $user, int $board, string $name): int
    {
        return DB::table('user_flags')->insertGetId(['user_id' => $user, 'board_id' => $board, 'name' => $name]);
    }

    private function task(int $user, int $list, string $title, int $order = 0): int
    {
        return DB::table('tasks')->insertGetId(['user_id' => $user, 'list_id' => $list, 'title' => $title, 'sort_order' => $order]);
    }

    private function taskOrder(int $list): array
    {
        return DB::table('tasks')->where('list_id', $list)->orderBy('sort_order')->orderBy('id')->pluck('id')->all();
    }

    private function state(): array
    {
        $state = [];
        foreach (['boards', 'task_lists', 'user_flags', 'tasks'] as $table) {
            $state[$table] = DB::table($table)->orderBy('id')->get()->toJson();
        }

        return $state;
    }
}
