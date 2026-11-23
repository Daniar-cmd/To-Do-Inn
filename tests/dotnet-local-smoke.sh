#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

umask 077
scratch=$(mktemp -d "${TMPDIR:-/tmp}/todo-inn-dotnet.XXXXXX")
api_pid=
vite_pid=
stop_api() {
    if [[ -n "$api_pid" ]]; then
        kill "$api_pid" 2>/dev/null || true
        wait "$api_pid" 2>/dev/null || true
        api_pid=
    fi
}
cleanup() {
    if [[ -n "$vite_pid" ]]; then
        kill "$vite_pid" 2>/dev/null || true
        wait "$vite_pid" 2>/dev/null || true
    fi
    stop_api
    pg_ctl -D "$scratch/pg" -m fast -w stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

export PGHOST=127.0.0.1 PGPORT=55457 PGDATABASE=todo_inn_dotnet_smoke PGUSER
PGUSER=$(id -un)
unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS
initdb -D "$scratch/pg" -A trust --no-locale --encoding=UTF8 > "$scratch/init.log"
pg_ctl -D "$scratch/pg" -l "$scratch/pg.log" -o "-h $PGHOST -p $PGPORT" -w start >/dev/null
createdb "$PGDATABASE"
export ConnectionStrings__Workspace="Host=$PGHOST;Port=$PGPORT;Database=$PGDATABASE;Username=$PGUSER"
export DOTNET_ENVIRONMENT=Development ASPNETCORE_ENVIRONMENT=Development
export ASPNETCORE_URLS=http://127.0.0.1:58193
export AuthPreview__Enabled=true AuthPreview__AllowLoopbackHttp=true
export AuthPreview__SessionKeyDirectory="$scratch/keys" AuthPreview__UseLocalVerificationCode=true
export Registration__Enabled=true
mkdir "$AuthPreview__SessionKeyDirectory"

dotnet build tests/Workspace.Api.LocalSmoke --nologo
api=backend/Workspace.Api/bin/Debug/net10.0/Workspace.Api.dll
if DOTNET_ENVIRONMENT=Production dotnet "$api" schema:init > "$scratch/production.log" 2>&1; then
    echo 'Initialization unexpectedly ran in Production.' >&2
    exit 1
fi
rg -q 'available only in Development' "$scratch/production.log"

createdb todo_inn_dotnet_nonempty
psql -X -q -d todo_inn_dotnet_nonempty -c 'CREATE TABLE unrelated (id int); INSERT INTO unrelated VALUES (42)'
if ConnectionStrings__Workspace="Host=$PGHOST;Port=$PGPORT;Database=todo_inn_dotnet_nonempty;Username=$PGUSER" \
    dotnet "$api" schema:init > "$scratch/nonempty.log" 2>&1; then
    echo 'Initialization unexpectedly accepted an unrelated table.' >&2
    exit 1
fi
rg -q 'The public schema is not empty' "$scratch/nonempty.log"
test "$(psql -X -At -d todo_inn_dotnet_nonempty -c 'SELECT id FROM unrelated')" = 42
test "$(psql -X -At -d todo_inn_dotnet_nonempty -c "SELECT to_regclass('public.users') IS NULL")" = t

dotnet "$api" schema:init
if dotnet "$api" schema:migrate > "$scratch/no-baseline.log" 2>&1; then
    echo 'Migrations unexpectedly ran before baseline adoption.' >&2
    exit 1
fi
rg -q 'Record the verified Laravel baseline' "$scratch/no-baseline.log"
psql -X -q -v ON_ERROR_STOP=1 -c 'ALTER TABLE tasks ADD COLUMN smoke_unexpected integer'
if dotnet "$api" schema:baseline --apply > "$scratch/schema-drift.log" 2>&1; then
    echo 'Baseline unexpectedly accepted a changed schema.' >&2
    exit 1
fi
rg -q 'Unexpected: column:tasks.smoke_unexpected' "$scratch/schema-drift.log"
test "$(psql -X -Atc "SELECT to_regclass('public.todo_inn_schema_migrations') IS NULL")" = t
psql -X -q -v ON_ERROR_STOP=1 -c 'ALTER TABLE tasks DROP COLUMN smoke_unexpected'
test "$(psql -X -Atc 'SELECT count(*) FROM public.users')" = 0
psql -X -q -v ON_ERROR_STOP=1 -f tests/Workspace.Api.LocalSmoke/preservation-fixture.sql
workspace_fingerprint() {
    pg_dump --data-only --no-owner --no-acl --exclude-table='public.todo_inn_*' \
        | awk '$1 != "\\restrict" && $1 != "\\unrestrict"' | shasum -a 256
}
before_adoption=$(workspace_fingerprint)
dotnet "$api" schema:baseline --apply
dotnet "$api" schema:migrate
dotnet "$api" schema:migrate
dotnet "$api" diagnostics:check
test "$before_adoption" = "$(workspace_fingerprint)"
if dotnet "$api" schema:init > "$scratch/duplicate.log" 2>&1; then
    echo 'Initialization unexpectedly accepted a populated schema.' >&2
    exit 1
fi
rg -q 'The public schema is not empty' "$scratch/duplicate.log"

export TODO_INN_SMOKE_MAIL="$scratch/mail.jsonl" TODO_INN_SMOKE_SESSION="$scratch/session.json"
export Mail__ResendApiKey=local-smoke-test Mail__FromAddress=sender@example.test
export Mail__FrontendUrl=http://127.0.0.1:5173
start_api() {
    HTTPS_PROXY=http://127.0.0.1:1 https_proxy=http://127.0.0.1:1 NO_PROXY= no_proxy= \
        dotnet tests/Workspace.Api.LocalSmoke/bin/Debug/net10.0/Workspace.Api.LocalSmoke.dll >> "$scratch/api.log" 2>&1 &
    api_pid=$!
    for attempt in {1..30}; do
        kill -0 "$api_pid"
        if curl -fsS --max-time 1 "$ASPNETCORE_URLS/ready" >/dev/null 2>&1; then return; fi
        sleep 0.2
    done
    curl -fsS --max-time 2 "$ASPNETCORE_URLS/ready" >/dev/null
}
start_api

export TODO_INN_SMOKE_ORIGIN=http://127.0.0.1:58194 TODO_INN_SMOKE_VITE_CACHE="$scratch/vite"
node --input-type=module > "$scratch/vite.log" 2>&1 <<'JS' &
import { createServer } from 'vite';

const origin = new URL(process.env.TODO_INN_SMOKE_ORIGIN);
const server = await createServer({
    cacheDir: process.env.TODO_INN_SMOKE_VITE_CACHE,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
        host: origin.hostname, port: Number(origin.port), strictPort: true, hmr: false,
        proxy: { '/api': process.env.ASPNETCORE_URLS },
    },
});
await server.listen();
JS
vite_pid=$!
for attempt in {1..30}; do
    kill -0 "$vite_pid"
    if curl -fsS --max-time 1 "$TODO_INN_SMOKE_ORIGIN/" >/dev/null 2>&1; then break; fi
    sleep 0.2
