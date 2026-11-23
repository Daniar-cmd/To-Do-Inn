import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export async function checkLegacyUpgrade({ call, sql, expireLimits, options, priorProfile, priorWorkspace }) {
    expireLimits();
    const auth = 'auth.php';
    const csrf = (await call(auth, 200, undefined, undefined, options)).csrf_token;
    const act = (status, action, fields = {}) => call(auth, status, { action, ...fields }, csrf, options);
    assert.deepEqual(await act(200, 'legacy_account_status'), { required: true });
    const stale = { jar: new Map() };
    const guest = await call(auth, 200, undefined, undefined, stale);
    await call(auth, 200, { action: 'login', username: priorProfile.username, password: 'LegacySmoke8!' }, guest.csrf_token, stale);
    await call('profile.php', 200, undefined, undefined, stale);

    const userId = priorProfile.id;
    assert.ok(Number.isSafeInteger(userId));
    const fingerprint = () => sql(`SELECT md5(jsonb_build_array(
        (SELECT jsonb_agg(b ORDER BY id) FROM boards b WHERE user_id = ${userId}),
        (SELECT jsonb_agg(l ORDER BY id) FROM task_lists l WHERE user_id = ${userId}),
        (SELECT jsonb_agg(t ORDER BY id) FROM tasks t WHERE user_id = ${userId}),
        (SELECT jsonb_agg(n ORDER BY id) FROM notes n WHERE user_id = ${userId})
    )::text)`);
    const before = fingerprint();
    const createdAt = sql('SELECT created_at FROM users WHERE id = ' + userId);
    const email = 'updated-legacy@example.test';
    const username = '@UpgradedSmoke';
    const password = 'UpgradedSmoke8!';
    const input = {
        username, email, password, confirm_password: password, first_name: 'Анна', last_name: 'Иванова',
        about: priorProfile.about, avatar: priorProfile.avatar, personal_data_consent: true,
    };
    await act(422, 'register', input);
    await act(200, 'send_verification_code', { email });
    await act(200, 'verify_email_code', { email, code: '285868' });
    await act(422, 'register', { ...input, username: priorProfile.username });
    assert.equal(fingerprint(), before);
    const upgraded = await act(200, 'register', input);
    assert.equal(upgraded.upgraded, true);
    assert.equal(upgraded.user.id, userId);
    assert.equal(upgraded.user.username, username);
    assert.equal(fingerprint(), before);
    assert.equal(sql('SELECT created_at FROM users WHERE id = ' + userId), createdAt);
    assert.equal(sql('SELECT registration_version, password_version FROM users WHERE id = ' + userId), '2|1');
    await call('profile.php', 401, undefined, undefined, stale);
    const updated = await call(auth, 200, undefined, undefined, options);
    assert.deepEqual(await call(auth, 200, { action: 'legacy_account_status' }, updated.csrf_token, options), { required: false });
    const profile = (await call('profile.php', 200, undefined, undefined, options)).profile;
    assert.equal(profile.avatar, priorProfile.avatar);
    assert.equal(profile.about, priorProfile.about);
    const workspace = await call('workspace.php', 200, undefined, undefined, options);
    for (const section of ['board', 'lists', 'tasks', 'notes']) assert.deepEqual(workspace[section], priorWorkspace[section]);
    const anonymous = { jar: new Map() };
    const next = await call(auth, 200, undefined, undefined, anonymous);
    await call(auth, 401, { action: 'login', username, password: 'LegacySmoke8!' }, next.csrf_token, anonymous);
    assert.equal((await call(auth, 200, { action: 'login', username, password }, next.csrf_token, anonymous)).user.id, userId);
    console.log('Explicit legacy account upgrade preserved workspace rows and revoked independently issued credentials.');
}

export async function checkAuthLimits({ call, request, sql, expireLimits }) {
    const route = 'auth.php';
    const options = { jar: new Map() };
    const csrf = (await call(route, 200, undefined, undefined, options)).csrf_token;
    const login = username => ({ action: 'login', username, password: 'BadPassword8!' });
    const invalidRegistration = { action: 'register', username: '!' };
    const origin = '127.0.0.1';

    function expireBucket(label) {
        const hash = createHash('sha256').update(label).digest('hex');
        sql("UPDATE todo_inn_auth_rate_limits SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE bucket_key = '" + hash + "'");
    }

    async function limited(body, maxSeconds) {
        const { response, body: payload } = await request(route, body, csrf, options);
        assert.equal(response.status, 429);
        assert.equal(payload.success, false);
        const retryAfter = Number(response.headers.get('retry-after'));
        assert.ok(retryAfter > 0 && retryAfter <= maxSeconds);
        return retryAfter;
    }

    expireLimits();
    for (let attempt = 0; attempt < 5; attempt++) await call(route, 401, login('@RateMissing'), csrf, options);
    const other = { jar: new Map(), forwardedFor: '203.0.113.17' };
    const otherCsrf = (await call(route, 200, undefined, undefined, other)).csrf_token;
    await call(route, 429, login('@RATEMISSING'), otherCsrf, other);
    assert.deepEqual(await call(route, 200, { action: 'logout' }, otherCsrf, other), { logged_out: true });

    expireLimits();
    for (let attempt = 0; attempt < 30; attempt++) await call(route, 401, login('@Missing' + attempt), csrf, options);
    await limited(login('@DifferentName'), 60);

    expireLimits();
    for (let window = 0; window < 4; window++) {
        for (let attempt = 0; attempt < 5; attempt++) await call(route, 422, invalidRegistration, csrf, options);
        if (window === 0) assert.ok(await limited(invalidRegistration, 3600) > 60);
        expireBucket('preview-limit:register-hour:' + origin);
    }
    assert.ok(await limited(invalidRegistration, 86400) > 3600);
    expireBucket('preview-limit:register-day:' + origin);
    await call(route, 422, invalidRegistration, csrf, options);

    expireLimits();
    for (let read = 0; read < 60; read++) await call(route, 200, undefined, undefined, options);
    await limited(undefined, 60);
    expireLimits();
    await call(route, 200, undefined, undefined, options);
    console.log('Auth limits by login, source address, registration hour/day and session reads verified.');
}
