import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadConfigFromFile } from 'vite';

test('the frontend uses ASP.NET Core and writes production assets to dist', async () => {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' });
  assert.ok(loaded);
  const config: any = loaded.config;
  assert.equal(config.server.proxy['/api'], 'http://127.0.0.1:8002');
  assert.equal(config.server.proxy['/favicon.svg'], undefined);
  assert.equal(config.root, resolve('frontend'));
  assert.equal(config.build.outDir, resolve('dist'));
  assert.notEqual(config.build.outDir, config.root);
  assert.notEqual(config.build.outDir, resolve('public'));
  assert.equal(config.publicDir, false);
  assert.ok(!Object.values(config.build.rollupOptions.input).includes(resolve('frontend/pages/design-system.html')), 'the design catalog must stay out of production');
});

test('the local API command starts .NET and local checks run without PHP', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['dev:api'], 'node --import tsx backend/dev-api.mts');
  assert.equal(pkg.scripts['test:local'], 'bash tests/dotnet-local-smoke.sh');
});
