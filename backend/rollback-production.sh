#!/usr/bin/env bash
set -euo pipefail

test "$(id -u)" = 0 || exit 1
backup=$(realpath -- "${1:?Specify the release backup directory}") || exit 1
[[ "$backup" =~ ^/var/backups/todo-inn/release\.[a-zA-Z0-9]+$ ]] || exit 1
test -f "$backup/Caddyfile" && test -f "$backup/admin.cron" || exit 1
caddy validate --config "$backup/Caddyfile" --adapter caddyfile || exit 1
systemctl disable --now todo-inn-repeat.timer
systemctl stop todo-inn-repeat.service
install -m 0644 "$backup/Caddyfile" /etc/caddy/Caddyfile
systemctl reload caddy
crontab -u admin "$backup/admin.cron"
systemctl disable --now todo-inn-api.service
echo 'Laravel routing and scheduling restored. PostgreSQL data was left in place.'
