# To Do Inn!

Учебное веб-приложение для управления задачами на React, TypeScript и PostgreSQL. Локальное приложение и production используют ASP.NET Core на .NET 10.

## Текущий технологический стек

| Область | Технологии |
| --- | --- |
| Разметка и стили | HTML5, SCSS (Sass) |
| Интерфейс | React 19, TypeScript/TSX, Fetch API |
| Frontend-сборка | Vite 6 |
| Обработка стилей | Gulp 5, Dart Sass |
| Локальная frontend-среда | Node.ts 20.19+, npm |
| Локальный backend | ASP.NET Core на .NET 10, Npgsql, JSON HTTP API |
| PHP для отката | PHP 8.5, Laravel 13, Composer 2 |
| Тестовые базы | отдельные PostgreSQL БД для .NET и PHPUnit |
| База данных | PostgreSQL |
| Production-сервер | Debian 13, Caddy, Kestrel, systemd, HTTPS |

Production-сборка frontend создаётся локально в `dist/`. Node.ts, npm, Vite и Gulp на production-сервере не требуются. PHP обслуживает API, PostgreSQL — хранение данных.

## Библиотека дизайна

[Локальный каталог](http://localhost:5173/pages/design-system.html) — готовые элементы, иконки, состояния и анимации. [Правила использования](docs/design-system.md). Открывается при `npm run dev`; стили обновляет `npm run dev:styles`. Каталог не использует API и не входит в production-сборку.

## Локальный запуск

1. Установите .NET 10 SDK, PostgreSQL и Node.js 20.19+.
2. Перед установкой frontend-зависимостей проверьте `node -v`. При необходимости выберите установленный Homebrew Node.js перед `npm ci`.

   ```sh
   export PATH="/opt/homebrew/bin:$PATH"
   node -v
   npm ci
   npm run build
   ```

   Если `node -v` уже показывает 20.19+ в другом окружении, изменять `PATH` не нужно. Предупреждения `EBADENGINE` означают, что команда запущена со старым Node; не меняйте lock-файл ради их устранения.

3. Создайте `.env.aspnet.dev` по образцу `.env.aspnet.dev.example` с подключением к существующей локальной `todo_inn_laravel_dev`. Для этой рабочей копии настройка и миграции уже выполнены. При первом принятии схемы проверьте резервную копию и запустите миграции вручную.

   ```sh
   npm run dev:api -- schema:baseline
   npm run dev:api -- schema:baseline --apply
   npm run dev:api -- schema:migrate
   ```

   Для новой пустой локальной PostgreSQL сначала создайте базу, укажите её в `.env.aspnet.dev` и выполните `npm run dev:api -- schema:init`. Затем выполните команды выше. PHP и Composer для нового окружения не нужны.

4. Запустите API ASP.NET Core и Vite в двух терминалах.

   ```sh
   npm run dev:api
   ```

   ```sh
   npm run dev
   ```

   Откройте <http://localhost:5173>. Vite обслуживает фронтенд и favicon, а `/api` проксирует на ASP.NET Core `127.0.0.1:8002`. Войдите заново, чтобы получить .NET-сессию. Готовность базы проверяет <http://127.0.0.1:8002/ready>.

    Для новых терминалов повторите `export PATH="/opt/homebrew/bin:$PATH"` перед `npm run dev`, `npm run dev:styles` или тестами; настройки системного окружения эта инструкция не меняет.

Для разработки SCSS используйте `npm run dev:styles` в третьем терминале. Gulp пишет скомпилированный CSS в `frontend/css/`; `npm run build` затем собирает HTML/React/CSS в `dist/`. На production Caddy отдаёт страницы из активного релиза и направляет `/api/*` в ASP.NET Core. Сборка не перезаписывает `public/`. Границы каталогов описаны в [architecture.md](docs/architecture.md).

Frontend, конфигурации Vite/Gulp и frontend-тесты переведены на TypeScript: компоненты используют `.tsx`, модули и конфигурации — `.ts`, тесты Node — `.mts`. `npm run typecheck` проверяет приложение, конфигурации и frontend-тесты в строгом режиме (`strict: true`); `npm run test:frontend` запускает тесты через `tsx`. HTML-адреса и API не менялись.

## Локальный Docker

Установите и запустите [Docker Desktop для Mac](https://docs.docker.com/desktop/setup/install/mac-install/). Для Apple Silicon выберите соответствующий установщик. Проверьте запуск через `docker version` и `docker compose version`.

Для уже перенесённой базы запустите приложение командой `docker compose --env-file /dev/null -f compose.local.yaml up -d`. Команды ниже нужны только при первоначальной подготовке пустого тома.

```sh
docker compose --env-file /dev/null -f compose.local.yaml run --rm --build api schema:init
docker compose --env-file /dev/null -f compose.local.yaml run --rm api schema:baseline --apply
docker compose --env-file /dev/null -f compose.local.yaml run --rm api schema:migrate
docker compose --env-file /dev/null -f compose.local.yaml up -d --build
```

Приложение доступно на <http://localhost:5173>. Caddy отдаёт собранный фронтенд и проксирует API в ASP.NET Core. После изменений кода пересоберите образы через `up -d --build`. Для ручного запуска Vite сначала освободите порт, остановив Docker-проект.

Контейнерная `todo_inn_docker_workspace` находится в томе `postgres`, а ключи сессий — в томе `session-keys`. В этой рабочей копии данные перенесены из `todo_inn_laravel_dev`, исходник сохранён на хосте. Хеши паролей перенесены вместе с аккаунтами. После переключения требуется повторный вход. Для остановки используйте `docker compose --env-file /dev/null -f compose.local.yaml down`. Флаг `-v` удаляет тома вместе с данными. [Документация PostgreSQL Docker Image](https://hub.docker.com/_/postgres).

Регистрация по умолчанию закрыта. Для тестового аккаунта выполните `TODO_INN_DOCKER_REGISTRATION=true docker compose --env-file /dev/null -f compose.local.yaml up -d`. Форма показывает локальный код подтверждения. После регистрации запустите ту же команду без переменной, чтобы снова закрыть регистрацию.

## Локальная проверка

`npm run test:local` запускает изолированные PostgreSQL, ASP.NET Core и Vite на loopback. Прогон проверяет существующие URL страниц, сохранение данных при миграции, вход, профиль, приглашения, рабочее пространство и повторяющиеся задачи. Для него нужны утилиты PostgreSQL в `PATH`. Рабочая база и настройки из `.env.aspnet.dev` в прогоне не используются.

## Авторизация

Вход, регистрация и восстановление пароля используют `/api/auth.php`. Профиль обслуживает `/api/profile.php`. Обработчики находятся в `backend/Workspace.Api/`. Доступность регистрации зависит от конфигурации выпуска. Изменение логина, адресов почты и типа аккаунта через профиль заблокировано. Смена пароля требует текущий пароль и завершает все сеансы. Аватар хранится в PostgreSQL, изменяющие запросы защищены CSRF.

Схему рабочего пространства создаёт `schema:init`, существующую схему принимает `schema:baseline`. Доски, списки, заметки, флаги и задачи хранятся в PostgreSQL. Права на корпоративные доски определяются членством и ролью. См. [корпоративные аккаунты](docs/corporate-accounts.md).

Повторение задач (ежедневно, еженедельно, ежемесячно, ежегодно) использует дату **или** дедлайн, но не оба сразу. Следующий экземпляр появляется при наступлении даты предыдущего, независимо от выполнения; остальные свойства копируются, завершённость — нет. Для месяцев без исходного числа выбирается последний день месяца (31 января → 28 февраля → 31 марта), для 29 февраля в невисокосном году — 28 февраля. Старые задачи, у которых уже были и дата, и дедлайн, не изменяются миграцией. Повторение можно остановить из самой задачи; созданные экземпляры останутся.

Локальные миграции .NET запускаются вручную. Команда `npm run dev:api -- tasks:repeat` добавляет наступившие повторяющиеся задачи. Для проверки на отдельной временной PostgreSQL с нуля используйте `bash tests/dotnet-local-smoke.sh`.

При изменениях публичного сервера проверяйте HTTPS, ограничения входа, регистрации и общего трафика, резервное копирование и конфигурацию Caddy.

### Диагностика бэкенда

```sh
npm run dev:api -- diagnostics:check
docker compose --env-file /dev/null -f compose.local.yaml exec api dotnet Workspace.Api.dll diagnostics:check
```

Диагностика проверяет подключение и доступность схемы PostgreSQL в выбранном окружении. Настройка нативного запуска берётся из `.env.aspnet.dev`, а Docker работает со своей базой. Обрабатывайте их как отдельные хранилища.

### Сохранённый API-контракт

| Endpoint | Назначение |
| --- | --- |
| `GET, POST /api/auth.php` | Сессия, вход, выход, регистрация, подтверждение почты, восстановление пароля, уведомления и приглашения |
| `GET, POST /api/profile.php` | Чтение и обновление профиля, смена пароля, аватар |
| `GET, POST, DELETE /api/workspace.php` | Доски, списки, заметки, флаги, задачи и поиск |
| `GET, POST, DELETE /api/notes/{noteId}/image` | Чтение, загрузка и удаление вложения |

Все маршруты обслуживает ASP.NET Core. Суффикс `.php` сохранён для совместимости API.

### Production — текущая схема

На сервере Caddy отдаёт страницы и ассеты из `/opt/todo-inn/current/dist`, а `/api/*` проксирует в Kestrel на loopback. API и таймер повторяющихся задач запускаются через systemd. Старый релиз в `/var/www/todo_inn` сохранён для отката. Production PostgreSQL остаётся прежней и отделена от локальных баз.

Для frontend-выпуска соберите `dist/` локально, сохраните предыдущий серверный `dist/`, обновите Git checkout и передайте собранные файлы без очистки `public/`. После выпуска проверьте `/`, `/pages/workspace.html`, новые CSS/JS-ассеты и `/api/auth.php`. Изменения схемы требуют отдельной проверки и резервной копии production-БД; не запускать `schema.sql`, `migrate:fresh`, `migrate:refresh` или `db:wipe` на пользовательских данных.
