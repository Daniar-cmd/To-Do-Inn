import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { compile } from 'sass';

function elements(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(elements)];
}

// Render the real JSX without introducing a DOM/testing dependency into the app.
test('workspace components render safely and guard editing/deletion event handlers', async (t) => {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../../vite.config.mjs', import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: 'expose-workspace-components-for-tests',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/workspace/Workspace.jsx')) return `${code}\nexport { ListCard, ListTask };`;
      },
    }],
  });
  try {
    const { ListCard, ListTask } = await server.ssrLoadModule('/js/workspace/Workspace.jsx');
    const longTitle = 'Длинная задача в несколько строк '.repeat(5) + '<script>alert(1)</script>';
    const html = renderToStaticMarkup(React.createElement(ListCard, {
      list: { id: 42, board_id: 1, name: 'List', description: 'Saved description', theme: 'blue', created_at: null },
      tasks: [
        { id: 1, list_id: 42, title: longTitle, is_completed: false },
        { id: 2, list_id: 42, title: 'Done', is_completed: true },
      ],
      flags: [],
    }));
    assert.match(html, /Saved description/);
    assert.match(html, /class="task-list-card__task-title"/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /class="task-list-card__task-menu"/);
    assert.match(html, /Выполнено 1 задача/);
    assert.doesNotMatch(html, /list-delete-backdrop/);

    await t.test('Escape discards a task title draft without sending a save request', (t) => {
      let requests = 0;
      let stage = 0;
      let finalTree;
      t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Unexpected save'); });
      function Probe() {
        const tree = ListTask({ task: { id: 1, title: 'Original', is_completed: false } });
        const nodes = elements(tree);
        if (stage === 0) {
          stage++;
          nodes.find((node) => node.props.className === 'task-list-card__task-title').props.onDoubleClick();
        } else if (stage === 1) {
          stage++;
          nodes.find((node) => node.type === 'input' && node.props.autoFocus).props.onChange({ target: { value: 'Draft' } });
        } else if (stage === 2) {
          stage++;
          const input = nodes.find((node) => node.type === 'input' && node.props.autoFocus);
          assert.equal(input.props.value, 'Draft');
          input.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {}, currentTarget: { blur: input.props.onBlur } });
        } else {
          finalTree = tree;
        }
        return null;
      }
      renderToStaticMarkup(React.createElement(Probe));
      assert.equal(requests, 0);
      assert.equal(elements(finalTree).find((node) => node.props.className === 'task-list-card__task-title').props.children, 'Original');
    });

    function deletionHandler(onDeleted, onChange) {
      let stage = 0;
      let confirm;
      function Probe() {
        const tree = ListCard({
          list: { id: 42, board_id: 1, name: 'List', theme: 'blue' },
          tasks: [], flags: [], csrfToken: 'csrf', onDeleted, onChange,
        });
        const nodes = elements(tree);
        if (stage === 0) {
          stage++;
          nodes.find((node) => node.props.className === 'task-list-card__edit-button').props.onClick();
        } else if (stage === 1) {
          stage++;
          nodes.find((node) => node.props.className === 'task-list-card__delete-list').props.onClick();
        } else {
          confirm = nodes.find((node) => node.props.confirmLabel === 'Удалить').props.onConfirm;
        }
        // Capture handlers without rendering the browser-only portal on the server.
        return null;
      }
      renderToStaticMarkup(React.createElement(Probe));
      return confirm;
    }

    await t.test('successful deletion removes the stale card before a failing reload; double confirmation is ignored', async (t) => {
      const events = [];
      let finish;
      let requests = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        return new Promise((resolve) => { finish = resolve; });
      });
      const confirm = deletionHandler((list) => events.push(`remove:${list.id}`), async () => {
        events.push('reload');
        throw new Error('Connection lost');
      });
      const first = confirm();
      await confirm();
      assert.equal(requests, 1);
      finish(new Response(JSON.stringify({ success: true, data: { deleted: true } })));
      await first;
      assert.deepEqual(events, ['remove:42', 'reload']);
    });

    await t.test('only a JSON API missing-list response retires a stale card', async (t) => {
      for (const [status, body, shouldRemove] of [
        [404, JSON.stringify({ success: false, error: 'Список не найден.' }), true],
        [403, JSON.stringify({ success: false, error: 'Forbidden' }), false],
        [401, JSON.stringify({ success: false, error: 'Login required' }), false],
        [404, '<html>Not found</html>', false],
      ]) {
        let removed = false;
        t.mock.method(globalThis, 'fetch', async () => new Response(body, { status }));
        const confirm = deletionHandler((list, unavailable) => {
          assert.equal(list.id, 42);
          assert.equal(unavailable, true);
          removed = true;
        }, async () => {});
        await confirm();
        assert.equal(removed, shouldRemove);
      }
    });
  } finally {
    await server.close();
  }
});

test('compiled styles keep multiline task rows flexible and deletion dialogs above fullscreen', () => {
  const css = compile(fileURLToPath(new URL('../../frontend/scss/style.scss', import.meta.url))).css;
  const rules = new Map([...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [match[1].trim(), match[2]]));
  assert.match(rules.get('.task-list-card__tasks'), /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(rules.get('.task-list-card__tasks li'), /min-width: 0/);
  assert.match(rules.get('.task-list-card__task-title'), /overflow-wrap: anywhere/);
  assert.match(rules.get('.task-list-card__task-title'), /flex: 1 1 0/);
  assert.match(rules.get('.task-list-card__task-menu'), /visibility: hidden/);
  assert.doesNotMatch(rules.get('.task-list-card__task-menu'), /display: none/);
  const modal = rules.get('.workspace-shell.list-delete-backdrop');
  assert.match(modal, /position: fixed/);
  const layer = (rule) => Number(/z-index: (\d+)/.exec(rule)[1]);
  assert(layer(modal) > layer(rules.get('.list-focus-overlay.workspace-shell')));
  for (const selector of ['.list-focus-overlay__dialog.is-opening', '.list-focus-overlay__dialog.is-entering-next']) {
    assert.match(rules.get(selector), /backwards/);
    assert.doesNotMatch(rules.get(selector), /both|forwards/);
  }
});
