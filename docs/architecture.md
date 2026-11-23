# Архитектура To Do Inn

Фронтенд использует React, TypeScript, Vite и Gulp. API обслуживает ASP.NET Core на .NET 10. Данные хранятся в PostgreSQL.

## Структура

| Путь | Назначение |
| --- | --- |
| `frontend/` | HTML, React и SCSS. Общие компоненты находятся в `frontend/js/ui/`, каталог дизайна открыт только локально. |
| `backend/Workspace.Api/` | HTTP API, сессии, почта, команды и миграции PostgreSQL. |
| `backend/systemd/` | Сервис API и таймер повторяющихся задач Linux. |
| `public/favicon.svg` | Общий favicon для разработки и выпуска. |
| `dist/` | Собранный фронтенд. |
| `tests/js/` | Тесты React, API-клиента и настроек сборки. |
| `tests/Workspace.Api.LocalSmoke/` | Изолированные HTTP-тесты .NET с временной PostgreSQL. |

## Поток запросов

- В Docker Caddy отдаёт фронтенд на `localhost:5173` и проксирует `/api/*` к Kestrel. Нативный режим использует Vite и `npm run dev:api` на `127.0.0.1:8002`.
- ASP.NET Core обслуживает прежние адреса страниц API, включая `/api/auth.php`, `/api/profile.php` и `/api/workspace.php`. Изменяющие запросы передают CSRF из `GET /api/auth.php` в заголовке `X-CSRF-TOKEN`.
- Workspace API возвращает списки, задачи и заметки с общими флагами. Списки и заметки используют общий порядок карточек. Заметки хранят одно изображение в PostgreSQL.
- Личные аккаунты, организации и роли хранятся в `users`, `corporate_accounts` и `corporate_account_members`. Root организации входит отдельно. Корпоративные доски доступны принятым участникам через личный аккаунт. Досками и приглашениями управляет владелец.

## Окружения и данные

| Режим | Данные |
| --- | --- |
| Локальный Docker | `todo_inn_docker_workspace` в томе PostgreSQL. |
| Нативный запуск | База из `.env.aspnet.dev`. Исходная `todo_inn_laravel_dev` сохранена на хосте. |
| Тесты | Изолированная PostgreSQL, которую создаёт `npm run test:local`. |
| Production | Существующая серверная PostgreSQL. |

Схемой управляют встроенные миграции в `backend/Workspace.Api/Migrations/`. Сохранённый baseline описывает принятую схему и её историю. Смена бэкенда требует нового входа. Секреты, ключи сессий и резервные копии хранятся вне Git.

## Сборка и публикация

Gulp пишет CSS в `frontend/css/`. Затем Vite собирает страницы и ассеты в `dist/`. Сборка не перезаписывает `public/`. Каталог дизайна не входит в production-сборку.

На VPS Caddy отдаёт `/opt/todo-inn/current/dist` и направляет API в Kestrel на loopback. API и повторяющиеся задачи запускаются через systemd. Старый релиз сохранён на VPS для отката. История перехода описана в [плане миграции](csharp-aspnet-migration.md).

Для проверки запускайте `npm run typecheck`, `npm run test:frontend`, `npm run test:local` и `npm run build`.
