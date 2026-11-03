import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PlusIcon, UserIcon, SettingsIcon, BoardTypeIcon, FlagIcon, StarIcon, AnnotationIcon, LocationIcon, uiText, taskUrgencyLevels, ListDatePicker, ListDeleteDialog, CustomSelect } from '../ui/index.js';

const sections = [['principles', 'Правила'], ['colors', 'Цвета'], ['type', 'Типографика'], ['geometry', 'Размеры'], ['icons', 'Иконки'], ['buttons', 'Кнопки'], ['motion', 'Анимации'], ['blocks', 'Блоки'], ['copy', 'Тексты']];
const palette = [['bg', 'Фон страницы'], ['surface', 'Поверхность'], ['text', 'Основной текст'], ['muted', 'Вторичный текст'], ['border', 'Граница'], ['hover', 'Наведение']];
const icons = [['PlusIcon', PlusIcon], ['StarIcon', StarIcon], ['FlagIcon', FlagIcon], ['AnnotationIcon', AnnotationIcon], ['LocationIcon', LocationIcon], ['UserIcon', UserIcon], ['SettingsIcon', SettingsIcon]];

function Section({ id, title, children }) {
  return <section id={id} className="design-library__section"><h2>{title}</h2>{children}</section>;
}

// A sandbox of the application's actual classes, icons, wording and calendar.
// No API client is imported: these controls only change local preview state.
function ToolbarPreview() {
  const [important, setImportant] = useState(false);
  const [more, setMore] = useState(false);
  const [active, setActive] = useState(null);
  const [urgency, setUrgency] = useState(0);
  const [annotation, setAnnotation] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [repeat, setRepeat] = useState(null);
  const [flag, setFlag] = useState(false);
  const toggle = (name) => setActive((current) => current === name ? null : name);
  const toggleMore = () => { setMore((current) => !current); setActive(null); };

  return <div className="task-create-dialog task-create-dialog--inline" aria-label="Пример панели задачи">
    <p className="design-library__sample-label">Нажмите звезду и «+», попробуйте выбрать параметры</p>
    <div className="task-create-dialog__options">
      {active === 'annotation' && <div className="task-create-dialog__description"><textarea aria-label="Текст аннотации в примере" placeholder="Напишите аннотацию" value={annotation} onChange={(event) => setAnnotation(event.target.value)} /></div>}
      <div className={`list-creator__toolbar task-create-toolbar${more ? ' is-more-open' : ''}`}>
        <button type="button" className={`list-option-button task-create-important-button${important ? ' is-selected' : ''}`} aria-pressed={important} aria-label={important ? uiText.task.removeImportant : uiText.task.markImportant} onClick={() => setImportant((current) => !current)}><StarIcon /></button>
        <button type="button" className="list-option-button list-creator__more task-create-more-button" aria-expanded={more} aria-controls="catalog-task-options" aria-label={more ? uiText.task.hideOptions : uiText.task.showOptions} onPointerDown={(event) => { if (event.button === 0) toggleMore(); }} onClick={(event) => { if (event.detail === 0) toggleMore(); }}><PlusIcon /></button>
        <div id="catalog-task-options" className="list-creator__extra-row task-create-menu" inert={!more} aria-hidden={!more} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setActive(null); setMore(false); } }}>
          <div className="task-create-menu__main">
            <div className="task-create-property">
              <button type="button" className={`list-option-button task-create-property-button task-urgency-picker${urgency ? ' is-selected' : ''}`} aria-expanded={active === 'urgency'} onClick={() => toggle('urgency')}><span className="task-urgency-picker__mark">{'!'.repeat(urgency || 1)}</span><span>{uiText.task.urgency}</span></button>
              {active === 'urgency' && <div className="task-urgency-picker__panel" role="group" aria-label="Уровень срочности в примере">{taskUrgencyLevels.map((level) => <button type="button" className={`flag-picker__choice task-urgency-picker__choice is-level-${level.value}${urgency === level.value ? ' is-selected' : ''}`} aria-pressed={urgency === level.value} key={level.value} onClick={() => { setUrgency((current) => current === level.value ? 0 : level.value); setActive(null); }}><span className="task-urgency-picker__mark">{level.mark}</span><span>{level.label}</span></button>)}</div>}
            </div>
            <button type="button" className={`list-option-button task-create-property-button${annotation ? ' is-selected' : ''}`} aria-label={uiText.task.annotation} aria-expanded={active === 'annotation'} onClick={() => toggle('annotation')}><span className="task-create-menu__icon"><AnnotationIcon /></span><span>{uiText.task.annotation}</span></button>
            <div className="task-create-property">
              <button type="button" className={`list-option-button task-create-property-button${location ? ' is-selected' : ''}`} aria-expanded={active === 'location'} onClick={() => toggle('location')}><span className="task-create-menu__icon"><LocationIcon /></span><span>{uiText.task.location}</span></button>
              {active === 'location' && <div className="task-create-menu__field"><input aria-label="Локация в примере" placeholder="Введите локацию" value={location} onChange={(event) => setLocation(event.target.value)} /></div>}
            </div>
          </div>
        </div>
        <div className="flag-picker"><button type="button" className={`list-option-button task-create-property-button${flag ? ' is-selected' : ''}`} aria-label={uiText.task.flag} aria-expanded={false} onClick={() => setFlag((current) => !current)}><FlagIcon color={flag ? 'blue' : undefined} /><span className="flag-picker__selected-label">{uiText.task.flag}</span></button></div>
        <div className="list-creator__date"><ListDatePicker value={date} deadline={deadline} repeat={repeat} open={active === 'date'} onOpenChange={(open) => setActive(open ? 'date' : null)} onChange={(value) => { setDate(value); if (value) setDeadline(null); }} onDeadlineChange={(value) => { setDeadline(value); if (value) setDate(null); }} onRepeatChange={setRepeat} /></div>
      </div>
    </div>
  </div>;
}

