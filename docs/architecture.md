# Архитектура To Do Inn

Локально приложение работает как **React/Vite → Laravel JSON API → PostgreSQL**. В production Caddy отдаёт собранный React из `dist/`, а запросы `/api/*` направляет в Laravel через `public/index.php`. Документ описывает текущую структуру и её границы; команды установки — в [readme.md](../readme.md).

## Структура

```text
frontend/                    Исходники интерфейса; Vite root
  index.html                 / (вход)
  pages/*.html               /pages/register.html, forgot-password.html,
                              registration-success.html, workspace.html,
                              corporate-invitation.html, organization-root.html
  js/main.tsx                React entry point
  js/App.tsx                 Выбор страницы по URL
  js/api.ts                  Fetch, JSON-контракт и CSRF
  js/auth/                   Экраны входа, регистрации и общие элементы форм
  js/workspace/              Рабочее пространство, карточки списков, заметки и задачи
  js/ui/                     Общие иконки, тексты и варианты тем
  js/design-system/          Локальный каталог компонентов
  scss/workspace/            Стили оболочки, задач, списков и адаптивных экранов
  scss/                      Входные SCSS и стили авторизации
  css/                       Генерируемые и игнорируемые Git файлы CSS

backend/Workspace.Api/      Экспериментальный ASP.NET Core сервис на .NET 10
                             (/health, защищённый bridge, действия с задачами и генерация повторений)

app/                         Laravel: контроллеры, middleware, модели,
                             команда принятия схемы и связанные проверки
bootstrap/, config/, routes/ Стандартный запуск и настройка Laravel
database/migrations/         Миграции PostgreSQL; начальный baseline неизменяем; заметки добавляются отдельной таблицей
database/legacy-baseline.json Эталон существующей схемы (не дамп данных)

public/                      PHP document root, не Vite root
  index.php                  Единственная точка входа Laravel
  favicon.svg                Общая публичная статика (Vite проксирует к Laravel)
  css/style.css              Сохранённый legacy-asset для отката; Gulp его не меняет
  api/*.php                  Сохранённые standalone endpoints для отката;
                             локальный Laravel-router НЕ исполняет их

includes/db.php              Сохранённое PDO-подключение legacy PHP
database/schema.sql          Исторический data-changing legacy SQL;
                             никогда не запускать повторно на существующей БД

tests/Feature/               PHPUnit: API, схема и права доступа
tests/js/                    node:test: настройки сборки и API-клиент
storage/, bootstrap/cache/   Runtime Laravel (данные игнорируются Git)
dist/                        Готовый frontend; ассеты игнорируются Git,
                             HTML-страницы отслеживаются для ручного выпуска
server.php                   Только dev-router для artisan serve
vite.config.ts, gulpfile.ts  Конфигурации сборки
tsconfig.json                Строгая проверка типов приложения, конфигураций и frontend-тестов
```

Дополнительная папка `legacy/` **пока не введена**: физические PHP endpoints оставлены в `public/` для сохранённого отката. Текущая конфигурация Caddy направляет `/api/*` в Laravel. `AGENTS.md` содержит обязательные правила разработки; README — команды запуска и тестирования.

## Поток запросов

1. Vite обслуживает HTML/React на `http://localhost:5173` из `frontend/`. React выбирает экран по прежним URL — отдельного router-пакета нет.
2. `/api/*` Vite проксирует на Laravel `127.0.0.1:8001`. `/favicon.svg` проксируется туда же, поскольку файл остаётся в PHP web-root. Ни браузер, ни Vite не должны обращаться к старому PHP-серверу на `8000` в обычном режиме.
3. `server.php` при `npm run dev:api` направляет любые `/api/*` в `public/index.php` даже при существовании физических `public/api/*.php`. Laravel-маршруты в `routes/web.php` обрабатывают прежние `/api/auth.php`, `/api/profile.php`, `/api/workspace.php`; профиль и workspace требуют Laravel-сессию.
4. Workspace API читает заметки активной доски вместе со списками и поддерживает их создание, редактирование, закрепление и общий порядок карточек. Заметки принадлежат доске и используют общие с другими элементами флаги; карточка показывает дату и время создания, назначаемого срока у заметки нет.
5. Изменяющие запросы передают токен из GET `/api/auth.php` заголовком `X-CSRF-TOKEN`. Начальные параллельные вызовы `getSession()` используют один незавершённый запрос, чтобы не смешать токен с cookie другой сессии; после завершения ответ не кешируется. Все ответы API — JSON с `success` и `data` либо `error`.
6. Данные хранятся в PostgreSQL. Laravel использует Eloquent/Query Builder; legacy PHP использует PDO. Организация/root-аккаунт хранится отдельно в `corporate_accounts`, личные пользователи — в `users`, а приглашения и принятые роли — в `corporate_account_members`. Дополнительные сведения профиля, предпочтительная тема и версии сохранённых согласий привязаны к соответствующему пользователю или организации. Root входит отдельно; корпоративные доски доступны участникам через личный вход, а управлять досками и приглашениями может только owner. Роли `admin`, `manager`, `support` пока не дают дополнительных ограничений на обычные действия в досках. Схема и API-поведение не меняются от перестановки папок.