done
for route in / /pages/workspace.html /pages/register.html /pages/forgot-password.html \
    /pages/registration-success.html /pages/corporate-invitation.html /pages/organization-root.html /favicon.svg; do
    curl -fsS --max-time 2 "$TODO_INN_SMOKE_ORIGIN$route" >/dev/null
done

node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { checkRegistration } from './tests/Workspace.Api.LocalSmoke/registration-checks.mjs';
import { checkWorkspace } from './tests/Workspace.Api.LocalSmoke/workspace-checks.mjs';
import { checkAuthLimits, checkLegacyUpgrade } from './tests/Workspace.Api.LocalSmoke/auth-boundaries.mjs';

const cookies = new Map();
async function request(route, payload, csrf, { jar = cookies, method, contentType = 'application/json', forwardedFor } = {}) {
    const headers = new Headers({ Cookie: [...jar].map(([name, value]) => name + '=' + value).join('; ') });
    if (forwardedFor) headers.set('X-Forwarded-For', forwardedFor);
    if (payload !== undefined) headers.set('Content-Type', contentType);
    if (csrf) headers.set('X-CSRF-Token', csrf);
    const response = await fetch(process.env.TODO_INN_SMOKE_ORIGIN + '/api/' + route, {
        method: method ?? (payload === undefined ? 'GET' : 'POST'), headers,
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
    });
    for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const separator = pair.indexOf('=');
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        if (value) jar.set(name, value);
        else jar.delete(name);
    }
    const body = await response.json();
    return { response, body };
}

