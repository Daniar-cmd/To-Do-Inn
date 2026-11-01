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
        if (id.endsWith('/workspace/Workspace.jsx')) {
          // Keep portal children inspectable during the server-side event-handler tests.
          return `${code.replace("import { createPortal } from 'react-dom';", 'const createPortal = (children) => children;')}\nexport { ListCard, ListTask };`;
        }
        if (id.endsWith('/workspace/ListDeleteDialog.jsx')) {
          return code.replace("import { createPortal } from 'react-dom';", 'const createPortal = (children) => children;');
        }
      },
    }],
  });
  try {
    const { ListCard, ListTask } = await server.ssrLoadModule('/js/workspace/Workspace.jsx');
    const { ListDatePicker } = await server.ssrLoadModule('/js/workspace/ListDatePicker.jsx');
    const deadlineTrigger = renderToStaticMarkup(React.createElement(ListDatePicker, {
      value: null, deadline: '2026-11-02', open: false, onOpenChange() {}, onChange() {}, onDeadlineChange() {}, repeat: null, onRepeatChange() {},
    }));
    assert.match(deadlineTrigger, /class="list-option-button list-date-picker__trigger is-selected has-deadline"[^>]*aria-label="Дедлайн: 2 ноября 2026 г\."/);
    assert.match(deadlineTrigger, /<span>2 нояб\.<\/span>/);
    assert.match(deadlineTrigger, /<path d="M12 22c4\.5 0 7-3 7-7/);
    const dateTrigger = renderToStaticMarkup(React.createElement(ListDatePicker, {
      value: '2026-11-02', deadline: null, open: false, onOpenChange() {}, onChange() {}, onDeadlineChange() {}, repeat: null, onRepeatChange() {},
    }));
    assert.match(dateTrigger, /aria-label="Дата: 2 ноября 2026 г\."/);
    assert.match(dateTrigger, /<rect x="3" y="5" width="18" height="16"/);
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

    const decorated = renderToStaticMarkup(React.createElement(ListTask, { task: {
      id: 3, title: 'Название', is_important: true, is_completed: false,
      flag: { name: 'Метка', color: 'green' }, due_date: '2026-11-02', urgency: 3,
      location: 'Офис', description: 'а'.repeat(70),
    } }));
    const line = decorated.match(/<div class="task-list-card__task-line">([\s\S]*?)<\/div>/)?.[1];
    assert.ok(line);
    assert.ok(line.indexOf('Название') < line.indexOf('Метка') && line.indexOf('Метка') < line.indexOf('2 нояб.')
      && line.indexOf('2 нояб.') < line.indexOf('!!!') && line.indexOf('!!!') < line.indexOf('Офис'));
    assert.ok(decorated.indexOf('task-list-card__task-important') < decorated.indexOf('task-list-card__task-control'));
    assert.match(decorated, /class="task-list-card__task-important"[^>]*><svg[^>]*viewBox="0 0 24 24"/);
    assert.match(decorated, new RegExp(`class="task-list-card__task-description"[^>]*>${'а'.repeat(60)}…<`));
    assert.doesNotMatch(decorated, /<div class="task-list-card__task-meta"/);
    const deadlineHtml = renderToStaticMarkup(React.createElement(ListTask, { task: {
      id: 4, title: 'Срок', is_completed: false, deadline: '2026-11-02', urgency: 1,
    } }));
    assert.match(deadlineHtml, /class="task-list-card__due-date is-deadline"[^>]*aria-label="Дедлайн: 02\.11\.26"[^>]*>[\s\S]*?02\.11\.26<\/time>/);
    assert.match(deadlineHtml, /<svg aria-hidden="true" viewBox="0 0 24 24"[^>]*>[\s\S]*?<\/svg>02\.11\.26/);
    assert.doesNotMatch(deadlineHtml, /Дата:|Дедлайн: 02\.11\.2026/);
    await t.test('task property badges and important star are hidden while editing the title', () => {
      let stage = 0;
      function Probe() {
        const nodes = elements(ListTask({ task: { id: 18, title: 'Edit me', is_completed: false, is_important: true, flag: { id: 1, name: 'Work', color: 'blue' } } }));
        switch (stage++) {
          case 0:
            nodes.find((node) => node.props.className === 'task-list-card__task-title').props.onDoubleClick();
            break;
          case 1:
            assert.ok(nodes.some((node) => node.props.className === 'task-list-card__task-edit'));
            assert.equal(nodes.find((node) => node.props.className === 'task-list-card__task-badges'), undefined);
            assert.equal(nodes.find((node) => node.props.className === 'task-list-card__task-important'), undefined);
            break;
          default: assert.fail('Unexpected extra render');
        }
        return null;
      }
      renderToStaticMarkup(React.createElement(Probe));
      assert.equal(stage, 2);
    });

    await t.test('fullscreen list expands task creation inline instead of opening an overlay', () => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = { body: {} };
      globalThis.window = { matchMedia: () => ({ matches: false }) };
      let stage = 0;
      function Probe() {
        const nodes = elements(ListCard({ list: { id: 42, name: 'List' }, tasks: [], flags: [], isFullscreen: true }));
        const trigger = nodes.find((node) => node.props['aria-label'] === 'Добавить новую задачу');
        const composer = nodes.find((node) => node.props.className === 'task-create-dialog task-create-dialog--inline');
        switch (stage++) {
          case 0:
            assert.equal(composer, undefined);
            trigger.props.onClick();
            break;
          case 1:
            assert.ok(nodes.some((node) => node.props.className === 'task-list-card__composer-anchor is-expanded'));
            assert.ok(nodes.some((node) => node.props.className === 'task-create-overlay is-inline'));
            assert.ok(composer);
            assert.equal(composer.props['aria-modal'], undefined);
            trigger.props.onChange({ target: { value: 'New task' } });
            break;
          case 2:
            assert.equal(nodes.find((node) => node.props['aria-label'] === 'Название новой задачи').props.value, 'New task');
            break;
          default: assert.fail('Unexpected extra render');
        }
        return null;
      }
      try { renderToStaticMarkup(React.createElement(Probe)); assert.equal(stage, 3); }
      finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    });
    await t.test('mobile board card opens the desktop task popup on click and keeps typed text', () => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = { body: {} };
      globalThis.window = { matchMedia: () => ({ matches: true }) };
      let stage = 0;
      function Probe() {
        const nodes = elements(ListCard({ list: { id: 42, name: 'List' }, tasks: [], flags: [], isFullscreen: false }));
        const trigger = nodes.find((node) => node.props['aria-label'] === 'Добавить новую задачу');
        switch (stage++) {
          case 0:
            trigger.props.onClick();
            break;
          case 1:
            assert.ok(!nodes.some((node) => node.props.className === 'task-list-card__inline-composer is-open'));
            assert.ok(nodes.some((node) => node.props.className === 'workspace-shell task-create-overlay'));
            assert.ok(nodes.some((node) => node.props.className === 'task-create-dialog' && node.props['aria-modal'] === true));
            assert.ok(nodes.some((node) => node.type === 'h2' && node.props.className === 'task-create-dialog__mobile-title' && node.props.children === 'Новая задача'));
            assert.ok(nodes.some((node) => node.props.className === 'task-create-dialog__submit-label' && node.props.children === 'Добавить'));
            assert.ok(nodes.some((node) => node.props['aria-label'] === 'Назначить флаг задаче'));
            assert.equal(nodes.find((node) => node.props['aria-label'] === 'Название новой задачи').props.value, '');
            trigger.props.onChange({ target: { value: 'Mobile task' } });
            break;
          case 2:
            assert.equal(nodes.find((node) => node.props['aria-label'] === 'Название новой задачи').props.value, 'Mobile task');
            {
              let submitted = false;
              nodes.find((node) => node.props['aria-label'] === 'Название новой задачи').props.onKeyDown({
                key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {},
                currentTarget: { form: { requestSubmit() { submitted = true; } } },
              });
              assert.equal(submitted, true);
            }
            break;
          default: assert.fail('Unexpected extra render');
        }
        return null;
      }
      try { renderToStaticMarkup(React.createElement(Probe)); assert.equal(stage, 3); }
      finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    });
    const repeatingTask = { id: 9, title: 'Повтор', is_completed: false, repeat_interval: 'daily' };
    const compactRepeatingTask = renderToStaticMarkup(React.createElement(ListTask, { task: repeatingTask }));
    const fullscreenRepeatingTask = renderToStaticMarkup(React.createElement(ListTask, { task: repeatingTask, isFullscreen: true }));
    assert.doesNotMatch(compactRepeatingTask, /task-list-card__stop-repeat/);
    assert.match(fullscreenRepeatingTask, /Повтор ежедневно · Остановить/);

    await t.test('stopping task recurrence is only available in fullscreen and asks for confirmation', () => {
      const previousDocument = globalThis.document;
      globalThis.document = { querySelector: () => null };
      let stage = 0;
      function Probe() {
        const nodes = elements(ListTask({ task: repeatingTask, isFullscreen: true }));
        const stopButton = nodes.find((node) => node.props.className === 'task-list-card__stop-repeat');
        const confirmation = nodes.find((node) => node.type?.name === 'ListDeleteDialog');
        switch (stage++) {
          case 0:
            assert.equal(confirmation, undefined);
            stopButton.props.onClick();
            break;
          case 1:
            assert.equal(confirmation.props.title, 'Остановить повторение?');
            assert.equal(confirmation.props.confirmLabel, 'Остановить');
            assert.match(React.Children.toArray(confirmation.props.children).join(''), /Новые экземпляры задачи «Повтор» больше не будут создаваться/);
            assert.equal(typeof confirmation.props.onConfirm, 'function');
            confirmation.props.onClose();
            break;
          case 2:
            assert.equal(confirmation, undefined);
            break;
          default: assert.fail('Unexpected extra render');
        }
        return null;
      }
      try { renderToStaticMarkup(React.createElement(Probe)); assert.equal(stage, 3); }
      finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
      }
    });

    await t.test('composer previews selected badges beside the live input', () => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = { body: {} };
      globalThis.window = { matchMedia: () => ({ matches: true }) };
      let stage = 0;
      function Probe() {
        const nodes = elements(ListCard({ list: { id: 42, name: 'List' }, tasks: [], flags: [{ id: 7, name: 'Работа', color: 'rose' }] }));
        const find = (label) => nodes.find((node) => node.props['aria-label'] === label);
        const field = nodes.find((node) => node.props.className === 'task-create-dialog__inline-field');
        switch (stage++) {
          case 0:
            find('Добавить новую задачу').props.onChange({ target: { value: 'Начало' } });
            break;
          case 1:
            assert.equal(find('Название новой задачи').props.value, 'Начало');
            assert.ok(elements(field).some((node) => node.props.className === 'task-create-dialog__input-measure' && node.props.children === 'Начало '));
            nodes.find((node) => node.props.className?.includes('flag-picker__choice') && elements(node).some((child) => child.props.children === 'Работа')).props.onClick();
            break;
          case 2:
            assert.match(renderToStaticMarkup(field), /Начало[\s\S]*?is-rose[\s\S]*?Работа/);
            break;
          default: assert.fail('Unexpected extra render');
        }
        return null;
      }
      try { renderToStaticMarkup(React.createElement(Probe)); assert.equal(stage, 3); }
      finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    });

    await t.test('flag expands without collapsing extra properties, and selection keeps a compact trigger', () => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = { body: {} };
      globalThis.window = { matchMedia: () => ({ matches: true }) };
      let stage = 0;
      function Probe() {
        const nodes = elements(ListCard({ list: { id: 42, name: 'List' }, tasks: [], flags: [{ id: 7, name: 'A very long flag name', color: 'green' }] }));
        const byClass = (name) => nodes.find((node) => node.props.className?.split(' ').includes(name));
        const flagButton = nodes.find((node) => node.props['aria-label'] === 'Назначить флаг задаче');
        switch (stage++) {
          case 0:
            nodes.find((node) => node.props['aria-label'] === 'Добавить новую задачу').props.onClick();
            break;
          case 1:
            byClass('task-create-more-button').props.onClick();
            break;
          case 2:
            flagButton.props.onClick();
            break;
          case 3:
            assert.equal(flagButton.props['aria-expanded'], true);
            assert.equal(byClass('flag-picker__panel').props.hidden, false);
            assert.equal(byClass('task-create-more-button').props['aria-expanded'], true);
            nodes.find((node) => node.props.className?.includes('flag-picker__choice') && elements(node).some((child) => child.props.children === 'A very long flag name')).props.onClick();
            break;
          case 4:
            assert.equal(flagButton.props['aria-expanded'], false);
            assert.match(flagButton.props.className, /is-selected/);
            assert.equal(byClass('flag-picker__panel').props.hidden, true);
            assert.equal(byClass('task-create-more-button').props['aria-expanded'], true);
            assert.match(renderToStaticMarkup(flagButton), /<span>Флаг<\/span>/);
            break;
          default: assert.fail('Unexpected extra render');
        }
        return null;
      }
      try { renderToStaticMarkup(React.createElement(Probe)); assert.equal(stage, 5); }
      finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    });

    await t.test('calendar sidebar keeps quick dates above repeat and deadline, and deadline selects separately', () => {
      let dueDate = null;
      let deadline = null;
      let closedAfterSelection = false;
      let stage = 0;
      function Probe() {
        const [, forceUpdate] = React.useState(0);
        const nodes = elements(ListDatePicker({ value: dueDate, deadline, open: true, onOpenChange: (nextOpen) => { if (!nextOpen) closedAfterSelection = true; }, onChange: (date) => { dueDate = date; forceUpdate((version) => version + 1); }, onDeadlineChange: (date) => { deadline = date; forceUpdate((version) => version + 1); } }));
        const sidebar = nodes.find((node) => node.props.className === 'list-date-picker__sidebar');
        const quick = nodes.find((node) => node.props.className === 'list-date-picker__quick');
        const actions = nodes.find((node) => node.props.className === 'list-date-picker__actions');
        const repeat = nodes.find((node) => node.props.className === 'list-date-picker__repeat');
        const deadlineButton = nodes.find((node) => node.props.className === 'list-date-picker__deadline');
        assert.deepEqual(React.Children.toArray(sidebar.props.children).map((child) => child.props.className), ['list-date-picker__repeat-panel', 'list-date-picker__heading list-date-picker__quick-heading', 'list-date-picker__quick', 'list-date-picker__actions']);
        assert.equal(nodes.some((node) => node.type === 'input'), false);
        assert.equal(elements(quick).filter((node) => node.type === 'button').length, 4);
        assert.deepEqual(React.Children.toArray(actions.props.children).map((child) => child.props.className), ['list-date-picker__repeat', 'list-date-picker__deadline']);
        assert.equal(repeat.props.disabled, true);
        switch (stage++) {
          case 0:
            assert.equal(deadlineButton.props.disabled, false);
            deadlineButton.props.onClick();
            break;
          case 1:
            assert.equal(deadlineButton.props['aria-pressed'], true);
            elements(quick).find((node) => node.type === 'button').props.onClick();
            break;
          case 2:
            assert.ok(deadline);
            assert.equal(closedAfterSelection, true, 'choosing a date closes the calendar');
            assert.equal(dueDate, null);
            assert.equal(nodes.find((node) => node.props.className === 'list-date-picker__calendar').props.children[0].props.children, 'Выберите дедлайн');
            nodes.find((node) => node.props['aria-label'] === 'Сбросить дедлайн').props.onClick();
            break;
          case 3:
            assert.equal(deadline, null);
            elements(quick).find((node) => node.type === 'button').props.onClick();
            break;
          case 4:
            assert.ok(deadline);
            deadlineButton.props.onClick();
            break;
          case 5:
            assert.equal(deadlineButton.props['aria-pressed'], false);
            elements(quick).find((node) => node.type === 'button').props.onClick();
            break;
          case 6:
            assert.equal(dueDate, deadline);
            nodes.find((node) => node.props['aria-label'] === 'Сбросить дату').props.onClick();
            break;
          case 7:
            assert.equal(dueDate, null);
            assert.ok(deadline);
            break;
          default:
            assert.fail('Unexpected extra render');
        }
        return null;
      }
      renderToStaticMarkup(React.createElement(Probe));
      assert.equal(stage, 8);
    });

    await t.test('task calendar replaces quick dates with four repeat choices and keeps deadline separate', () => {
      let repeat = null;
      let stage = 0;
      function Probe() {
        const nodes = elements(ListDatePicker({ value: '2026-11-05', deadline: null, open: true,
          onOpenChange() {}, onChange() {}, onDeadlineChange() {}, repeat, onRepeatChange: (value) => { repeat = value; } }));
        const picker = nodes.find((node) => node.props.className?.split(' ').includes('list-date-picker'));
        const repeatButton = nodes.find((node) => node.props.className === 'list-date-picker__repeat');
        const panel = nodes.find((node) => node.props.className === 'list-date-picker__repeat-panel');
        const quick = nodes.find((node) => node.props.className === 'list-date-picker__quick');
        switch (stage++) {
          case 0:
            assert.equal(panel.props.hidden, true);
            repeatButton.props.onClick();
            break;
          case 1:
            assert.match(picker.props.className, /is-repeat-open/);
            assert.equal(panel.props.hidden, false);
            assert.equal(quick.props.hidden, true, 'repeat choices replace quick dates while open');
            assert.deepEqual(elements(panel).filter((node) => node.type === 'button').slice(0, 4).map((node) => node.props.children),
              ['Каждый день', 'Каждую неделю', 'Раз в месяц', 'Каждый год']);
            elements(panel).find((node) => node.props.children === 'Раз в месяц').props.onClick();
            break;
          case 2:
            assert.equal(repeat, 'monthly');
            assert.equal(panel.props.hidden, true);
            assert.doesNotMatch(picker.props.className, /is-repeat-open/);
            break;
          default:
            assert.fail('Unexpected extra render');
        }
        return null;
      }
      renderToStaticMarkup(React.createElement(Probe));
      assert.equal(stage, 3);
    });

    await t.test('urgency expands inside one dropdown, selects a level and resets when the dropdown reopens', () => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = { body: {} };
      globalThis.window = { matchMedia: () => ({ matches: true }) };
      let stage = 0;
      function Probe() {
        const nodes = elements(ListCard({ list: { id: 42, name: 'List' }, tasks: [], flags: [] }));
        const findClass = (name) => nodes.find((node) => node.props.className?.split(' ').includes(name));
        const dropdown = findClass('task-create-menu');
        const urgency = findClass('task-urgency-picker');
        const choices = findClass('task-urgency-picker__panel');
        switch (stage++) {
          case 0:
            nodes.find((node) => node.props['aria-label'] === 'Добавить новую задачу').props.onChange({ target: { value: 'Task' } });
            break;
          case 1:
            findClass('task-create-more-button').props.onClick();
            break;
          case 2:
            assert.equal(urgency.type, 'button');
            assert.equal(urgency.props['aria-expanded'], false);
            assert.equal(choices, undefined);
            urgency.props.onClick();
            break;
          case 3:
            assert.match(dropdown.props.className, /is-urgency-open/);
            assert.equal(urgency.props['aria-expanded'], true);
            assert.ok(React.Children.toArray(dropdown.props.children).some((child) => child.props.className === 'task-urgency-picker__panel'));
            assert.equal(choices.props.className, 'task-urgency-picker__panel');
            assert.equal(elements(choices).filter((node) => node.type === 'button').length, 4);
            findClass('is-level-3').props.onClick();
            break;
          case 4:
            assert.equal(choices, undefined);
            assert.match(urgency.props.className, /is-level-3/);
            assert.match(urgency.props.className, /is-selected/);
            assert.equal(urgency.props['aria-pressed'], true);
            assert.equal(elements(urgency).find((node) => node.props.className === 'task-urgency-picker__mark').props.children, '!!!');
            urgency.props.onClick();
            break;
          case 5:
            findClass('task-create-more-button').props.onClick();
            break;
          case 6:
            assert.equal(choices, undefined);
            findClass('task-create-more-button').props.onClick();
            break;
          case 7:
            assert.equal(choices, undefined);
            assert.equal(urgency.props['aria-expanded'], false);
            assert.match(urgency.props.className, /is-level-3/);
            break;
          default:
            assert.fail('Unexpected extra render');
        }
        return null;
      }
      try {
        renderToStaticMarkup(React.createElement(Probe));
        assert.equal(stage, 8);
      } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    });

    await t.test('clicking the selected urgency level removes it', () => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = { body: {} };
      globalThis.window = { matchMedia: () => ({ matches: true }) };
      let stage = 0;
      function Probe() {
        const nodes = elements(ListCard({ list: { id: 42, name: 'List' }, tasks: [], flags: [] }));
        const byClass = (name) => nodes.find((node) => node.props.className?.split(' ').includes(name));
        const urgency = byClass('task-urgency-picker');
        const choice = nodes.find((node) => node.props.className?.includes('task-urgency-picker__choice') && node.props.className.includes('is-level-2'));
        switch (stage++) {
          case 0:
            nodes.find((node) => node.props['aria-label'] === 'Добавить новую задачу').props.onChange({ target: { value: 'Task' } });
            break;
          case 1:
            byClass('task-create-more-button').props.onClick();
            break;
          case 2:
            urgency.props.onClick();
            break;
          case 3:
            choice.props.onClick();
            break;
          case 4:
            assert.match(urgency.props.className, /is-level-2/);
            urgency.props.onClick();
            break;
          case 5:
            assert.equal(choice.props['aria-pressed'], true);
            choice.props.onClick();
            break;
          case 6:
            assert.doesNotMatch(urgency.props.className, /is-level-/);
            assert.doesNotMatch(urgency.props.className, /is-selected/);
            assert.equal(urgency.props['aria-pressed'], false);
            assert.equal(nodes.find((node) => node.props.className === 'task-urgency-picker__mark').props.children, '!');
            urgency.props.onClick();
            break;
          case 7:
            assert.equal(choice.props['aria-pressed'], false);
            break;
          default:
            assert.fail('Unexpected extra render');
        }
        return null;
      }
      try {
        renderToStaticMarkup(React.createElement(Probe));
        assert.equal(stage, 8);
      } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    });

    await t.test('annotation stays visible across other menus and closes only on a second annotation click', () => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = { body: {} };
      globalThis.window = { matchMedia: () => ({ matches: true }) };
      let stage = 0;
      function Probe() {
        const nodes = elements(ListCard({ list: { id: 42, name: 'List' }, tasks: [], flags: [] }));
        const findLabel = (label) => nodes.find((node) => node.props['aria-label'] === label);
        const findClass = (name) => nodes.find((node) => node.props.className?.split(' ').includes(name));
        const annotation = findLabel('Аннотация');
        const annotationField = findLabel('Текст аннотации');
        const location = findLabel('Локация');
        const locationField = findLabel('Указать локацию');
        assert.equal(findLabel('Дедлайн'), undefined);
        switch (stage++) {
          case 0:
            findLabel('Добавить новую задачу').props.onChange({ target: { value: 'Task' } });
            break;
          case 1:
            findClass('task-create-more-button').props.onClick();
            break;
          case 2:
            assert.equal(annotation.props['aria-expanded'], false);
            annotation.props.onClick();
            break;
          case 3:
            assert.equal(annotation.props['aria-expanded'], true);
            assert.ok(annotationField);
            assert.equal(annotationField.props.rows, '2');
            assert.equal(annotationField.props.placeholder, 'Напишите аннотацию');
              assert.ok(nodes.indexOf(findClass('task-create-dialog__description')) < nodes.indexOf(findClass('list-creator__toolbar')));
            annotationField.props.onChange({ target: { value: 'Дополнительная информация' } });
            break;
          case 4:
            assert.equal(annotation.props['aria-expanded'], true);
            assert.equal(annotationField.props.value, 'Дополнительная информация');
            location.props.onClick();
            break;
          case 5:
            assert.ok(annotationField);
            assert.equal(annotationField.props.value, 'Дополнительная информация');
            assert.equal(location.props['aria-expanded'], true);
            assert.ok(locationField);
            locationField.props.onChange({ target: { value: 'Офис' } });
            break;
          case 6:
            assert.equal(locationField.props.value, 'Офис');
            assert.equal(findLabel('Время задачи'), undefined);
            assert.equal(findClass('task-create-dialog__time'), undefined);
            assert.equal(annotation.props['aria-expanded'], true);
            findClass('task-urgency-picker').props.onClick();
            break;
          case 7:
            assert.equal(locationField, undefined);
            assert.ok(annotationField);
            assert.equal(annotation.props['aria-expanded'], true);
            findClass('task-create-more-button').props.onClick();
            break;
          case 8:
            assert.ok(annotationField);
            assert.equal(annotation.props['aria-expanded'], true);
            findClass('task-create-more-button').props.onClick();
            break;
          case 9:
            assert.ok(annotationField);
            annotation.props.onClick();
            break;
          case 10:
            assert.equal(annotationField, undefined);
            assert.equal(annotation.props['aria-expanded'], false);
            break;
          default:
            assert.fail('Unexpected extra render');
        }
        return null;
      }
      try {
        renderToStaticMarkup(React.createElement(Probe));
        assert.equal(stage, 11);
      } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    });

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
  const rules = new Map();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rules.has(match[1].trim())) rules.set(match[1].trim(), match[2]);
  }
  assert.match(rules.get('.task-list-card__tasks'), /display: block/);
  assert.match(rules.get('.task-list-card__tasks li'), /display: flow-root/);
  assert.match(rules.get('.task-list-card__tasks li'), /min-width: 0/);
  assert.match(rules.get('.task-list-card__task'), /position: relative/);
  assert.match(rules.get('.task-list-card__task-important'), /position: absolute;[^}]*left: -14px;[^}]*width: 12px/);
  assert.match(rules.get('.task-list-card__task-important svg'), /width: 12px;\s*height: 12px/);
  assert.match(rules.get('.task-list-card__task-title'), /overflow-wrap: anywhere/);
  assert.match(rules.get('.task-list-card__task-line'), /width: 100%;[^}]*overflow-wrap: anywhere/);
  assert.match(rules.get('.task-list-card__task-badges'), /display: contents/);
  assert.match(css, /\.task-list-card__task\.is-completing \.task-list-card__task-badges > \*,[\s\S]*?text-decoration-line: line-through/);
  assert.match(css, /\.task-list-card__task\.is-completed \.task-list-card__task-badges > \*[^}]*filter: grayscale\(1\)/);
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