## Окружения и данные

| Режим | Конфигурация | Данные |
| --- | --- | --- |
| Основное локальное приложение | `.env.laravel`, `DB_*`, Laravel на 8001 | Отдельная `todo_inn_laravel_dev` |
| Изолированные тесты | `.env.testing`, Laravel/PHPUnit | Только `todo_inn_laravel_test` |
| Ручной legacy-откат | `.env`, `PG_*`, самостоятельный PHP на 8000 | Исходная legacy-БД |

Сессии Laravel и native PHP не совместимы, после смены режима нужен повторный вход. Изменения данных между `todo_inn_laravel_dev` и исходной legacy-БД автоматически не синхронизируются. `.env*` с реальными ключами, runtime sessions/cache, `vendor/` и `node_modules/` не входят в Git. Baseline и первая миграция после принятия схемы неизменяемы; на пользовательских БД не применяются `schema.sql`, `migrate:fresh`, `migrate:refresh` или `db:wipe`.

## Сборка и публикация

Gulp компилирует `frontend/scss/style.scss` и `frontend/scss/design-system.scss` в игнорируемый `frontend/css/`. Во время разработки стилей запустить `npm run dev:styles`; `npm run build` сначала создаёт CSS, затем Vite собирает HTML/JS/CSS в `dist/`. Каталог дизайна остаётся локальным и не входит в production inputs. Vite не должен чистить или копировать содержимое `public/` автоматически (`publicDir: false`), а Gulp не должен менять `public/css/style.css`.

На текущем сервере Caddy отдаёт обычные страницы и ассеты из `/var/www/todo_inn/dist`. Для `/api/*` он использует `/var/www/todo_inn/public/index.php` через PHP-FPM; физические `public/api/*.php` остаются только для отката. `public/favicon.svg` хранится отдельно; при изменении маршрутов нужно проверить его доступность. `server.php` — только для локального PHP-сервера. Перед будущим выпуском нужно сохранять предыдущий `dist/`, собирать frontend локально и проверять страницы, ассеты и API после загрузки. Базы данных и production-конфигурацию нельзя менять попутно с организацией frontend-файлов.

Для локального отката нужны старый PHP-сервер и proxy Vite **для `/api` и `/favicon.svg`** на `8000`. HTML-исходники теперь находятся в `frontend/`, поэтому перед открытием страниц напрямую на `8000` нужно отдельно разместить собранные HTML/assets из `dist/` в `public/` (не удаляя `index.php`, `api/`, `css/style.css` и `favicon.svg`). Это не автоматический rollback и не перенос данных между БД.

## Целевая полиглотная архитектура

Авторизация, профиль и пользовательская сессия остаются на Laravel. Рабочее пространство (доски, списки, заметки, задачи, флаги и поиск) постепенно переходит на ASP.NET Core .NET 10 LTS. PostgreSQL и существующие таблицы общие; Laravel сохраняет роль публичного gateway для сессии/CSRF и передаёт подтверждённый `user_id` внутреннему сервису. На ранних ступенях React API и production-маршрутизация остаются без изменений.

Трёхступенчатый порядок переноса, ограничения доступа к БД, межсервисный контракт и критерии готовности описаны в [csharp-aspnet-migration.md](csharp-aspnet-migration.md). Все семь действий с задачами (`create_task`, `toggle_task`, `update_task`, `move_task`, `reorder_task`, `delete_task`, `stop_task_repeat`) реализованы в .NET за отдельными локальными флагами, выключенными по умолчанию. Laravel по-прежнему планирует фоновую команду `tasks:repeat`; при отдельном выключенном по умолчанию флаге расчёт дат и вставку следующих экземпляров выполняет .NET. Текущий обычный запуск по-прежнему React/Vite → Laravel → PostgreSQL.

Контракт всех семи действий и генератора проверен через реальный локальный Laravel HTTP API с сессией и CSRF на отдельной `todo_inn_aspnet_test`, включая конкурентные остановку, перенос и удаление. Это подтверждает готовность к локальному cutover, но само обычное локальное окружение и production этим тестом не переключены.

## Проверки при изменении путей

`php composer.phar test`, `npm run test:frontend`, `npm run build`, затем ручная проверка `/`, `/pages/*.html`, `/favicon.svg` и `/api/*` через Vite → Laravel. Проверять, что CSS появился в `frontend/css/`, `dist/` содержит страницы и assets, `public/` не был очищен, а legacy-файлы и исходная БД не были изменены. Не коммитить или удалять чужие незавершённые изменения.