async function call(route, status, payload, csrf, options) {
    const { response, body } = await request(route, payload, csrf, options);
    assert.equal(response.status, status, JSON.stringify(body.error ?? route));
    assert.equal(body.success, status < 400);
    if (status === 405) assert.equal(response.headers.get('allow'), 'GET, POST');
    if (status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        assert.ok(retryAfter > 0 && retryAfter <= 60);
    }
    return body.data;
}

const auth = 'auth.php';
const profile = 'profile.php';
const email = 'smoke@example.test';
const username = '@DotnetSmoke';
const password = 'ExamplePass8!';
const guest = await call(auth, 200);
await call(profile, 401, '{');
await call(auth, 200, { action: 'send_verification_code', email }, guest.csrf_token);
await call(auth, 200, { action: 'verify_email_code', email, code: '285868' }, guest.csrf_token);
await call(auth, 201, {
    action: 'register', username, email, first_name: 'Smoke', last_name: 'Test',
    password, confirm_password: password, personal_data_consent: true,
}, guest.csrf_token);
cookies.clear();
const login = await call(auth, 200);
await call(auth, 200, { action: 'login', username, password }, login.csrf_token);
const session = await call(auth, 200);
assert.equal(session.user.username, username);
const initialProfile = (await call(profile, 200)).profile;
assert.deepEqual(Object.keys(initialProfile).sort(), [
    'about', 'account_type', 'avatar', 'email', 'github_url', 'id', 'preferred_theme', 'secondary_email',
    'telegram_url', 'username', 'username_change_available_at', 'username_changed_at',
]);
const { lists } = await call('workspace.php', 200);
assert.ok(lists.length);
await call('workspace.php', 201, { action: 'create_task', list_id: lists[0].id, title: 'Test recurrence',
    due_date: new Date().toISOString().slice(0, 10), repeat_interval: 'daily' }, session.csrf_token);

const csrf = session.csrf_token;
const profileFields = { username, email };
const save = (status, changes) => call(profile, status, { ...profileFields, ...changes }, csrf);
await call(profile, 405, undefined, undefined, { method: 'PUT' });
await call(profile, 403, '{');
for (const body of ['{', '', '42', 'null']) await call(profile, 400, body, csrf);

const normalized = (await call(profile, 200, JSON.stringify({ username: ' ' + username + ' ', email,
    about: ' Привет 👋 ', preferred_theme: 'dark' }), csrf, { contentType: 'text/plain' })).profile;
assert.equal(normalized.about, 'Привет 👋');
assert.equal(normalized.preferred_theme, 'dark');
assert.equal((await call(auth, 200)).csrf_token, csrf);

for (const changes of [
    { username: '@AnotherUser' }, { email: null }, { email: 'other@example.test' },
    { secondary_email: 'backup@example.test' }, { account_type: 'corporate' },
]) await save(403, { ...changes, about: 'Must be rolled back' });
await save(422, { avatar: 'data:image/png;base64,YQ==', about: 'Must be rolled back' });
await save(422, { about: '👋'.repeat(1201) });
await save(403, { current_password: 'Incorrect8!', new_password: 'AnotherExample8!',
    confirm_password: 'AnotherExample8!', about: 'Must be rolled back' });
