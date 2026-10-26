# Архитектура To Do Inn

Локально приложение работает как **React/Vite → Laravel JSON API → PostgreSQL**. Переключение production на Laravel ещё не выполнено. Документ описывает текущую структуру и её границы; команды установки и правила переноса схемы — в [readme.md](readme.md).

## Структура

```text
frontend/                    Исходники интерфейса; Vite root
  index.html                 / (вход)
  pages/*.html               /pages/register.html, forgot-password.html,
                             registration-success.html, workspace.html
  js/main.jsx                React entry point
  js/App.jsx                 Выбор страницы по URL
  js/api.js                  Fetch, JSON-контракт и CSRF
  js/auth/, js/workspace/     Экраны React
  scss/                      Исходные стили, компилируемые Gulp
  css/                       Генерируемый и игнорируемый Git style.css

app/                         Laravel: контроллеры, middleware, модели,
                             команда принятия схемы и связанные проверки
bootstrap/, config/, routes/ Стандартный запуск и настройка Laravel
database/migrations/         Миграции PostgreSQL; начальный baseline неизменяем
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
dist/                        Готовый frontend, генерируется локально и игнорируется Git
server.php                   Только dev-router для artisan serve
vite.config.mjs, gulpfile.js  Конфигурации сборки
```

Дополнительная папка `legacy/` **пока не введена**: перемещение физических PHP endpoints из `public/` до согласованного production-перехода затруднит сохранённый откат. Это намеренная временная граница, не работающий второй backend. `AGENTS.md` содержит обязательные правила разработки; README — команды запуска и тестирования.

## Поток запросов

1. Vite обслуживает HTML/React на `http://localhost:5173` из `frontend/`. React выбирает экран по прежним URL — отдельного router-пакета нет.
2. `/api/*` Vite проксирует на Laravel `127.0.0.1:8001`. `/favicon.svg` проксируется туда же, поскольку файл остаётся в PHP web-root. Ни браузер, ни Vite не должны обращаться к старому PHP-серверу на `8000` в обычном режиме.
3. `server.php` при `npm run dev:api` направляет любые `/api/*` в `public/index.php` даже при существовании физических `public/api/*.php`. Laravel-маршруты в `routes/web.php` обрабатывают прежние `/api/auth.php`, `/api/profile.php`, `/api/workspace.php`; профиль и workspace требуют Laravel-сессию.
4. Изменяющие запросы передают токен из GET `/api/auth.php` заголовком `X-CSRF-TOKEN`. Начальные параллельные вызовы `getSession()` используют один незавершённый запрос, чтобы не смешать токен с cookie другой сессии; после завершения ответ не кешируется. Все ответы API — JSON с `success` и `data` либо `error`.
5. Данные хранятся в PostgreSQL. Laravel использует Eloquent/Query Builder; legacy PHP использует PDO. Схема и API-поведение не меняются от перестановки папок.

## Окружения и данные

| Режим | Конфигурация | Данные |
| --- | --- | --- |
| Основное локальное приложение | `.env.laravel`, `DB_*`, Laravel на 8001 | Отдельная `todo_inn_laravel_dev` |
| Изолированные тесты | `.env.testing`, Laravel/PHPUnit | Только `todo_inn_laravel_test` |
| Ручной legacy-откат | `.env`, `PG_*`, самостоятельный PHP на 8000 | Исходная legacy-БД |

Сессии Laravel и native PHP не совместимы, после смены режима нужен повторный вход. Изменения данных между `todo_inn_laravel_dev` и исходной legacy-БД автоматически не синхронизируются. `.env*` с реальными ключами, runtime sessions/cache, `vendor/` и `node_modules/` не входят в Git. Baseline и первая миграция после принятия схемы неизменяемы; на пользовательских БД не применяются `schema.sql`, `migrate:fresh`, `migrate:refresh` или `db:wipe`.

## Сборка и публикация

Gulp компилирует только `frontend/scss/style.scss` в игнорируемый `frontend/css/style.css`. Во время разработки стилей запустить `npm run dev:styles`; `npm run build` сначала создаёт CSS, затем Vite собирает все HTML/JS/CSS в игнорируемый `dist/`. Vite не должен чистить или копировать содержимое `public/` автоматически (`publicDir: false`), а Gulp не должен менять `public/css/style.css`.

В production единственным web-root остаётся `public/`. Размещение собранных страниц/assets из `dist/` рядом с `public/index.php` — **отдельный ручной шаг**, здесь не выполненный. Существующий `public/favicon.svg` обслуживается напрямую. Особая осторожность нужна с `public/api/*.php`: конфигурация Caddy/PHP-FPM должна направлять **все** `/api/*` только в `public/index.php`, иначе web-сервер может исполнить оставшийся legacy-код в обход Laravel. `server.php` — только для локального PHP-сервера, не для production. Перед выпуском требуются бэкап, сверка схемы, проверка HTTPS/cookies/CSRF, прав на runtime-папки и согласованный план отката; не копировать локальную dev-БД на VPS.

Для локального отката нужны старый PHP-сервер и proxy Vite **для `/api` и `/favicon.svg`** на `8000`. HTML-исходники теперь находятся в `frontend/`, поэтому перед открытием страниц напрямую на `8000` нужно отдельно разместить собранные HTML/assets из `dist/` в `public/` (не удаляя `index.php`, `api/`, `css/style.css` и `favicon.svg`). Это не автоматический rollback и не перенос данных между БД.

## Проверки при изменении путей

`php composer.phar test`, `npm run test:frontend`, `npm run build`, затем ручная проверка `/`, `/pages/*.html`, `/favicon.svg` и `/api/*` через Vite → Laravel. Проверять, что CSS появился в `frontend/css/`, `dist/` содержит страницы и assets, `public/` не был очищен, а legacy-файлы и исходная БД не были изменены. Не коммитить или удалять чужие незавершённые изменения.
