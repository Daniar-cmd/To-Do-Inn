import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../src/js/api.js', import.meta.url), 'utf8');

async function freshApi() {
  // Load the browser ES module without changing the project's CommonJS Gulp configuration.
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
}

function response(token) {
  return new Response(JSON.stringify({ success: true, data: { csrf_token: token, user: null } }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

test('simultaneous initial session reads share one request and token, but later reads refresh', async (t) => {
  let finish;
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/auth.php');
    assert.equal(options.credentials, 'same-origin');
    count++;
    if (count === 1) return new Promise((resolve) => { finish = resolve; });
    return response('rotated-token');
  });
  const api = await freshApi();
  const first = api.getSession();
  const second = api.getSession();
  assert.equal(first, second);
  assert.equal(count, 1);
  finish(response('initial-token'));
  const values = await Promise.all([first, second]);
  assert.equal(values[0].csrf_token, 'initial-token');
  assert.equal(values[1].csrf_token, 'initial-token');
  assert.equal((await api.getSession()).csrf_token, 'rotated-token');
  assert.equal(count, 2);
});

test('a failed session request is shared and does not prevent a retry', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++count === 1) throw new Error('Connection failed');
    return response('retry-token');
  });
  const api = await freshApi();
  const first = api.getSession();
  const second = api.getSession();
  const results = await Promise.allSettled([first, second]);
  assert(results.every((result) => result.status === 'rejected'));
  assert.equal(count, 1);
  assert.equal((await api.getSession()).csrf_token, 'retry-token');
});

test('JSON API errors release the pending session request too', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => ++count === 1
    ? new Response(JSON.stringify({ success: false, error: 'Unavailable' }), { status: 503 })
    : response('recovered-token'));
  const api = await freshApi();
  await assert.rejects(api.getSession(), /Unavailable/);
  assert.equal((await api.getSession()).csrf_token, 'recovered-token');
});