assert.deepEqual((await call(profile, 200)).profile, normalized);

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=';
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A5qiiivrD54//2Q==';
const webp = 'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAADwAQCdASoBAAEAAUAmJaACdLoB+AAEgwAA/vAb3/89M15g/yc/+Uq8Fjc3wAAA';
for (const avatar of [png, jpeg, webp]) {
    assert.equal((await save(200, { avatar: avatar.replace(/=+$/, '') })).profile.avatar, avatar);
    assert.equal((await save(200, { about: 'Preserve avatar' })).profile.avatar, avatar);
    assert.equal((await call(profile, 200)).profile.avatar, avatar);
}
await save(422, { avatar: png.replace('image/png', 'image/jpeg') });
assert.equal((await call(profile, 200)).profile.avatar, webp);

const tinyPng = Buffer.from(png.split(',')[1], 'base64');
const pngUri = bytes => 'data:image/png;base64,' + bytes.toString('base64');
function pngChunk(type, bytes) {
    const chunk = Buffer.alloc(bytes.length + 12);
    chunk.writeUInt32BE(bytes.length);
    chunk.write(type, 4);
    bytes.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    return chunk;
}

function pngWithDimensions(width, height) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    return pngUri(Buffer.concat([
        tinyPng.subarray(0, 8), pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(Buffer.alloc(height * (1 + width)))),
        pngChunk('IEND', Buffer.alloc(0)),
    ]));
}

for (const [width, height] of [[2048, 1], [1, 2048]]) {
    const avatar = pngWithDimensions(width, height);
    assert.equal((await save(200, { avatar })).profile.avatar, avatar);
}
for (const [width, height] of [[2049, 1], [1, 2049], [0, 1], [1, 0]]) {
    await save(422, { avatar: pngWithDimensions(width, height) });
}

const text = Buffer.alloc(1_048_576 - tinyPng.length - 12, 'a');
text.write('Comment\0');
const comment = pngChunk('tEXt', text);
const atAvatarLimit = Buffer.concat([tinyPng.subarray(0, -12), comment, tinyPng.subarray(-12)]);
assert.equal(atAvatarLimit.length, 1_048_576);
const largestAvatar = pngUri(atAvatarLimit);
assert.ok((await save(200, { avatar: largestAvatar })).profile.avatar === largestAvatar);
await save(422, { avatar: pngUri(Buffer.concat([atAvatarLimit, Buffer.from([0])])) });
assert.ok((await call(profile, 200)).profile.avatar === largestAvatar);
assert.equal((await save(200, { avatar: null })).profile.avatar, null);

const bodyAtLimit = JSON.stringify(profileFields).padEnd(1_500_000);
await call(profile, 200, bodyAtLimit, csrf);
await call(profile, 413, bodyAtLimit + ' ', csrf);

const otherSession = new Map();
const otherGuest = await call(auth, 200, undefined, undefined, { jar: otherSession });
await call(auth, 200, { action: 'login', username, password }, otherGuest.csrf_token, { jar: otherSession });
await call(profile, 200, undefined, undefined, { jar: otherSession });

const newPassword = 'a'.repeat(127) + '1';
const updated = await save(200, { current_password: password, new_password: newPassword, confirm_password: newPassword });
assert.equal(updated.signed_out, true);
await call(profile, 401);
await call(profile, 401, undefined, undefined, { jar: otherSession });
const nextGuest = await call(auth, 200);
assert.notEqual(nextGuest.csrf_token, csrf);
await call(auth, 401, { action: 'login', username, password }, nextGuest.csrf_token);
await call(auth, 401, { action: 'login', username, password: newPassword.slice(0, -1) + '2' }, nextGuest.csrf_token);
await call(auth, 200, { action: 'login', username, password: newPassword }, nextGuest.csrf_token);
assert.equal((await call(profile, 200)).profile.username, username);
console.log('Profile validation, avatar, request boundaries and cross-session password revocation verified.');