export function DesignSystem() {
  const [theme, setTheme] = useState('light');
  const [values, setValues] = useState({});
  const [previewVersion, setPreviewVersion] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectValue, setSelectValue] = useState('Личный аккаунт');
  const [completed, setCompleted] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const style = getComputedStyle(rootRef.current);
    const names = [...palette.map(([name]) => `--workspace-${name}`), ...['accent', 'important', 'motion-menu', 'motion-roll', 'motion-star'].map((name) => `--ui-${name}`)];
    setValues(Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()])));
  }, [theme]);

  return <div ref={rootRef} className="workspace-shell design-library" data-theme={theme}>
    <header className="design-library__header">
      <a className="design-library__brand" href="#principles">To Do Inn! <span>Библиотека дизайна</span></a>
      <div className="design-library__theme" role="group" aria-label="Тема каталога">{[['light', 'Светлая'], ['dark', 'Тёмная']].map(([value, label]) => <button type="button" className={`list-option-button${theme === value ? ' is-selected' : ''}`} aria-pressed={theme === value} onClick={() => setTheme(value)} key={value}>{label}</button>)}</div>
    </header>
    <div className="design-library__layout">
      <nav className="design-library__nav" aria-label="Разделы библиотеки">{sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav>
      <main className="design-library__main">
        <Section id="principles" title="Сначала переиспользуем">
          <p className="design-library__lead">Готовые элементы To Do Inn! Вместо нового оформления выбираем существующий блок и его состояние.</p>
          <div className="design-library__rules"><p><strong>Один источник.</strong> Иконки и тексты импортируются из <code>js/ui/</code>. Цвета и размеры — из <code>scss/_variables.scss</code>. Примеры используют стили приложения.</p><p><strong>Состояния — часть элемента.</strong> Проверяем обычное состояние, hover, нажатие, выбор, фокус и disabled. Звезда жёлтая только после выбора. «+» поворачивается без изменения размера.</p><p><strong>Никаких данных.</strong> Это локальная песочница: кнопки не обращаются к API, не создают и не удаляют записи.</p></div>
        </Section>
        <Section id="colors" title="Цвета и темы">
          <div className="design-library__grid">{palette.map(([name, label]) => <div className="design-library__token" key={name}><div className="design-library__swatch" data-color={name} /><strong>{label}</strong><code>--workspace-{name}</code><span>{values[`--workspace-${name}`]}</span></div>)}</div>
          <div className="design-library__row"><span className="design-library__semantic" data-color="accent">Акцент · {values['--ui-accent']}</span><span className="design-library__semantic" data-color="important">Важное · {values['--ui-important']}</span></div>
          <p className="design-library__caption">Акцент привлекает внимание к действию. Выбранный параметр использует общий нейтральный фон; открытый редактор — синюю рамку. Дедлайн сохраняет свой красный акцент.</p>
        </Section>
        <Section id="type" title="Типографика">
          <p className="design-library__caption">Системный шрифт: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif. Основная высота строки — 1.5.</p>
          <div className="design-library__type-samples">{[['heading', 'Заголовок списка'], ['regular', 'Основной текст интерфейса'], ['body', 'Название задачи'], ['small', 'Подпись кнопки'], ['caption', 'Вспомогательная подпись']].map(([size, label]) => <p data-size={size} key={size}>{label}<code>$type-sizes: {size}</code></p>)}</div>
        </Section>
        <Section id="geometry" title="Отступы и скругления">
          <h3>Отступы</h3><div className="design-library__spacing">{[4, 6, 8, 12, 16, 24, 32, 48].map((size) => <div key={size}><span data-space={size} /><code>{size} px</code></div>)}</div>
          <h3>Скругления</h3><div className="design-library__radii">{[6, 7, 8, 10, 12, 'pill'].map((size) => <div data-radius={size} key={size}><code>{size === 'pill' ? 'pill' : `${size} px`}</code></div>)}</div>
          <p className="design-library__caption">Кнопки создания списка и задачи: высота 36 px, скругление 8 px. SVG иконки: 17 × 17 px.</p>
        </Section>
        <Section id="icons" title="Иконки">
          <div className="design-library__icons">{icons.map(([name, Icon]) => <div key={name}><span><Icon /></span><code>{name}</code></div>)}{['personal', 'community', 'corporate'].map((type) => <div key={type}><span><BoardTypeIcon type={type} /></span><code>BoardTypeIcon · {type}</code></div>)}</div>
          <pre><code>{"import { PlusIcon, StarIcon, FlagIcon } from '../ui/icons.jsx';"}</code></pre>
          <p className="design-library__caption">FlagIcon — общий SVG-флаг. Без выбранного цвета он наследует нейтральный цвет кнопки.</p>
        </Section>
        <Section id="buttons" title="Кнопки и состояния">
          <div className="task-create-dialog task-create-dialog--inline"><div className="task-create-toolbar"><button type="button" className="list-option-button task-create-property-button"><FlagIcon /><span>Обычная</span></button><button type="button" className="list-option-button task-create-property-button is-selected" aria-expanded="false"><FlagIcon color="blue" /><span>Выбрана</span></button><button type="button" className="list-option-button task-create-property-button" aria-expanded="true"><AnnotationIcon /><span>Редактор открыт</span></button><button type="button" className="list-option-button task-create-property-button" disabled><LocationIcon /><span>Недоступна</span></button></div></div>
          <p className="design-library__caption">Наведите указатель или перейдите Tab: hover и клавиатурный фокус работают на настоящих классах приложения. Выбранные параметры не получают точку в углу.</p>
          <pre><code>{'<button type="button" className="list-option-button task-create-property-button is-selected" aria-expanded={false}>…</button>'}</code></pre>
        </Section>
        <Section id="motion" title="Анимации: попробовать руками">
          <ToolbarPreview key={previewVersion} />
          <div className="design-library__row"><button type="button" className="list-option-button" onClick={() => setPreviewVersion((current) => current + 1)}>Сбросить пример</button><span className="design-library__caption">Звезда · {values['--ui-motion-star']}; выкатывание · {values['--ui-motion-roll']}; поворот «+» · {values['--ui-motion-menu']}</span></div>
          <p className="design-library__caption">Кнопки выходят последовательно: 0 / 45 / 90 ms. При нехватке ширины переносятся. При prefers-reduced-motion движение отключается.</p>
        </Section>
        <Section id="blocks" title="Готовые блоки">
          <div className="design-library__blocks">
            <div className="design-library__panel"><h3>Карточка списка</h3><article className="task-list-card" data-theme="blue"><div className="task-list-card__intro"><h2>Работа над проектом</h2><p className="task-list-card__description">Пример текущей карточки и строки задачи.</p></div><ul className="task-list-card__tasks"><li><div className={`task-list-card__task${completed ? ' is-completed' : ''}`}><span className="task-list-card__task-important" aria-label="Важная задача"><StarIcon /></span><span className="task-list-card__task-control"><input type="checkbox" aria-label="Отметить пример задачи выполненным" checked={completed} onChange={(event) => setCompleted(event.target.checked)} /><span className="task-list-card__task-mark" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="m5 10 3.2 3.2L15 6.5" /></svg></span></span><div className="task-list-card__task-content"><div className="task-list-card__task-line"><span className="task-list-card__task-title">{completed ? 'Готово: библиотека интерфейса' : 'Собрать библиотеку интерфейса'}</span></div></div></div></li></ul><span className="task-list-card__flag-tag is-blue">Дизайн</span></article><p className="design-library__caption">Та же звезда и классы строки задачи, что на рабочем экране. Флажок меняет только локальный пример.</p></div>
            <div className="design-library__panel"><h3>Подтверждение действия</h3><button type="button" className="list-option-button" onClick={() => { setNotice(''); setDialogOpen(true); }}>Открыть диалог</button><p className="design-library__caption">Настоящий ListDeleteDialog: Escape, фокус и Tab. Подтверждение здесь только закрывает пример.</p><pre><code>{'import { ListDeleteDialog } from "../workspace/ListDeleteDialog.jsx";'}</code></pre><p role="status">{notice}</p></div>
            <div className="design-library__panel"><h3>Выпадающий список</h3><div className="design-library__auth-sample"><CustomSelect id="catalog-select" label="Тип аккаунта в примере" value={selectValue} options={['Личный аккаунт', 'Командный аккаунт', 'Корпоративный аккаунт']} onChange={setSelectValue} /></div><p className="design-library__caption">Настоящий CustomSelect из регистрации. Сохраняет исходное светлое оформление и управление клавиатурой.</p></div>
            <div className="design-library__panel"><h3>Календарь</h3><p>В панели выше используется настоящий <code>ListDatePicker</code>: дата, дедлайн и повторение.</p><pre><code>{'import { ListDatePicker } from "../workspace/ListDatePicker.jsx";'}</code></pre><p className="design-library__caption">Открытие календаря сохраняет дополнительные параметры панели.</p></div>
          </div>
        </Section>
        <Section id="copy" title="Готовые тексты">
          <p>Один глагол для одного действия. Ожидание — с многоточием «…». Ошибка объясняет следующий шаг.</p>
          {Object.entries(uiText).map(([group, entries]) => <div className="design-library__copy" key={group}><h3>{group}</h3><dl>{Object.entries(entries).map(([name, text]) => <div key={name}><dt><code>uiText.{group}.{name}</code></dt><dd>{text}</dd></div>)}</dl></div>)}
          <pre><code>{"import { uiText } from '../ui/text.js';\n<button type=\"button\">{uiText.actions.save}</button>"}</code></pre>
        </Section>
      </main>
    </div>
    {dialogOpen && <ListDeleteDialog id="catalog-delete-title" title="Удалить пример?" confirmLabel={uiText.actions.delete} busy={false} theme={theme} onClose={() => setDialogOpen(false)} onConfirm={() => { setDialogOpen(false); setNotice('Пример подтверждён. Данные приложения не изменялись.'); }}>Это демонстрация диалога. Никакие данные не будут удалены.</ListDeleteDialog>}
  </div>;
}

// This page is a Vite development entry, deliberately absent from production inputs.
if (import.meta.env.DEV && !import.meta.env.SSR && typeof document !== 'undefined') {
  createRoot(document.getElementById('root')).render(<DesignSystem />);
}