test('task property buttons distinguish an open editor from a stored selection', () => {
  const css = compile(fileURLToPath(new URL('../../frontend/scss/style.scss', import.meta.url))).css;
  assert.match(css, /:is\(\.task-create-property-button, \.list-date-picker__trigger\)\.is-selected:not\(\[aria-expanded=true\]\)\s*\{[^}]*background: var\(--workspace-hover\);[^}]*box-shadow: none/);
  assert.match(css, /:is\(\.task-create-property-button, \.list-date-picker__trigger\)\.is-selected:not\(\[aria-expanded=true\]\)::after\s*\{[^}]*position: absolute;[^}]*background: #3478d4/);
  assert.match(css, /:is\(\.task-create-property-button, \.list-date-picker__trigger\)\[aria-expanded=true\]\s*\{[^}]*background: rgba\(52, 120, 212, 0\.13\);[^}]*box-shadow: inset/);
  assert.match(css, /@supports \(transition-behavior: allow-discrete\)/);
  assert.match(css, /transition: display 220ms allow-discrete/);
  assert.match(css, /@starting-style/);
});

test('repeat choices reuse the quick-date sidebar and deadline has its own date color', () => {
  const css = compile(fileURLToPath(new URL('../../frontend/scss/style.scss', import.meta.url))).css;
  assert.doesNotMatch(css, /grid-template-columns: 156px 248px/);
  assert.match(css, /\.list-date-picker \[hidden\]\s*\{[^}]*display: none !important/);
  assert.match(css, /\.list-date-picker\.is-deadline \.list-date-picker__panel\s*\{[^}]*border-color: rgba\(182, 93, 86, 0\.65\)/);
  assert.match(css, /\.list-date-picker\.is-deadline \.list-date-picker__days button\.is-selected\s*\{[^}]*background: #b65d56/);
});

test('mobile styles keep the header and list options compact and use vertical fullscreen transitions', () => {
  const css = compile(fileURLToPath(new URL('../../frontend/scss/style.scss', import.meta.url))).css;
  assert.match(css, /\.workspace-header\s*\{\s*min-height: 0;\s*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.workspace-search\s*\{\s*grid-column: 2;\s*grid-row: 1/);
  assert.match(css, /\.workspace-header__notifications\s*\{\s*display: none/);
  assert.match(css, /\.workspace-sidebar__theme\s*\{\s*display: flex/);
  assert.match(css, /\.profile-menu__notifications\s*\{\s*display: block/);
  assert.match(css, /\.list-creator__toolbar\s*\{\s*display: flex;\s*flex-wrap: nowrap/);
  assert.match(css, /\.list-creator__toolbar > \.list-creator__extra-row\s*\{\s*display: none/);
  assert.match(css, /\.list-creator__toolbar\.is-more-open > \.list-creator__extra-row\s*\{[^}]*display: flex/);
  assert.match(css, /\.list-creator__date \.list-date-picker__panel\s*\{[^}]*left: 12px;\s*width: auto/);
  assert.match(css, /\.list-theme-picker\s*\{\s*gap: 9px/);
  assert.match(css, /\.list-focus-overlay__navigation\s*\{\s*display: none/);
  assert.match(css, /\.list-focus-overlay\.workspace-shell,\s*\.list-focus-overlay\.workspace-shell\.is-short-list\s*\{\s*position: fixed;[\s\S]*?height: 100svh;/);
  assert.match(css, /\.list-focus-overlay__peek\s*\{[^}]*display: block;[^}]*pointer-events: auto/);
  assert.match(css, /\.list-focus-overlay__peek\.is-previous\s*\{\s*right: 28px;\s*left: 28px/);
  assert.match(css, /\.list-focus-overlay\[data-swipe=next\] \.list-focus-overlay__peek\.is-following-next[\s\S]*?display: block;\s*opacity: calc\(/);
  assert.match(css, /\.list-focus-overlay__peek\.is-next\s*\{[^}]*bottom: max\(/);
  assert.match(css, /\.list-focus-overlay__dialog\s*\{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain/);
  assert.match(css, /\.list-focus-overlay__dialog\.is-entering-next\s*\{\s*animation: list-focus-mobile-in-next/);
  assert.match(css, /\.list-focus-overlay\[data-swipe\] \.list-focus-overlay__dialog\s*\{[^}]*--focus-outgoing-y/);
  const swipeDialog = css.match(/\.list-focus-overlay\[data-swipe\] \.list-focus-overlay__dialog\s*\{([^}]*)\}/)?.[1];
  assert.match(swipeDialog, /clip-path: inset\([^;]*--focus-enter-height/);
  assert.doesNotMatch(swipeDialog, /(?:height|width|left|right):/);
  assert.match(css, /\.list-focus-overlay\[data-swipe=next\] \.list-focus-overlay__peek\.is-next[\s\S]*?--focus-enter-height/);
  assert.match(css, /\.list-focus-overlay\[data-swipe-settling\] \.list-focus-overlay__dialog[\s\S]*?transition: transform 260ms/);
  assert.match(css, /\.list-focus-overlay\[data-swipe-commit\] \.list-focus-overlay__dialog\s*\{\s*opacity: 0\.78/);
  assert.match(css, /\.list-focus-overlay__close-mobile\s*\{\s*display: grid;\s*position: fixed/);
});

test('desktop task entry opens a fullscreen composer and keeps its compact trigger buttonless', () => {
  const css = compile(fileURLToPath(new URL('../../frontend/scss/style.scss', import.meta.url))).css;
  const desktop = css.match(/\.task-create-overlay\s*\{[\s\S]*?\.task-create-error\s*\{[^}]*\}/)?.[0];
  assert.ok(desktop, 'desktop-only task creation styles exist');
  assert.match(css, /@media \(min-width: 701px\)\s*\{\s*\.task-list-card__add button\s*\{\s*display: none/);
  assert.match(desktop, /\.task-create-overlay\s*\{[^}]*position: fixed;[^}]*inset: 0/);
  assert.match(desktop, /\.task-create-overlay\s*\{[^}]*padding-top: 20vh/);
  assert.match(desktop, /\.task-create-dialog\s*\{[^}]*width: min\(100%, 820px\)/);
  assert.match(desktop, /\.task-create-dialog__name-row\s*\{[^}]*min-height: 54px/);
  assert.match(desktop, /\.task-create-close\s*\{\s*display: grid;[^}]*width: 24px/);
  assert.match(desktop, /\.task-create-dialog \.list-creator__toolbar\s*\{[^}]*border-top: 1px solid var\(--workspace-border\)/);
  assert.match(desktop, /\.task-create-dialog \.list-creator__toolbar\.is-more-open > \.task-create-menu/);
  assert.match(desktop, /--task-menu-main-width: 200px/);
  assert.match(desktop, /\.task-create-dialog__description\s*\{[^}]*width: 80%/);
  assert.match(desktop, /\.task-create-dialog__description textarea\s*\{[^}]*min-height: 2\.8em;[^}]*max-height: 4\.4em;[^}]*resize: none/);
  assert.match(desktop, /\.task-create-dialog \.task-create-menu__field\s*\{[^}]*border-top: 0/);
  assert.match(desktop, /\.task-create-dialog \.task-create-menu__field input,\s*\.task-create-dialog \.task-create-menu__field textarea/);
  assert.match(desktop, /\.task-create-dialog \.list-creator__toolbar > \.list-creator__more\s*\{[^}]*display: grid/);
  assert.match(desktop, /\.task-create-dialog \.task-create-more-button\s*\{[^}]*background: #3478d4;[^}]*color: #fff/);
  assert.match(desktop, /\.task-create-dialog \.list-creator__toolbar\.is-more-open > \.task-create-menu\s*\{[^}]*position: absolute;[^}]*left: 44px;[^}]*border-radius: 10px/);
  assert.match(desktop, /\.task-create-menu\.is-urgency-open\s*\{[^}]*grid-template-columns: var\(--task-menu-main-width\) var\(--task-menu-urgency-width\)/);
  assert.match(desktop, /\.task-create-dialog \.task-create-menu__field\s*\{[^}]*animation: task-create-field-in 160ms ease both/);
  assert.match(desktop, /\.task-create-dialog \.task-create-menu__main > \.list-option-button\s*\{[^}]*width: 100%;[^}]*height: 34px;[^}]*border: 0/);
  assert.match(desktop, /\.task-create-dialog \.task-create-menu__icon\s*\{[^}]*width: 26px;[^}]*place-items: center/);
  const urgencyPanel = desktop.match(/\.task-create-dialog \.task-urgency-picker__panel\s*\{([^}]*)\}/)?.[1];
  assert.match(urgencyPanel, /display: grid;[^}]*border-left: 1px solid var\(--workspace-border\)/);
  assert.doesNotMatch(urgencyPanel, /^\s*(?:position|box-shadow|border-radius|top|left):/m);
  assert.doesNotMatch(desktop, /Дедлайн/);
  assert.match(css, /@media \(min-width: 701px\)\s*\{\s*\.list-date-picker__panel\s*\{[^}]*grid-template-columns: minmax\(0, 248px\) minmax\(0, 1fr\)/);
  assert.match(css, /\.list-date-picker__quick span,\s*\.list-date-picker__quick small\s*\{[^}]*white-space: nowrap/);
  assert.match(css, /\.task-create-dialog \.task-create-toolbar \.list-date-picker__panel\s*\{[^}]*left: 0;[^}]*width: min\(500px, 100%\)/);
  assert.match(css, /\.list-date-picker__actions\s*\{[^}]*display: grid;[^}]*gap: 6px/);
  assert.match(css, /\.list-date-picker__quick\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(desktop, /\.task-create-dialog__input-wrap > input\s*\{[^}]*font-size: 0\.96rem/);
  assert.match(desktop, /\.task-create-dialog__input-measure\s*\{[^}]*white-space: pre;[^}]*visibility: hidden/);
  assert.match(desktop, /\.task-create-dialog__input-wrap > input\s*\{[^}]*position: absolute;[^}]*inset: 0/);
  assert.match(desktop, /\.task-create-dialog__submit\s*\{[^}]*background: #3478d4;[^}]*color: #fff/);
});

test('fullscreen task composer is embedded after the trigger instead of covering the list', () => {
  const css = compile(fileURLToPath(new URL('../../frontend/scss/style.scss', import.meta.url))).css;
  assert.match(css, /\.task-list-card__composer-anchor\.is-expanded > \.task-list-card__add\s*\{\s*display: none/);
  assert.match(css, /\.task-list-card__inline-composer\.is-open\s*\{\s*margin-bottom: 14px/);
  assert.match(css, /\.task-create-overlay\.is-inline\s*\{[^}]*position: static;[^}]*padding: 0;[^}]*background: transparent/);
  assert.match(css, /\.task-create-dialog--inline\s*\{[^}]*width: 100%;[^}]*box-shadow: none;[^}]*animation: none/);
});

test('mobile task composer properties fit inside both list modes', () => {
  const css = compile(fileURLToPath(new URL('../../frontend/scss/style.scss', import.meta.url))).css;
  assert.match(css, /\.task-create-overlay:not\(\.is-inline\)\s*\{[^}]*position: fixed;[^}]*inset: 0;[^}]*height: 100dvh;[^}]*background: rgba\(10, 16, 26, 0\.58\)/);
  assert.match(css, /\.task-create-overlay:not\(\.is-inline\) \.task-create-dialog\s*\{[^}]*width: 100%;[^}]*max-height: calc\(100dvh/);
  assert.match(css, /\.list-focus-overlay__dialog:has\(\.task-list-card__inline-composer\.is-open\)\s*\{[^}]*--focus-viewport-height[^}]*transform: none/);
  assert.match(css, /\.list-focus-overlay:has\(\.task-list-card__inline-composer\.is-open\) \.list-focus-overlay__peek\s*\{\s*visibility: hidden/);
  assert.match(css, /@media \(max-width: 700px\)\s*\{\s*\.task-list-card__add button\s*\{\s*display: none/);
  assert.match(css, /\.task-create-overlay:not\(\.is-inline\)\s*\{[^}]*place-items: center/);
  assert.match(css, /\.task-create-dialog \.task-create-dialog__name-row\s*\{[^}]*display: flex;[^}]*gap: 8px/);
  assert.match(css, /\.task-create-dialog \.task-create-dialog__submit\s*\{\s*display: none/);
  assert.match(css, /\.task-create-dialog \.task-create-toolbar\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*gap: 6px/);
  assert.match(css, /\.task-create-dialog \.task-create-menu__main\s*\{[^}]*display: contents/);
  assert.match(css, /\.task-create-dialog \.task-create-toolbar \.list-option-button\s*\{[^}]*width: auto;[^}]*height: 38px;[^}]*flex: 0 0 auto;[^}]*padding: 0 8px/);
  assert.match(css, /\.task-create-dialog \.task-urgency-picker__panel\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  const panels = css.match(/\.task-create-dialog \.task-create-toolbar \.flag-picker__panel,[\s\S]*?\.task-create-dialog \.task-create-toolbar \.list-date-picker__panel\s*\{([^}]*)\}/)?.[1];
  assert.match(panels, /position: static;[^}]*order: 10;[^}]*width: 100%;[^}]*flex: 0 0 100%/);
  assert.doesNotMatch(panels, /position: absolute/);
  assert.match(css, /\.task-create-dialog \.task-create-dialog__description\s*\{[^}]*flex: none;[^}]*padding: 0 0 10px/);
  assert.doesNotMatch(css, /\.task-create-dialog__description\s*\{[^}]*order:/);
  assert.match(css, /\.task-create-dialog \.task-create-menu__main > \.task-urgency-picker\[aria-expanded=true\]\s*\{[^}]*border-color: #3478d4;[^}]*box-shadow/);
  assert.match(css, /\.task-create-dialog \.task-create-toolbar > \.list-option-button:is\(\[aria-expanded=true\], \.is-selected\)\s*\{[^}]*border-color: #3478d4/);
  assert.match(css, /\.task-create-dialog \.flag-picker__choice\.is-selected::after\s*\{/);
  assert.match(css, /\.task-create-overlay:not\(\.is-inline\) \.task-create-dialog:has\(\.list-date-picker\.is-open\)\s*\{[^}]*height: calc\(100dvh - 24px/);
  assert.match(css, /\.task-create-dialog:has\(\.list-date-picker\.is-open\) \.list-date-picker__panel\s*\{[^}]*grid-column: 1\/-1/);
});