const finalCsrf = (await call(auth, 200)).csrf_token;
function expireLimits() {
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-qc',
        "UPDATE public.todo_inn_auth_rate_limits SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'"]);
}

expireLimits();
for (let request = 0; request < 60; request++) await call(profile, 200);
await call(profile, 429);

expireLimits();
for (let request = 0; request < 30; request++) {
    await call(profile, 200, profileFields, finalCsrf, { forwardedFor: '203.0.113.' + (request + 1) });
}
await call(profile, 429, profileFields, finalCsrf, { forwardedFor: '203.0.113.100' });
await call(profile, 200);

const wrongPassword = {
    ...profileFields, current_password: 'WrongPassword8!', new_password: 'DifferentPassword8!',
    confirm_password: 'DifferentPassword8!', about: 'Must not change',
};
expireLimits();
for (let request = 0; request < 5; request++) {
    await call(profile, 403, wrongPassword, finalCsrf, { forwardedFor: '203.0.113.' + (request + 1) });
}
await call(profile, 429, wrongPassword, finalCsrf, { forwardedFor: '203.0.113.100' });
const beforeRetry = (await call(profile, 200)).profile;
expireLimits();
await call(profile, 403, wrongPassword, finalCsrf);
assert.deepEqual((await call(profile, 200)).profile, beforeRetry);
console.log('Profile read, write and password limits, Retry-After and expiration verified.');

const sql = statement => execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atc', statement], { encoding: 'utf8' }).trim();
const bcryptHash = '$2y$04$6eEgCvvRo0MbLeXvVALT/e3s3UalydUfLemIQqXyNoBcn7zSzOGaG';
const migratedClient = { jar: new Map() };
const migratedGuest = await call(auth, 200, undefined, undefined, migratedClient);
const migratedLogin = await call(auth, 200, { action: 'login', username: '@PreservedUser', password: 'LegacySmoke8!' },
    migratedGuest.csrf_token, migratedClient);
assert.equal(migratedLogin.user.username, '@PreservedUser');
const migratedProfile = (await call(profile, 200, undefined, undefined, migratedClient)).profile;
assert.equal(migratedProfile.about, 'Данные до миграции');
assert.equal(migratedProfile.avatar, png);
const migratedWorkspace = await call('workspace.php', 200, undefined, undefined, migratedClient);
assert.equal(migratedWorkspace.board.name, 'Старая доска');
assert.equal(migratedWorkspace.lists[0].sort_order, 17);
assert.deepEqual(migratedWorkspace.tasks.map(task => task.title), ['Первая по порядку', 'Старая задача']);
assert.equal(migratedWorkspace.tasks[1].description, 'Сохранить содержимое');
assert.equal(migratedWorkspace.tasks[1].is_completed, true);
const migratedNote = migratedWorkspace.notes[0];
assert.equal(migratedNote.body, 'Текст 📝\nВторая строка');
assert.equal(migratedNote.image.offset, 8);
const migratedImage = await fetch(process.env.TODO_INN_SMOKE_ORIGIN + migratedNote.image.url, {
    signal: AbortSignal.timeout(5000),
    headers: { Cookie: [...migratedClient.jar].map(([name, value]) => name + '=' + value).join('; ') },
});
assert.equal(migratedImage.status, 200);
assert.deepEqual(Buffer.from(await migratedImage.arrayBuffer()), Buffer.from(png.split(',')[1], 'base64'));
assert.equal(sql("SELECT password_hash FROM users WHERE username = '@PreservedUser'"), bcryptHash);
console.log('Existing password, profile, tasks, note and image survived adoption and remained readable.');
await checkLegacyUpgrade({ call, sql, expireLimits, options: migratedClient,
    priorProfile: migratedProfile, priorWorkspace: migratedWorkspace });
