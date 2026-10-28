<?php

namespace App\Console\Commands;

use App\Http\Controllers\WorkspaceController;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use PDOException;
use Throwable;

class DiagnoseWorkspace extends Command
{
    protected $signature = 'workspace:diagnose {--user-id= : Check a specific user without printing their data}';

    protected $description = 'Read-only workspace check; prints no passwords, SQL, sessions or user content';

    // Columns used by WorkspaceController::read(), including its membership lookup.
    private const COLUMNS = [
        'users' => ['id'],
        'boards' => ['id', 'user_id', 'corporate_account_id', 'name', 'description', 'board_type', 'is_default', 'lists_order_customized'],
        'task_lists' => ['id', 'user_id', 'board_id', 'name', 'description', 'created_at', 'is_important', 'theme', 'is_pinned', 'sort_order', 'flag_id'],
        'user_flags' => ['id', 'user_id', 'board_id', 'name', 'color'],
        'tasks' => ['id', 'user_id', 'list_id', 'title', 'is_completed', 'sort_order'],
        'corporate_accounts' => ['id', 'organization_name'],
        'corporate_account_members' => ['corporate_account_id', 'user_id', 'accepted_at', 'role'],
    ];

    public function handle(): int
    {
        $this->line('Проверка только для чтения. База и настройки не изменяются.');
        $this->line('CLI-конфигурация: '.($this->laravel->configurationIsCached() ? 'кеширована' : 'без кеша'));
        $this->line('Проверяется Laravel из текущего окружения CLI, не маршрутизация Caddy/PHP-FPM.');

        $id = $this->option('user-id');
        if ($id !== null && filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
            $this->error('--user-id должен быть положительным целым числом.');

            return self::FAILURE;
        }

        $step = 'подключение к PostgreSQL';
        try {
            $connection = DB::connection();
            if ($connection->getDriverName() !== 'pgsql') {
                $this->error('Ожидался PostgreSQL. Проверьте DB_CONNECTION текущего окружения.');

                return self::FAILURE;
            }
            $connection->select('SELECT 1');
            $this->info('OK: подключение к PostgreSQL.');

            $step = 'проверка схемы';
            $missing = false;
            foreach (self::COLUMNS as $table => $required) {
                $columns = $connection->getSchemaBuilder()->getColumnListing($table);
                foreach (array_diff($required, $columns) as $column) {
                    $this->error('НЕТ ПОЛЯ: '.$table.'.'.$column);
                    $missing = true;
                }
            }
            if ($missing) {
                $this->error('Код workspace и схема этой БД не совпадают. Миграции автоматически НЕ запускались.');

                return self::FAILURE;
            }
            $this->info('OK: необходимые таблицы и поля существуют.');

            $step = 'выбор аккаунта для проверки';
            // Only IDs are read. Do not load password hashes, avatars or contact details.
            $users = User::query()->select('users.id');
            $user = $id !== null
                ? $users->whereKey((int) $id)->first()
                : $users->whereExists(function ($query): void {
                    $query->selectRaw('1')->from('boards')->whereColumn('boards.user_id', 'users.id');
                })->orderBy('users.id')->first();
            if ($user === null) {
                $this->warn('Чтение workspace не проверено: подходящий аккаунт не найден.');

                return self::FAILURE;
            }

            $step = 'чтение workspace';
            $request = Request::create('/api/workspace.php', 'GET');
            $request->setUserResolver(fn () => $user);
            $response = $this->laravel->make(WorkspaceController::class)($request);
            if ($response->getStatusCode() !== 200) {
                $this->error('Чтение workspace: HTTP '.$response->getStatusCode());

                return self::FAILURE;
            }
            $this->info('OK: workspace читается через Laravel-контроллер.');
            $this->line('Это не проверка сессии браузера или PHP-FPM. Пользовательские данные не выводились.');

            return self::SUCCESS;
        } catch (HttpResponseException $exception) {
            $this->error('Этап: '.$step.'. HTTP '.$exception->getResponse()->getStatusCode());
        } catch (Throwable $exception) {
            $this->error('Этап: '.$step.'. Тип ошибки: '.class_basename($exception));
            // Never print getMessage(): it can contain SQL, bindings or database credentials.
            $cause = $exception;
            do {
                if ($cause instanceof PDOException) {
                    $state = $cause->errorInfo[0] ?? (string) $cause->getCode();
                    if (preg_match('/^[A-Z0-9]{5}$/D', (string) $state)) {
                        $this->line('SQLSTATE: '.$state);
                    }
                    break;
                }
            } while ($cause = $cause->getPrevious());
            $this->line('Место: '.basename($exception->getFile()).':'.$exception->getLine());
        }

        return self::FAILURE;
    }
}
