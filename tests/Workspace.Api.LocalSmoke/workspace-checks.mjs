import assert from 'node:assert/strict';

export async function checkWorkspace({ call, request, sql, options, expireLimits }) {
    expireLimits();
    const endpoint = 'workspace.php';
    const csrf = (await call('auth.php', 200, undefined, undefined, options)).csrf_token;
    const post = (status, action, fields) => call(endpoint, status, { action, ...fields }, csrf, options);
    const query = (status, params = '') => call(endpoint + params, status, undefined, undefined, options);
    const remove = (status, params) => call(endpoint + params, status, undefined, csrf, { ...options, method: 'DELETE' });
    const initial = await query(200);
    const initialBoard = initial.boards.find(board => board.corporate_account_id === null).id;
    const sharedBoard = initial.boards.find(board => board.corporate_account_id !== null).id;
    const foreign = { jar: new Map() };
    const guest = await call('auth.php', 200, undefined, undefined, foreign);
    await call('auth.php', 200, { action: 'login', username: '@SmokeOwner', password: 'SignupSmoke8!' }, guest.csrf_token, foreign);
    const foreignCsrf = (await call('auth.php', 200, undefined, undefined, foreign)).csrf_token;
    await call(endpoint + '?board_id=' + initialBoard, 404, undefined, undefined, foreign);
    assert.equal((await call(endpoint + '?board_id=' + sharedBoard, 200, undefined, undefined, foreign)).board.id, sharedBoard);
    const { list: sharedList } = await post(201, 'create_list', { board_id: sharedBoard, name: 'Shared list from manager' });
    assert.ok((await call(endpoint + '?board_id=' + sharedBoard, 200, undefined, undefined, foreign))
        .lists.some(list => list.id === sharedList.id));
    await remove(403, '?board_id=' + sharedBoard);
    await remove(200, '?list_id=' + sharedList.id);
    await call(endpoint, 403, { action: 'create_board', name: 'No CSRF' }, undefined, options);
    await call(endpoint, 413, JSON.stringify({ action: 'create_board', name: 'a'.repeat(8192) }), csrf, options);
    await remove(409, '?board_id=' + initialBoard);

    const { board } = await post(201, 'create_board', { name: '  Smoke Workspace ', description: 'Intro' });
    assert.equal(board.name, 'Smoke Workspace');
    await post(409, 'create_board', { name: board.name });
    assert.equal((await post(200, 'update_board', { board_id: board.id, name: 'Updated workspace', board_type: 'community' })).board.name,
        'Updated workspace');

    const { list: source } = await post(201, 'create_list', { board_id: board.id, name: 'QA_ exact', new_flag_name: 'Smoke source flag' });
    const { list: target } = await post(201, 'create_list', { board_id: board.id, name: 'QA alternate' });
    assert.ok(source.flag.id);
    await post(409, 'create_list', { board_id: board.id, name: source.name, new_flag_name: 'Must roll back' });
    assert.equal(sql("SELECT count(*) FROM user_flags WHERE name = 'Must roll back'"), '0');
    await call(endpoint, 404, { action: 'create_task', list_id: source.id, title: 'Foreign' }, foreignCsrf, foreign);

    const dueDate = new Date().toISOString().slice(0, 10);
    await post(200, 'update_list', { list_id: source.id, name: source.name,
        due_date: dueDate, flag_id: source.flag.id });
    const readSource = async () => (await query(200, '?board_id=' + board.id)).lists.find(list => list.id === source.id);
    assert.equal((await readSource()).due_date, dueDate);
    await post(200, 'update_list', { list_id: source.id, name: source.name,
        description: 'Saved description', flag_id: source.flag.id });
    assert.equal((await readSource()).due_date, dueDate);
    await post(422, 'update_list', { list_id: source.id, name: source.name, due_date: '2000-01-01' });
    const { flag } = await post(201, 'create_flag', { board_id: board.id, name: 'Standalone flag' });
    const { task: recurring } = await post(201, 'create_task', { list_id: source.id, title: 'Metadata check',
        location: 'Office', scheduled_time: '10:05', urgency: 2, is_important: true,
        due_date: dueDate, repeat_interval: 'weekly', flag_id: flag.id });
    assert.equal(recurring.flag.id, flag.id);
    assert.equal(recurring.repeat_interval, 'weekly');
    assert.equal(recurring.scheduled_time, '10:05:00');
    await post(422, 'create_task', { list_id: source.id, title: 'Time needs location', scheduled_time: '12:00' });
    await post(409, 'delete_task', { task_id: recurring.id });
    await post(200, 'toggle_task', { task_id: recurring.id, is_completed: true });
    await post(409, 'delete_task', { task_id: recurring.id });
    await post(200, 'stop_task_repeat', { task_id: recurring.id });
    await post(200, 'delete_task', { task_id: recurring.id });

    const createTask = (list_id, title) => post(201, 'create_task', { list_id, title });
    const parallel = await Promise.all(Array.from({ length: 12 }, (_, index) => createTask(target.id, 'Concurrent task ' + index)));
    assert.equal(new Set(parallel.map(({ task }) => task.id)).size, parallel.length);
    assert.equal(sql('SELECT count(*), count(DISTINCT sort_order) FROM tasks WHERE list_id = ' + target.id), '12|12');
    const { task: first } = await createTask(source.id, 'First movable');
    const { task: second } = await createTask(source.id, 'Second movable');
    const { task: destination } = await createTask(target.id, 'At destination');
    await post(404, 'reorder_task', { task_id: first.id, target_task_id: destination.id });
    await post(200, 'reorder_task', { task_id: first.id, target_task_id: second.id });
    const move = { task_id: first.id, target_list_id: target.id, target_task_id: destination.id };
    const taskOrder = () => sql('SELECT id, list_id, sort_order FROM tasks WHERE board_id = ' + board.id + ' ORDER BY id');
    const beforeMove = taskOrder();
    sql(`CREATE FUNCTION smoke_reject_move() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Private smoke database failure'; END; $$;
        CREATE CONSTRAINT TRIGGER smoke_reject_move AFTER UPDATE ON tasks
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.list_id IS DISTINCT FROM NEW.list_id)
        EXECUTE FUNCTION smoke_reject_move()`);
    try {
        const denied = await request(endpoint, { action: 'move_task', ...move }, csrf, options);
        assert.equal(denied.response.status, 503);
        assert.deepEqual(denied.body, { success: false, error: 'Сервис задач временно недоступен.' });
        assert.equal(taskOrder(), beforeMove);
    } finally {
        sql('DROP TRIGGER smoke_reject_move ON tasks; DROP FUNCTION smoke_reject_move()');
    }
    await post(200, 'move_task', move);
    await post(200, 'update_task', { task_id: first.id, title: 'Moved and edited' });
    await post(200, 'toggle_task', { task_id: first.id, is_completed: true });
    const workspace = await query(200, '?board_id=' + board.id);
    const moved = workspace.tasks.find(task => task.id === first.id);
    assert.equal(moved.list_id, target.id);
    assert.equal(moved.is_completed, true);
    assert.equal(moved.title, 'Moved and edited');
    const search = await query(200, '?search=' + encodeURIComponent('QA_'));
    assert.ok(search.results.some(result => result.tasks.some(task => task.id === second.id)));
    assert.ok(!search.results.some(result => result.tasks.some(task => task.id === destination.id)));
    await post(200, 'delete_task', { task_id: first.id });

    const { note } = await post(201, 'create_note', { board_id: board.id, title: 'Smoke note', body: 'a📝' });
    const reorder = { item_type: 'note', item_id: note.id, target_item_type: 'list', target_item_id: target.id, insert_before: true };
    await post(200, 'set_note_pinned', { note_id: note.id, is_pinned: true });
    await post(409, 'reorder_workspace_item', reorder);
    await post(200, 'set_note_pinned', { note_id: note.id, is_pinned: false });
    await post(200, 'reorder_workspace_item', reorder);
    const reordered = await query(200, '?board_id=' + board.id);
    assert.ok(reordered.notes.find(item => item.id === note.id).sort_order < reordered.lists.find(item => item.id === target.id).sort_order);

    const imageUrl = '/api/notes/' + note.id + '/image';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=', 'base64');
    async function image(method, status, jar, token, bytes) {
        const headers = new Headers({ Cookie: [...jar].map(([key, value]) => key + '=' + value).join('; ') });
        if (token) headers.set('X-CSRF-Token', token);
        const body = bytes && new FormData();
        if (body) {
            body.set('image', new Blob([bytes]), 'test.png');
            body.set('offset', '99');
        }
        const response = await fetch(process.env.TODO_INN_SMOKE_ORIGIN + imageUrl, {
            method, headers, body, signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, status);
        return response;
    }
    await image('POST', 403, options.jar, undefined, png);
    await image('GET', 404, foreign.jar);
    await image('POST', 404, foreign.jar, foreignCsrf, png);
    const formats = [
        ['image/jpeg', Buffer.from('ffd8ff', 'hex')],
        ['image/gif', Buffer.from('GIF89a')],
        ['image/webp', Buffer.from('524946461000000057454250696d616765', 'hex')],
        ['image/heic', Buffer.from('00000018667479706865696300000000', 'hex')],
        ['image/avif', Buffer.from('00000018667479706176696600000000', 'hex')],
        ['image/png', png],
    ];
    for (const [mime, bytes] of formats) {
        const upload = await image('POST', 200, options.jar, csrf, bytes);
        assert.deepEqual((await upload.json()).data.image, { url: imageUrl, mime, offset: 3 });
        const download = await image('GET', 200, options.jar);
        assert.equal(download.headers.get('content-type'), mime);
        assert.equal(download.headers.get('content-disposition'), 'inline');
        assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    }
    const maxImage = Buffer.concat([png, Buffer.alloc(1_048_576 - png.length)]);
    await image('POST', 200, options.jar, csrf, maxImage);
    await image('POST', 422, options.jar, csrf, Buffer.concat([maxImage, Buffer.from([0])]));
    assert.equal((await (await image('GET', 200, options.jar)).arrayBuffer()).byteLength, maxImage.length);
    await post(200, 'update_note', { note_id: note.id, title: 'Shorter note', body: '📝' });
    assert.equal((await query(200, '?board_id=' + board.id)).notes.find(item => item.id === note.id).image.offset, 2);
    await image('DELETE', 200, options.jar, csrf);
    await image('GET', 404, options.jar);

    await remove(200, '?list_id=' + source.id);
    assert.equal(sql('SELECT count(*) FROM tasks WHERE id = ' + second.id), '0');
    await remove(200, '?board_id=' + board.id);
    assert.equal(sql('SELECT count(*) FROM notes WHERE id = ' + note.id), '0');
    assert.equal((await query(200, '?board_id=' + initialBoard)).board.id, initialBoard);
    console.log('Workspace access, boards, lists, task ordering, search, notes, image upload and deletion verified.');
}