sql("INSERT INTO corporate_accounts (root_username, root_email, root_password_hash, organization_name) "
    + "VALUES ('@SmokeOrg', 'smoke@example.test', '" + bcryptHash + "', 'Smoke Organisation')");

const activeCookies = new Map(cookies);
const authClient = new Map();
const guestToken = (await call(auth, 200, undefined, undefined, { jar: authClient })).csrf_token;
const authOptions = { jar: authClient };
const authAction = (status, action, fields = {}, token = guestToken) =>
    call(auth, status, { action, ...fields }, token, authOptions);
for (const fields of [{}, { username, password: true }, { username: [], password }, { username, password: '' }]) {
    await authAction(422, 'login', fields);
}
await call(auth + '?username=FromQuery&password=FromQuery', 422, { action: 'login' }, guestToken, authOptions);

for (const credentials of [
    { username, password: 'WrongPassword8!' }, { username: '@Nobody', password },
    { username: ' ' + username, password: newPassword }, { username, password: newPassword + ' ' },
]) {
    const { response, body } = await request(auth, { action: 'login', ...credentials }, guestToken, authOptions);
    assert.equal(response.status, 401);
    assert.deepEqual(body, { success: false, error: 'Неверный логин или пароль.' });
}
assert.deepEqual((await authAction(200, 'login', { username: email, password: 'LegacySmoke8!' })).account_choices,
    ['individual', 'corporate']);
assert.equal((await call(auth, 200, undefined, undefined, authOptions)).user, null);
const corporate = await authAction(200, 'login', { username: email, password: 'LegacySmoke8!', account_type: 'corporate' });
assert.equal(corporate.user, null);
assert.equal(corporate.corporate_account.username, '@SmokeOrg');
assert.equal(sql('SELECT root_password_hash FROM corporate_accounts'), bcryptHash);
await call(profile, 401, undefined, undefined, authOptions);
const corporateToken = (await call(auth, 200, undefined, undefined, authOptions)).csrf_token;
assert.notEqual(corporateToken, guestToken);
await authAction(403, 'logout', {}, guestToken);
const signedOutCookies = new Map(authClient);
assert.deepEqual(await authAction(200, 'logout', {}, corporateToken), { logged_out: true });
assert.equal((await call(auth, 200, undefined, undefined, { jar: signedOutCookies })).corporate_account, null);
const recoveryCsrf = (await call(auth, 200, undefined, undefined, authOptions)).csrf_token;
assert.notEqual(recoveryCsrf, corporateToken);
await authAction(403, 'logout', {}, corporateToken);

