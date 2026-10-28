<?php

namespace Tests\Feature;

use App\Http\Controllers\WorkspaceController;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PDOException;
use RuntimeException;
use Tests\DatabaseTestCase;

class DiagnoseWorkspaceTest extends DatabaseTestCase
{
    public function test_it_reads_the_workspace_without_writes_or_private_output(): void
    {
        $user = $this->createUser();
        $board = DB::table('boards')->insertGetId(['user_id' => $user->id, 'name' => 'private-board-title']);
        DB::table('task_lists')->insert(['user_id' => $user->id, 'board_id' => $board, 'name' => 'private-list-title']);
        DB::connection()->enableQueryLog();
        DB::connection()->flushQueryLog();

        $this->assertSame(0, Artisan::call('workspace:diagnose', ['--user-id' => (string) $user->id]));
        $output = Artisan::output();
        $this->assertStringContainsString('OK: workspace читается', $output);
        foreach (['private-board-title', 'private-list-title', $user->username, $user->password_hash] as $private) {
            $this->assertStringNotContainsString($private, $output);
        }
        foreach (DB::getQueryLog() as $query) {
            $this->assertMatchesRegularExpression('/^\s*select\b/i', $query['query']);
        }
        DB::connection()->disableQueryLog();
    }

    public function test_it_can_choose_an_account_without_printing_its_id(): void
    {
        $user = $this->createUser();
        DB::table('boards')->insert(['user_id' => $user->id, 'name' => 'private-board-title']);

        $this->assertSame(0, Artisan::call('workspace:diagnose'));
        $output = Artisan::output();
        $this->assertStringContainsString('OK: workspace читается', $output);
        $this->assertStringNotContainsString('private-board-title', $output);
    }

    public function test_it_identifies_missing_reorder_columns_without_running_migrations(): void
    {
        $order = require database_path('migrations/2026_10_28_000014_add_custom_task_list_order_to_boards.php');
        $pins = require database_path('migrations/2026_10_28_000013_add_task_list_pin_and_order.php');
        $order->down();
        $pins->down();

        $this->assertSame(1, Artisan::call('workspace:diagnose'));
        $output = Artisan::output();
        foreach (['boards.lists_order_customized', 'task_lists.is_pinned', 'task_lists.sort_order'] as $column) {
            $this->assertStringContainsString('НЕТ ПОЛЯ: '.$column, $output);
        }
        $this->assertFalse(Schema::hasColumn('boards', 'lists_order_customized'));
        $this->assertFalse(Schema::hasColumn('task_lists', 'is_pinned'));
    }

    public function test_it_does_not_print_exception_messages_or_traces(): void
    {
        $user = $this->createUser();
        $controller = $this->createMock(WorkspaceController::class);
        $controller->expects($this->once())->method('__invoke')->willThrowException(new RuntimeException('secret-password private-email@example.com SELECT * FROM users'));
        $this->app->instance(WorkspaceController::class, $controller);

        $this->assertSame(1, Artisan::call('workspace:diagnose', ['--user-id' => (string) $user->id]));
        $output = Artisan::output();
        $this->assertStringContainsString('Этап: чтение workspace. Тип ошибки: RuntimeException', $output);
        foreach (['secret-password', 'private-email', 'SELECT *', 'Stack trace'] as $private) {
            $this->assertStringNotContainsString($private, $output);
        }
    }

    public function test_it_reports_an_account_without_boards_as_http_404(): void
    {
        $user = $this->createUser();
        $this->assertSame(1, Artisan::call('workspace:diagnose', ['--user-id' => (string) $user->id]));
        $this->assertStringContainsString('Этап: чтение workspace. HTTP 404', Artisan::output());
    }

    public function test_it_prints_only_the_safe_sqlstate_from_database_errors(): void
    {
        $user = $this->createUser();
        $exception = new PDOException('SQL containing secret-password and private content');
        $exception->errorInfo = ['08006', 7, 'secret-password'];
        $controller = $this->createStub(WorkspaceController::class);
        $controller->method('__invoke')->willThrowException($exception);
        $this->app->instance(WorkspaceController::class, $controller);

        $this->assertSame(1, Artisan::call('workspace:diagnose', ['--user-id' => (string) $user->id]));
        $output = Artisan::output();
        $this->assertStringContainsString('SQLSTATE: 08006', $output);
        $this->assertStringNotContainsString('secret-password', $output);
        $this->assertStringNotContainsString('private content', $output);
    }

    public function test_it_rejects_invalid_ids_without_database_queries(): void
    {
        DB::connection()->enableQueryLog();
        DB::connection()->flushQueryLog();
        $this->assertSame(1, Artisan::call('workspace:diagnose', ['--user-id' => 'password-secret']));
        $this->assertStringNotContainsString('password-secret', Artisan::output());
        $this->assertSame([], DB::getQueryLog());
        DB::connection()->disableQueryLog();
    }
}
