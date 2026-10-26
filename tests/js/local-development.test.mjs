import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadConfigFromFile } from 'vite';

test('the frontend uses Laravel, and production assets cannot overwrite the PHP document root', async () => {
  const { config } = await loadConfigFromFile({ command: 'serve', mode: 'development' });
  assert.equal(config.server.proxy['/api'], 'http://127.0.0.1:8001');
  assert.equal(config.server.proxy['/favicon.svg'], 'http://127.0.0.1:8001');
  assert.equal(config.root, resolve('frontend'));
  assert.equal(config.build.outDir, resolve('dist'));
  assert.notEqual(config.build.outDir, config.root);
  assert.notEqual(config.build.outDir, resolve('public'));
  assert.equal(config.publicDir, false);
});

test('the documented API command selects the separate Laravel environment and loopback port', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['dev:api'], 'php artisan serve --env=laravel --no-reload --host=127.0.0.1 --port=8001');
});