const mailbox = process.env.TODO_INN_SMOKE_MAIL;
const readMail = () => readFileSync(mailbox, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const requestReset = address => authAction(200, 'request_password_reset', { email: address }, recoveryCsrf);
await authAction(422, 'request_password_reset', { email: 'invalid' }, recoveryCsrf);
assert.deepEqual(await requestReset('unknown@example.test'), { sent: true });
assert.equal(existsSync(mailbox), false);
assert.deepEqual(await requestReset(email.toUpperCase()), { sent: true });
const firstMail = readMail();
assert.equal(firstMail.length, 1);
assert.deepEqual(firstMail[0].to, [email]);
const tokenFrom = mail => {
    const match = mail.text.match(/\/pages\/forgot-password\.html#token=([a-f0-9]{64})\b/);
    assert.ok(match);
    assert.ok(mail.html.includes(match[0]));
    return match[1];
};
const expiredToken = tokenFrom(firstMail[0]);
const expiredKey = 'preview-password-reset-token:' + createHash('sha256').update(expiredToken).digest('hex');
assert.equal(sql("SELECT count(*) FROM todo_inn_auth_sessions WHERE cache_key = '" + expiredKey + "'"), '1');
assert.equal(sql("SELECT count(*) FROM todo_inn_auth_sessions WHERE cache_key LIKE '%" + expiredToken + "%'"), '0');
sql("UPDATE todo_inn_auth_sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE cache_key = '" + expiredKey + "'");
const recoveredPassword = 'RecoveredSmoke8!';
const resetFields = token => ({ token, password: recoveredPassword, confirm_password: recoveredPassword });
await authAction(422, 'reset_password', resetFields(expiredToken), recoveryCsrf);
expireLimits();

writeFileSync(mailbox + '.fail', '', { mode: 0o600 });
assert.deepEqual(await requestReset(email), { sent: true });
unlinkSync(mailbox + '.fail');
const failedLink = tokenFrom(readMail().at(-1));
await authAction(422, 'reset_password', resetFields(failedLink), recoveryCsrf);
expireLimits();

assert.deepEqual(await requestReset(email), { sent: true });
const resetToken = tokenFrom(readMail().at(-1));
assert.notEqual(resetToken, failedLink);
assert.deepEqual(await authAction(200, 'reset_password', resetFields(resetToken), recoveryCsrf), { reset: true });
await authAction(422, 'reset_password', resetFields(resetToken), recoveryCsrf);
await call(profile, 401, undefined, undefined, { jar: activeCookies });
await authAction(401, 'login', { username, password: newPassword }, recoveryCsrf);
assert.equal((await authAction(200, 'login', { username, password: recoveredPassword }, recoveryCsrf)).user.username, username);
assert.equal(sql("SELECT count(*) FROM todo_inn_auth_sessions WHERE cache_key LIKE 'preview-password-reset-token:%'"), '0');
console.log('Login, corporate account selection, logout and password reset through a local mail stub verified.');
await checkRegistration({ call, request, sql, readMail, expireLimits,
    existingUsername: username, existingEmail: email, existingPassword: recoveredPassword });
await checkWorkspace({ call, request, sql, options: authOptions, expireLimits });
await checkAuthLimits({ call, request, sql, expireLimits });
const persisted = await call(auth, 200, undefined, undefined, authOptions);
writeFileSync(process.env.TODO_INN_SMOKE_SESSION, JSON.stringify({
    cookie: [...authOptions.jar].map(([name, value]) => name + '=' + value).join('; '),
    csrf: persisted.csrf_token, userId: persisted.user.id,
}), { mode: 0o600 });
JS

stop_api
start_api
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';

const file = process.env.TODO_INN_SMOKE_SESSION;
const { cookie, csrf, userId } = JSON.parse(readFileSync(file, 'utf8'));
unlinkSync(file);
const origin = process.env.TODO_INN_SMOKE_ORIGIN + '/api/';
const read = route => fetch(origin + route, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
const session = await read('auth.php');
assert.equal(session.status, 200);
const { data } = await session.json();
assert.equal(data.user.id, userId);
assert.equal(data.csrf_token, csrf);
const profile = await read('profile.php');
assert.equal(profile.status, 200);
assert.equal((await profile.json()).data.profile.id, userId);
const logout = await fetch(origin + 'auth.php', {
    method: 'POST', body: JSON.stringify({ action: 'logout' }), signal: AbortSignal.timeout(5000),
    headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
});
assert.equal(logout.status, 200);
assert.equal((await logout.json()).data.logged_out, true);
assert.equal((await read('profile.php')).status, 401);
console.log('Persisted session and CSRF survived an API restart, then logout revoked the old cookie.');
JS

check_parallel_repeats() {
    dotnet "$api" tasks:repeat > "$scratch/repeat-first.log" 2>&1 &
    local first=$!
    dotnet "$api" tasks:repeat > "$scratch/repeat-second.log" 2>&1 &
    local second=$!
    local failed=0
    wait "$first" || failed=1
    wait "$second" || failed=1
    if [[ "$failed" = 1 ]]; then
        cat "$scratch/repeat-first.log" "$scratch/repeat-second.log"
        return 1
    fi
}

check_parallel_repeats
test "$(psql -X -Atc "SELECT string_agg(repeat_sequence::text, ',' ORDER BY repeat_sequence) FROM tasks WHERE title = 'Test recurrence'")" = '0,1'

psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
WITH source AS (
    SELECT user_id, board_id, list_id FROM tasks WHERE title = 'Test recurrence' AND repeat_sequence = 0
)
INSERT INTO tasks (user_id, board_id, list_id, title, due_date, deadline,
                   repeat_interval, repeat_series_id, repeat_anchor_date, sort_order)
SELECT user_id, board_id, list_id, fixture.title, fixture.due_date, fixture.deadline,
       fixture.interval, gen_random_uuid(), COALESCE(fixture.due_date, fixture.deadline), fixture.sort_order
FROM source CROSS JOIN (VALUES
    ('Smoke monthly', DATE '2024-01-31', NULL, 'monthly', 10),
    ('Smoke leap year', NULL, DATE '2020-02-29', 'yearly', 11),
    ('Smoke weekly', NULL, (now() AT TIME ZONE 'UTC')::date - 1, 'weekly', 12),
    ('Smoke backlog', (now() AT TIME ZONE 'UTC')::date - 400, NULL, 'daily', 13)
) AS fixture(title, due_date, deadline, interval, sort_order);

CREATE FUNCTION smoke_reject_occurrence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Smoke-only recurrence failure'; END; $$;
CREATE TRIGGER smoke_reject_occurrence BEFORE INSERT ON tasks FOR EACH ROW
WHEN (NEW.title = 'Smoke backlog' AND NEW.repeat_sequence = 2) EXECUTE FUNCTION smoke_reject_occurrence();
SQL
if dotnet "$api" tasks:repeat > "$scratch/repeat-rollback.log" 2>&1; then
    echo 'Repeat generation unexpectedly survived an injected database failure.' >&2
    exit 1
fi
rg -q 'Repeat generation failed: PostgresException' "$scratch/repeat-rollback.log"
test "$(psql -X -Atc "SELECT count(*) FROM tasks WHERE title = 'Smoke backlog'")" = 1
psql -X -q -v ON_ERROR_STOP=1 -c 'DROP TRIGGER smoke_reject_occurrence ON tasks; DROP FUNCTION smoke_reject_occurrence()'

dotnet "$api" tasks:repeat
test "$(psql -X -Atc "SELECT count(*), max(repeat_sequence) FROM tasks WHERE title = 'Smoke backlog'")" = '367|366'
test "$(psql -X -Atc "SELECT string_agg(due_date::text, ',' ORDER BY repeat_sequence) FROM tasks WHERE title = 'Smoke monthly' AND repeat_sequence BETWEEN 1 AND 2")" = '2024-02-29,2024-03-31'
test "$(psql -X -Atc "SELECT string_agg(deadline::text, ',' ORDER BY repeat_sequence) FROM tasks WHERE title = 'Smoke leap year' AND repeat_sequence IN (1,4) AND due_date IS NULL")" = '2021-02-28,2024-02-29'
test "$(psql -X -Atc "SELECT deadline = repeat_anchor_date + 7 AND due_date IS NULL FROM tasks WHERE title = 'Smoke weekly' AND repeat_sequence = 1")" = t
check_parallel_repeats
test "$(psql -X -Atc "SELECT count(*), count(DISTINCT repeat_sequence), max(repeat_sequence) FROM tasks WHERE title = 'Smoke backlog'")" = '402|402|401'
echo 'Calendar boundaries, recurrence transaction rollback, backlog cap and competing commands verified.'
test "$(psql -X -Atc "SELECT password_version, password_hash LIKE '\$argon2id\$%', avatar_mime IS NULL AND avatar_data IS NULL FROM users WHERE username = '@DotnetSmoke'")" = '2|t|t'
echo "Clean .NET workspace and recurring tasks verified. Test logs: $scratch"
