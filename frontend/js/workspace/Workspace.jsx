import React, { useEffect, useRef, useState } from 'react';
import { createBoard, createTaskList, deleteBoard, deleteTaskList, getProfile, getSession, getWorkspace, searchWorkspace, sendAuthRequest, updateProfile, updateWorkspace } from '../api.js';

const accountTypeLabels = {
  individual: 'Индивидуальный аккаунт',
  team: 'Аккаунт команды',
  corporate: 'Корпоративный аккаунт',
};

const themes = [
  ['blue', 'Синяя тема'],
  ['violet', 'Фиолетовая тема'],
  ['green', 'Зелёная тема'],
  ['amber', 'Янтарная тема'],
  ['rose', 'Розовая тема'],
];

function formatListCreatedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  const dateText = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(date);
  const timeText = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
  return `${dateText} ${timeText}`;
}

function UserIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}

function SettingsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/></svg>;
}

function SlidersIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h7m4 0h5M4 12h3m4 0h9M4 18h9m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/></svg>;
}

function BoardTypeIcon({ type }) {
  if (type === 'community') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M3.5 19v-1.2a5.5 5.5 0 0 1 11 0V19zm13-5a4 4 0 0 1 4 4v1h-4"/></svg>;
  if (type === 'corporate') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V5l8-2v18m0-12h8v12M2 21h20"/><path d="M8 7h.01M8 11h.01M8 15h.01m8-3h.01m0 4h.01"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7.5" r="4"/><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2"/></svg>;
}

function ThemeSwitch({ theme, onChange }) {
  const isDark = theme === 'dark';
  return (
    <button className="theme-toggle" type="button" role="switch" aria-label={isDark ? 'Тёмная тема включена' : 'Светлая тема включена'} aria-checked={isDark} onClick={onChange}>
      <span className="theme-toggle__track" aria-hidden="true">
        <span className="theme-toggle__thumb">
          {isDark ? (
            <svg className="theme-toggle__moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>
          ) : (
            <svg className="theme-toggle__sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
          )}
        </span>
      </span>
    </button>
  );
}

function FlagIcon({ color = 'blue' }) {
  return <span className={`sidebar-flag__icon is-${color}`} aria-hidden="true">⚑</span>;
}

function ListTask({ task, csrfToken, onToggle, onChange, onReorder, animating, draggingTaskId, onDragStart, onDragEnd }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [error, setError] = useState('');
  const [dropTarget, setDropTarget] = useState(false);
  const draggedRef = useRef(false);
  const completed = task.is_completed || animating;

  useEffect(() => setTitle(task.title), [task.title]);

  async function saveTitle() {
    const nextTitle = title.trim();
    setEditing(false);
    if (!nextTitle || nextTitle === task.title) {
      setTitle(task.title);
      return;
    }
    try {
      await updateWorkspace({ action: 'update_task', task_id: task.id, title: nextTitle }, csrfToken);
      setError('');
      await onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  return <li className={`${dropTarget ? 'is-drop-target ' : ''}${draggingTaskId === task.id ? 'is-dragging' : ''}`} onDragOver={(event) => { if (task.is_completed) return; event.preventDefault(); setDropTarget(true); }} onDragLeave={() => setDropTarget(false)} onDrop={(event) => { event.preventDefault(); setDropTarget(false); if (task.is_completed) return; const draggedId = Number(event.dataTransfer.getData('text/plain')); if (draggedId && draggedId !== task.id) onReorder(draggedId, task.id); onDragEnd(); }}>
    <div className={`task-list-card__task${completed ? ' is-completed' : ''}`}>
      <span className="task-list-card__task-control">
        <input type="checkbox" aria-label={`Отметить задачу «${task.title}» выполненной`} checked={task.is_completed || animating} onChange={() => onToggle(task)} />
        <span className="task-list-card__task-mark" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="m5 10 3.2 3.2L15 6.5" /></svg></span>
      </span>
      {editing ? <input className="task-list-card__task-edit" aria-label="Название задачи" autoFocus maxLength="240" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={saveTitle} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { setTitle(task.title); setEditing(false); } }} /> : <span className="task-list-card__task-title" onDoubleClick={() => { if (!completed) { setTitle(task.title); setEditing(true); } }}>{task.title}</span>}
      {!editing && !completed && <button className="task-list-card__task-menu" type="button" draggable="true" aria-label="Перетащить задачу или изменить её название" title="Нажми для переименования, перетащи для сортировки" onClick={() => { if (!draggedRef.current) { setTitle(task.title); setEditing(true); } }} onDragStart={(event) => { draggedRef.current = true; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(task.id)); onDragStart(task.id); }} onDragEnd={() => { onDragEnd(); window.setTimeout(() => { draggedRef.current = false; }, 0); }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>}
    </div>
    {error && <p className="task-list-card__error" role="alert">{error}</p>}
  </li>;
}

function ListCard({ list, tasks, flags, csrfToken, onChange }) {
  const [taskName, setTaskName] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [animatingTasks, setAnimatingTasks] = useState(() => new Set());
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description || '');
  const [cardTheme, setCardTheme] = useState(list.theme);
  const [flagId, setFlagId] = useState(list.flag?.id || '');
  const [newFlagName, setNewFlagName] = useState('');
  const [important, setImportant] = useState(list.is_important);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState('');
  const descriptionRef = useRef(null);
  const cardRef = useRef(null);
  const pending = tasks.filter((task) => !task.is_completed);
  const completed = tasks.filter((task) => task.is_completed);

  useEffect(() => {
    if (!editing || !descriptionRef.current) return;
    descriptionRef.current.style.height = 'auto';
    descriptionRef.current.style.height = `${descriptionRef.current.scrollHeight}px`;
  }, [editing, description]);

  useEffect(() => {
    const card = cardRef.current;
    const grid = card?.parentElement;
    if (!card || !grid || typeof ResizeObserver === 'undefined') return undefined;

    function fitMasonryRow() {
      const styles = window.getComputedStyle(grid);
      const rowHeight = Number.parseFloat(styles.gridAutoRows) || 8;
      const rowGap = Number.parseFloat(styles.rowGap) || 18;
      const span = Math.ceil((card.getBoundingClientRect().height + rowGap) / (rowHeight + rowGap));
      card.style.gridRowEnd = `span ${span}`;
    }

    const observer = new ResizeObserver(fitMasonryRow);
    observer.observe(card);
    fitMasonryRow();
    return () => observer.disconnect();
  }, []);

  async function addTask(event) {
    event.preventDefault();
    if (!taskName.trim()) return;
    try {
      await updateWorkspace({ action: 'create_task', list_id: list.id, title: taskName.trim() }, csrfToken);
      setTaskName('');
      onChange();
    } catch (err) { setError(err.message); }
  }

  async function toggleTask(task) {
    const isCompleting = !task.is_completed;
    if (isCompleting) {
      setAnimatingTasks((current) => new Set(current).add(task.id));
    }
    try {
      await updateWorkspace({ action: 'toggle_task', task_id: task.id, is_completed: !task.is_completed }, csrfToken);
      if (isCompleting) await new Promise((resolve) => window.setTimeout(resolve, 320));
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      if (isCompleting) setAnimatingTasks((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  async function reorderTask(taskId, targetTaskId) {
    try {
      await updateWorkspace({ action: 'reorder_task', task_id: taskId, target_task_id: targetTaskId }, csrfToken);
      await onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveDetails(event) {
    event.preventDefault();
    try {
      const saved = await updateWorkspace({ action: 'update_list', list_id: list.id, name, description, theme: cardTheme, flag_id: flagId || null, new_flag_name: newFlagName.trim(), is_important: important }, csrfToken);
      setFlagId(saved.flag?.id || '');
      setNewFlagName('');
      setEditing(false);
      await onChange();
    } catch (err) { setError(err.message); }
  }

  async function handleDeleteList() {
    setDeleting(true);
    setError('');
    try {
      await deleteTaskList(list.id, csrfToken);
      setConfirmingDelete(false);
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return <>
  <article ref={cardRef} className={`task-list-card${editing ? ' is-editing' : ''}`} data-theme={editing ? cardTheme : list.theme}>
    <header className="task-list-card__header">
      <div className="task-list-card__created">
        {list.is_important && <svg className="task-list-card__important" aria-label="Важный список" role="img" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.4l6.2-.9L12 2.8Z" /></svg>}
        <time dateTime={list.created_at}>{formatListCreatedAt(list.created_at)}</time>
      </div>
      <div className="task-list-card__actions">
      <button className="task-list-card__edit-button" type="button" aria-label="Изменить список" title="Изменить список" onClick={() => setEditing((value) => !value)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
      </button>
      <button className="task-list-card__delete-button" type="button" aria-label="Удалить список" title="Удалить список" onClick={() => setConfirmingDelete(true)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg>
      </button>
      </div>
    </header>
    {editing ? <form onSubmit={saveDetails} className="task-list-card__edit">
      <div className="task-list-card__edit-heading">Настройки списка</div>
      <label className="task-list-card__field"><span>Название</span><input className="task-list-card__title-input" aria-label="Название списка" maxLength="80" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="task-list-card__field"><span>Описание</span><textarea ref={descriptionRef} aria-label="Описание списка" maxLength="2000" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <button className={`list-option-button task-list-card__important-toggle${important ? ' is-selected' : ''}`} type="button" aria-pressed={important} onClick={() => setImportant((value) => !value)}><svg aria-hidden="true" viewBox="0 0 24 24" fill={important ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg><span>Важный список</span></button>
      <fieldset className="task-list-card__theme-field"><legend>Цвет списка</legend><div className="list-theme-picker" role="group" aria-label="Цвет темы списка">{themes.map(([value, label]) => <button className={`list-theme-swatch${cardTheme === value ? ' is-selected' : ''}`} type="button" data-list-theme={value} aria-label={label} aria-pressed={cardTheme === value} key={value} onClick={() => setCardTheme(value)} />)}</div></fieldset>
      <div className="task-list-card__field"><span>Флаг</span><details className="flag-picker task-list-card__flag-picker"><summary className="list-option-button" aria-label="Изменить флаг списка"><FlagIcon color={flags.find((item) => String(item.id) === String(flagId))?.color || 'blue'} /><span>{newFlagName ? 'Новый флаг' : flags.find((item) => String(item.id) === String(flagId))?.name || 'Без флага'}</span><svg className="task-list-card__flag-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg></summary><div className="flag-picker__panel"><p className="flag-picker__title">Выберите флаг</p><button className={`flag-picker__choice${!flagId && !newFlagName ? ' is-selected' : ''}`} type="button" onClick={(event) => { setFlagId(''); setNewFlagName(''); event.currentTarget.closest('details').open = false; }}>Без флага</button>{flags.map((flag) => <button className={`flag-picker__choice${String(flagId) === String(flag.id) && !newFlagName ? ' is-selected' : ''}`} type="button" key={flag.id} onClick={(event) => { setFlagId(flag.id); setNewFlagName(''); event.currentTarget.closest('details').open = false; }}><FlagIcon color={flag.color} /><span>{flag.name}</span></button>)}<label className="flag-picker__custom-label" htmlFor={`edit-flag-name-${list.id}`}>Или создайте новый</label><input className="flag-picker__custom-input" id={`edit-flag-name-${list.id}`} type="text" maxLength="40" placeholder="Название флага" value={newFlagName} onChange={(event) => { setNewFlagName(event.target.value); setFlagId(''); }} /></div></details></div>
      <div className="task-list-card__edit-actions"><button type="button" className="task-list-card__cancel" onClick={() => { setEditing(false); setName(list.name); setDescription(list.description || ''); setCardTheme(list.theme); setFlagId(list.flag?.id || ''); setNewFlagName(''); setImportant(list.is_important); }}>Отмена</button><button type="submit">Сохранить</button></div>
    </form> : <>
      <div className="task-list-card__intro"><div className="task-list-card__title-row"><h2>{list.name}</h2>{list.flag && <span className={`task-list-card__flag is-${list.flag.color}`}><i aria-hidden="true" />{list.flag.name}</span>}</div>{description && <p className="task-list-card__description">{description}</p>}</div>
      <div className="task-list-card__section-label">ЗАДАЧИ</div>
      <ul className="task-list-card__tasks">{pending.map((task) => <ListTask key={task.id} task={task} csrfToken={csrfToken} onToggle={toggleTask} onChange={onChange} onReorder={reorderTask} animating={animatingTasks.has(task.id)} draggingTaskId={draggingTaskId} onDragStart={setDraggingTaskId} onDragEnd={() => setDraggingTaskId(null)} />)}</ul>
      <form className="task-list-card__add" onSubmit={addTask}><input aria-label="Добавить новую задачу" placeholder="Добавить новую задачу" maxLength="240" value={taskName} onChange={(event) => setTaskName(event.target.value)} /><button type="submit" aria-label="Добавить задачу">Добавить</button></form>
      {completed.length > 0 && <footer className="task-list-card__completed"><button type="button" aria-expanded={showDone} onClick={() => setShowDone((value) => !value)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5"/></svg><span className="task-list-card__completed-label">{showDone ? 'Скрыть выполненные' : 'Выполненные'}</span></button>{showDone && <ul className="task-list-card__tasks is-completed">{completed.map((task) => <ListTask key={task.id} task={task} csrfToken={csrfToken} onToggle={toggleTask} onChange={onChange} onReorder={reorderTask} animating={false} draggingTaskId={draggingTaskId} onDragStart={setDraggingTaskId} onDragEnd={() => setDraggingTaskId(null)} />)}</ul>}</footer>}
      {error && <p role="alert" className="task-list-card__error">{error}</p>}
    </>}
  </article>
  {confirmingDelete && <div className="list-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setConfirmingDelete(false); }}>
    <section className="list-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`delete-list-title-${list.id}`}>
      <h2 id={`delete-list-title-${list.id}`}>Удалить список?</h2>
      <p>Вы точно хотите удалить этот список?</p>
      <div className="list-delete-dialog__actions"><button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Отмена</button><button type="button" onClick={handleDeleteList} disabled={deleting}>{deleting ? 'Удаляем…' : 'Удалить'}</button></div>
      {error && <p className="list-delete-dialog__error" role="alert">{error}</p>}
    </section>
  </div>}
  </>;
}

export function Workspace() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('todo-inn-theme') || 'light'; } catch { return 'light'; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [csrfToken, setCsrfToken] = useState('');
  const [account, setAccount] = useState(null);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [board, setBoard] = useState(null);
  const [boards, setBoards] = useState([]);
  const [boardFormOpen, setBoardFormOpen] = useState(false);
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);
  const [editingBoardId, setEditingBoardId] = useState(null);
  const [boardDeleteTarget, setBoardDeleteTarget] = useState(null);
  const [boardDeleteError, setBoardDeleteError] = useState('');
  const [deletingBoard, setDeletingBoard] = useState(false);
  const [boardName, setBoardName] = useState('');
  const [boardDescription, setBoardDescription] = useState('');
  const [boardType, setBoardType] = useState('personal');
  const [boardFormError, setBoardFormError] = useState('');
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [flags, setFlags] = useState([]);
  const [lists, setLists] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [activeListId, setActiveListId] = useState(null);
  const [name, setName] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [important, setImportant] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState('blue');
  const [selectedFlagId, setSelectedFlagId] = useState(null);
  const [newFlagName, setNewFlagName] = useState('');
  const [flagPickerOpen, setFlagPickerOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = 'Рабочее пространство — To Do Inn!';
    document.body.classList.add('workspace-body');
    return () => document.body.classList.remove('workspace-body');
  }, []);

  useEffect(() => {
    try { localStorage.setItem('todo-inn-theme', theme); } catch { /* Theme remains active for this page. */ }
  }, [theme]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    Promise.all([getSession(), getWorkspace()])
      .then(([session, workspace]) => {
        if (!session.user) {
          window.location.replace('/');
          return;
        }
        setAccount(session.user);
        setCsrfToken(session.csrf_token);
        setBoard(workspace.board);
        setBoards(workspace.boards);
        setFlags(workspace.flags);
        setLists(workspace.lists);
        setTasks(workspace.tasks || []);
      })
      .catch(() => window.location.replace('/'));
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearchLoading(false);
      setSearchError('');
      return undefined;
    }

    let active = true;
    setSearchLoading(true);
    setSearchResults(null);
    setSearchError('');
    const timeout = window.setTimeout(() => {
      searchWorkspace(query)
        .then(({ results }) => { if (active) setSearchResults(results); })
        .catch((error) => { if (active) setSearchError(error.message); })
        .finally(() => { if (active) setSearchLoading(false); });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [searchQuery]);

  function updateFilter(value) {
    setFilter(value);
    setMobileMenuOpen(false);
  }

  async function selectBoard(boardId) {
    if (String(boardId) === String(board.id)) return;
    try {
      const workspace = await getWorkspace(boardId);
      setBoard(workspace.board);
      setBoards(workspace.boards);
      setFlags(workspace.flags);
      setLists(workspace.lists);
      setTasks(workspace.tasks || []);
      setFilter('all');
      setActiveListId(null);
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function handleCreateBoard(event) {
    event.preventDefault();
    if (!boardName.trim()) {
      setBoardFormError('Введите название доски.');
      return;
    }
    setCreatingBoard(true);
    setBoardFormError('');
    try {
      const { board: createdBoard } = await createBoard({
        name: boardName.trim(),
        description: boardDescription.trim(),
        board_type: boardType,
      }, csrfToken);
      const workspace = await getWorkspace(createdBoard.id);
      setBoards(workspace.boards);
      setBoard(workspace.board);
      setFlags(workspace.flags);
      setLists(workspace.lists);
      setTasks(workspace.tasks || []);
      setFilter('all');
      setActiveListId(null);
      setSearchQuery('');
      setBoardName('');
      setBoardDescription('');
      setBoardType('personal');
      setBoardFormOpen(false);
    } catch (error) {
      setBoardFormError(error.message);
    } finally {
      setCreatingBoard(false);
    }
  }

  function openBoardSettings(item) {
    setEditingBoardId(item.id);
    setBoardName(item.name);
    setBoardDescription(item.description || '');
    setBoardType(item.board_type || 'personal');
    setBoardFormError('');
    setBoardSettingsOpen(true);
  }

  async function handleUpdateBoard(event) {
    event.preventDefault();
    if (!boardName.trim()) {
      setBoardFormError('Введите название доски.');
      return;
    }
    setCreatingBoard(true);
    setBoardFormError('');
    try {
      const { board: updatedBoard } = await updateWorkspace({
        action: 'update_board',
        board_id: editingBoardId,
        name: boardName.trim(),
        description: boardDescription.trim(),
        board_type: boardType,
      }, csrfToken);
      setBoards((current) => current.map((item) => item.id === updatedBoard.id ? updatedBoard : item));
      if (board.id === updatedBoard.id) setBoard(updatedBoard);
      setBoardSettingsOpen(false);
      setEditingBoardId(null);
    } catch (error) {
      setBoardFormError(error.message);
    } finally {
      setCreatingBoard(false);
    }
  }

  async function handleDeleteBoard() {
    if (!boardDeleteTarget) return;
    setDeletingBoard(true);
    setBoardDeleteError('');
    try {
      const { replacement_board_id: replacementBoardId } = await deleteBoard(boardDeleteTarget.id, csrfToken);
      const remainingBoards = boards.filter((item) => item.id !== boardDeleteTarget.id);
      setBoards(remainingBoards);
      setBoardDeleteTarget(null);
      setBoardSettingsOpen(false);
      setEditingBoardId(null);
      setSearchQuery('');
      if (board.id === boardDeleteTarget.id) {
        const workspace = await getWorkspace(replacementBoardId);
        setBoard(workspace.board);
        setBoards(workspace.boards);
        setFlags(workspace.flags);
        setLists(workspace.lists);
        setTasks(workspace.tasks || []);
        setFilter('all');
        setActiveListId(null);
      }
    } catch (error) {
      setBoardDeleteError(error.message);
    } finally {
      setDeletingBoard(false);
    }
  }

  async function refreshSearchResults() {
    const [{ results }, workspace] = await Promise.all([
      searchWorkspace(searchQuery.trim()),
      getWorkspace(board.id),
    ]);
    setSearchResults(results);
    setFlags(workspace.flags);
    setLists(workspace.lists);
    setTasks(workspace.tasks || []);
  }

  function chooseFlag(id) {
    setSelectedFlagId(id);
    setNewFlagName('');
    setFlagPickerOpen(false);
  }

  function handleNameChange(value) {
    setName(value);
    const hasName = value.trim().length > 0;
    setExpanded(hasName);
    if (!hasName) setFeedback('');
  }

  async function handleCreateList(event) {
    event.preventDefault();
    if (!name.trim()) {
      setFeedback('Введите название списка.');
      return;
    }

    setSaving(true);
    setFeedback('');
    try {
      const { list } = await createTaskList({
        board_id: board.id,
        name: name.trim(),
        is_important: important,
        theme: selectedTheme,
        flag_id: selectedFlagId,
        new_flag_name: newFlagName.trim(),
      }, csrfToken);

      setLists((current) => [...current, list]);
      if (list.flag) {
        setFlags((current) => current.some((flag) => flag.id === list.flag.id)
          ? current
          : [...current, list.flag].sort((first, second) => first.name.localeCompare(second.name, 'ru')));
      }
      setActiveListId(list.id);
      getWorkspace(board.id).then((data) => { setLists(data.lists); setFlags(data.flags); setTasks(data.tasks || []); });
      setName('');
      setExpanded(false);
      setImportant(false);
      setSelectedTheme('blue');
      setSelectedFlagId(null);
      setNewFlagName('');
      setFlagPickerOpen(false);
      setFeedback('');
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    try {
      await sendAuthRequest('logout', {}, csrfToken);
      window.location.assign('/');
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function openProfileSettings() {
    setProfileError('');
    setProfileSettingsOpen(true);
    try {
      const { profile } = await getProfile();
      setAccount(profile);
      setProfileDraft({
        username: profile.username,
        email: profile.email || '',
        secondary_email: profile.secondary_email || '',
        about: profile.about || '',
        account_type: profile.account_type,
        avatar: profile.avatar,
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
      setAvatarChanged(false);
    } catch (error) {
      setProfileError(error.message);
    }
  }

  function handleAvatarFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1_048_576) {
      setProfileError('Размер аватара не должен превышать 1 МБ.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setProfileError('Выберите изображение JPEG, PNG или WebP.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProfileDraft((current) => ({ ...current, avatar: reader.result }));
        setAvatarChanged(true);
        setProfileError('');
      }
    };
    reader.onerror = () => setProfileError('Не удалось прочитать изображение.');
    reader.readAsDataURL(file);
  }

  async function saveProfileSettings(event) {
    event.preventDefault();
    if (!profileDraft) return;
    setProfileSaving(true);
    setProfileError('');
    const data = { ...profileDraft };
    if (!avatarChanged) delete data.avatar;
    try {
      const { profile } = await updateProfile(data, csrfToken);
      setAccount(profile);
      setProfileDraft({
        ...profile,
        email: profile.email || '',
        secondary_email: profile.secondary_email || '',
        avatar: profile.avatar,
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
      setAvatarChanged(false);
      setProfileSettingsOpen(false);
    } catch (error) {
      setProfileError(error.message);
    } finally {
      setProfileSaving(false);
    }
  }

  if (!account || !board) return <div className="app-loading" role="status">Загрузка рабочего пространства…</div>;

  const activeList = lists.find((list) => list.id === activeListId);
  const selectedFlag = flags.find((flag) => flag.id === selectedFlagId);
  const visibleLists = lists.filter((list) => {
    if (filter === 'important') return list.is_important;
    if (filter === 'planned') return false;
    if (filter.startsWith('flag:')) return String(list.flag?.id) === filter.slice(5);
    return true;
  });
  const canChangeUsername = !profileDraft?.username_change_available_at
    || Date.parse(profileDraft.username_change_available_at) <= Date.now();

  return (
    <div className={`workspace-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${mobileMenuOpen ? ' is-mobile-menu-open' : ''}`} data-theme={theme}>
      <header className="workspace-header">
        <div className="workspace-header__left">
          <button className="mobile-menu-toggle" type="button" aria-label={mobileMenuOpen ? 'Закрыть меню фильтров' : 'Открыть меню фильтров'} aria-controls="workspace-sidebar" aria-expanded={mobileMenuOpen} onClick={() => { setSidebarCollapsed(false); setMobileMenuOpen((current) => !current); }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
          <ThemeSwitch theme={theme} onChange={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
          <a className="workspace-brand" href="/pages/workspace.html" aria-label="To Do Inn! — рабочее пространство">
            <span className="workspace-brand__mark" aria-hidden="true">✓</span>
            <span>To Do Inn!</span>
          </a>
        </div>

        <label className="workspace-search">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input type="search" placeholder="Поиск по всем доскам" aria-label="Поиск по всем доскам" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          <span className="workspace-search__shortcut" aria-hidden="true">⌘ K</span>
        </label>

        <details className="profile-menu">
          <summary className="profile-menu__trigger" aria-label="Открыть профиль">
            <span className="profile-menu__avatar" aria-hidden="true">{account.avatar ? <img src={account.avatar} alt="" /> : <UserIcon />}</span>
            <span className="profile-menu__identity">
              <span className="profile-menu__name">{account.username}</span>
              <span className="profile-menu__caption">Личный кабинет</span>
            </span>
            <svg className="profile-menu__chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg>
          </summary>
          <div className="profile-menu__panel">
            <p className="profile-menu__account-type">{accountTypeLabels[account.account_type] || 'Аккаунт'}</p>
            <button className="profile-menu__settings" type="button" onClick={openProfileSettings}><SettingsIcon /><span>Настройки аккаунта</span></button>
            <button className="profile-menu__logout" type="button" onClick={handleLogout}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5m5 5H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg><span>Выйти из аккаунта</span></button>
          </div>
        </details>
      </header>
      {mobileMenuOpen && <button className="mobile-menu-backdrop" type="button" aria-label="Закрыть меню фильтров" onClick={() => setMobileMenuOpen(false)} />}

      <nav className="board-bar" aria-label="Рабочие доски">
        <button className={`sidebar-toggle ${sidebarCollapsed ? 'is-collapsed' : 'is-expanded'}`} type="button" aria-label={sidebarCollapsed ? 'Показать боковую панель' : 'Скрыть боковую панель'} aria-controls="workspace-sidebar" aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Показать боковую панель' : 'Скрыть боковую панель'} onClick={() => setSidebarCollapsed((current) => !current)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M14 9l-3 3 3 3" /></svg></button>
        <button className="board-bar__add" type="button" aria-label="Создать доску" title="Создать доску" onClick={() => { setBoardFormError(''); setBoardFormOpen(true); }}><PlusIcon /></button>
        {boards.map((item) => <div className={`board-tab-group${String(item.id) === String(board.id) ? ' is-active' : ''}`} key={item.id}>
          <button className="board-tab" type="button" aria-current={String(item.id) === String(board.id) ? 'page' : undefined} onClick={() => selectBoard(item.id)}>{item.name}</button>
          <button className="board-tab-settings" type="button" disabled={String(item.id) !== String(board.id)} aria-label={`Настройки доски «${item.name}»`} title="Настройки доски" onClick={() => openBoardSettings(item)}><SlidersIcon /></button>
        </div>)}
      </nav>

      <div className="workspace-layout">
        <aside className="workspace-sidebar" id="workspace-sidebar" aria-label="Фильтры и флаги">
          <header className="workspace-sidebar__mobile-header"><h2>Фильтры</h2><button type="button" aria-label="Закрыть меню" onClick={() => setMobileMenuOpen(false)}>×</button></header>
          <nav className="sidebar-filters" aria-label="Быстрые фильтры">
            <button className={`sidebar-filter${filter === 'all' ? ' is-active' : ''}`} type="button" onClick={() => updateFilter('all')}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 5h16M4 12h16M4 19h16" /></svg><span>Все списки</span>
            </button>
            <button className={`sidebar-filter${filter === 'important' ? ' is-active' : ''}`} type="button" onClick={() => updateFilter('important')}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg><span>Важное</span>
            </button>
            <button className={`sidebar-filter${filter === 'planned' ? ' is-active' : ''}`} type="button" onClick={() => updateFilter('planned')}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg><span>Запланировано</span>
            </button>
          </nav>

          <div className="workspace-sidebar__divider" role="separator" />

          <section className="sidebar-section" aria-labelledby="flags-heading">
            <h2 className="sidebar-section__heading" id="flags-heading">Мои флаги</h2>
            <div className="sidebar-flags">
              {flags.length === 0 && <p className="sidebar-section__empty">Флагов пока нет</p>}
              {flags.map((flag) => (
                <button className={`sidebar-filter sidebar-flag${filter === `flag:${flag.id}` ? ' is-active' : ''}`} type="button" key={flag.id} onClick={() => updateFilter(`flag:${flag.id}`)}>
                  <FlagIcon color={flag.color} /><span>{flag.name}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="workspace-main" aria-label="Рабочая область">
          {!searchQuery.trim() && filter === 'planned' ? <div className="workspace-placeholder" role="status">Эта функция пока в разработке</div> : <>
          {!searchQuery.trim() && <section className="list-creator" aria-label="Создать список">
            <form className={expanded ? 'is-expanded' : ''} onSubmit={handleCreateList}>
              <label className="list-creator__name-field" htmlFor="new-list-name">
                <PlusIcon />
                <input id="new-list-name" name="name" type="text" maxLength="80" placeholder="Новый список" autoComplete="off" aria-label="Название нового списка" value={name} onChange={(event) => handleNameChange(event.target.value)} />
              </label>

              {expanded && (
                <div className="list-creator__options">
                  <div className="list-creator__toolbar">
                    <button className={`list-option-button${important ? ' is-selected' : ''}`} type="button" aria-pressed={important} aria-label={important ? 'Убрать важность списка' : 'Сделать список важным'} title="Важный список" onClick={() => setImportant((current) => !current)}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
                    </button>

                    <details className="flag-picker" open={flagPickerOpen} onToggle={(event) => setFlagPickerOpen(event.currentTarget.open)}>
                      <summary className="list-option-button" aria-label="Назначить флаг" title="Назначить флаг">
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V5m0 0c5-4 9 4 14 0v11c-5 4-9-4-14 0" /></svg>
                        <span>{newFlagName ? 'Новый флаг' : selectedFlag?.name || 'Флаг'}</span>
                      </summary>
                      <div className="flag-picker__panel">
                        <p className="flag-picker__title">Выберите флаг</p>
                        <button className={`flag-picker__choice${selectedFlagId === null && !newFlagName ? ' is-selected' : ''}`} type="button" aria-pressed={selectedFlagId === null && !newFlagName} onClick={() => chooseFlag(null)}>Без флага</button>
                        <div className="flag-picker__existing">
                          {flags.map((flag) => (
                            <button className={`flag-picker__choice${selectedFlagId === flag.id ? ' is-selected' : ''}`} type="button" key={flag.id} aria-pressed={selectedFlagId === flag.id} onClick={() => chooseFlag(flag.id)}>
                              <FlagIcon color={flag.color} /><span>{flag.name}</span>
                            </button>
                          ))}
                        </div>
                        <label className="flag-picker__custom-label" htmlFor="custom-flag-name">Или создайте свой</label>
                        <input className="flag-picker__custom-input" id="custom-flag-name" name="todo-flag-label" type="text" maxLength="40" placeholder="Название флага" autoComplete="off" autoCorrect="off" spellCheck="false" value={newFlagName} onChange={(event) => { setNewFlagName(event.target.value); setSelectedFlagId(null); }} />
                      </div>
                    </details>

                    <div className="list-theme-picker" role="group" aria-label="Цвет темы списка">
                      {themes.map(([value, label]) => (
                        <button className={`list-theme-swatch${selectedTheme === value ? ' is-selected' : ''}`} type="button" data-list-theme={value} aria-label={label} aria-pressed={selectedTheme === value} key={value} onClick={() => setSelectedTheme(value)} />
                      ))}
                    </div>

                    <button className="list-creator__submit" type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Создать'}</button>
                  </div>
                  {feedback && <p className="list-creator__feedback" role="alert">{feedback}</p>}
                </div>
              )}
            </form>
          </section>}

          <section className="workspace-lists" aria-label="Списки">
            {searchQuery.trim() ? <div className="workspace-search-results" aria-live="polite">
              {searchLoading && <p className="workspace-search-results__message">Ищем по доскам…</p>}
              {searchError && <p className="workspace-search-results__message is-error" role="alert">{searchError}</p>}
              {!searchLoading && !searchError && searchResults?.length === 0 && <p className="workspace-search-results__message">Совпадений не найдено</p>}
              {searchResults?.map((result) => <div className="workspace-search-result" data-theme={result.theme} key={`${result.board_id}:${result.id}`}>
                <p className="workspace-search-result__board">{result.board_name}</p>
                <ListCard list={result} tasks={result.tasks} flags={result.flags} csrfToken={csrfToken} onChange={() => refreshSearchResults().catch((error) => setSearchError(error.message))} />
              </div>)}
            </div> : <div className="workspace-lists__items">
              {[...visibleLists].reverse().map((list) => <ListCard key={list.id} list={list} flags={flags} tasks={tasks.filter((task) => task.list_id === list.id)} csrfToken={csrfToken} onChange={() => getWorkspace(board.id).then((data) => { setLists(data.lists); setFlags(data.flags); setTasks(data.tasks || []); })} />)}
            </div>}
          </section>
          </>}
        </main>
      </div>

      <footer className="workspace-footer">
        <span>To Do Inn! <span aria-hidden="true">·</span> Пространство для важных дел</span>
        <a href="https://github.com/Daniar-cmd/To-Do-Inn" target="_blank" rel="noreferrer">О проекте</a>
      </footer>
      {(boardFormOpen || boardSettingsOpen) && <div className="board-form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creatingBoard) { setBoardFormOpen(false); setBoardSettingsOpen(false); } }}>
        <section className="board-form-dialog" role="dialog" aria-modal="true" aria-labelledby="board-form-title">
          <header className="board-form-dialog__header"><h2 id="board-form-title">{boardSettingsOpen ? 'Настройки доски' : 'Новая доска'}</h2><button type="button" aria-label="Закрыть форму" onClick={() => { setBoardFormOpen(false); setBoardSettingsOpen(false); }} disabled={creatingBoard}>×</button></header>
          <form onSubmit={boardSettingsOpen ? handleUpdateBoard : handleCreateBoard}>
            <label className="board-form-dialog__field"><span>Название доски <b aria-hidden="true">*</b></span><input autoFocus required maxLength="60" value={boardName} onChange={(event) => setBoardName(event.target.value)} placeholder="Например, Домашние дела" /></label>
            <label className="board-form-dialog__field"><span>Описание <small>необязательно</small></span><textarea maxLength="2000" value={boardDescription} onChange={(event) => setBoardDescription(event.target.value)} placeholder="Кратко опишите назначение доски" /></label>
            <fieldset className="board-form-dialog__types"><legend>Для кого эта доска?</legend>
              {[
                ['personal', 'Для себя'],
                ['community', 'Для сообщества'],
                ['corporate', 'Корпоративная'],
              ].map(([value, label]) => <label className={`board-form-dialog__type${boardType === value ? ' is-selected' : ''}`} key={value}>
                <input type="radio" name="board-type" value={value} checked={boardType === value} onChange={(event) => setBoardType(event.target.value)} />
                <BoardTypeIcon type={value} />
                <span>{label}</span>
              </label>)}
            </fieldset>
            {boardFormError && <p className="board-form-dialog__error" role="alert">{boardFormError}</p>}
            {boardSettingsOpen && <><button className="board-form-dialog__delete" type="button" onClick={() => { setBoardDeleteError(''); setBoardDeleteTarget(boards.find((item) => item.id === editingBoardId)); }} disabled={creatingBoard || boards.length <= 1}>Удалить доску</button>{boards.length <= 1 && <small className="board-form-dialog__delete-note">Нельзя удалить последнюю доску аккаунта.</small>}</>}
            <div className="board-form-dialog__actions"><button type="button" onClick={() => { setBoardFormOpen(false); setBoardSettingsOpen(false); }} disabled={creatingBoard}>Отмена</button><button type="submit" disabled={creatingBoard}>{creatingBoard ? (boardSettingsOpen ? 'Сохраняем…' : 'Создаём…') : (boardSettingsOpen ? 'Сохранить изменения' : 'Создать доску')}</button></div>
          </form>
        </section>
      </div>}
      {boardDeleteTarget && <div className="board-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingBoard) setBoardDeleteTarget(null); }}>
        <section className="board-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="board-delete-title">
          <h2 id="board-delete-title">Удалить доску?</h2>
          <p>Доска «{boardDeleteTarget.name}», все её списки и задачи будут удалены без возможности восстановления.</p>
          {boardDeleteError && <p className="board-delete-dialog__error" role="alert">{boardDeleteError}</p>}
          <div className="board-delete-dialog__actions"><button type="button" onClick={() => setBoardDeleteTarget(null)} disabled={deletingBoard}>Отмена</button><button type="button" onClick={handleDeleteBoard} disabled={deletingBoard}>{deletingBoard ? 'Удаляем…' : 'Удалить доску'}</button></div>
        </section>
      </div>}
      {profileSettingsOpen && <div className="profile-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !profileSaving) setProfileSettingsOpen(false); }}>
        <section className="profile-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-settings-title">
          <header className="profile-settings-dialog__header"><div><p>АККАУНТ</p><h2 id="profile-settings-title">Настройки профиля</h2></div><button type="button" aria-label="Закрыть настройки" onClick={() => setProfileSettingsOpen(false)} disabled={profileSaving}>×</button></header>
          {!profileDraft ? <p className="profile-settings-dialog__loading" role="status">Загружаем настройки…</p> : <form onSubmit={saveProfileSettings}>
            <section className="profile-settings-dialog__avatar-section" aria-label="Аватар профиля">
              <span className="profile-settings-dialog__avatar">{profileDraft.avatar ? <img src={profileDraft.avatar} alt="Аватар профиля" /> : <UserIcon />}</span>
              <div><strong>Фото профиля</strong><p>JPEG, PNG или WebP, до 1 МБ</p><div className="profile-settings-dialog__avatar-actions"><label className="profile-settings-dialog__file-button">{profileDraft.avatar ? 'Изменить фото' : 'Загрузить фото'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarFile} /></label>{profileDraft.avatar && <button type="button" onClick={() => { setProfileDraft((current) => ({ ...current, avatar: null })); setAvatarChanged(true); }}>Удалить</button>}</div></div>
            </section>
            <label className="profile-settings-dialog__field"><span>Логин</span><input required maxLength="24" pattern="[A-Za-z][A-Za-z0-9_]{2,23}" value={profileDraft.username} disabled={!canChangeUsername} onChange={(event) => setProfileDraft((current) => ({ ...current, username: event.target.value }))} />{!canChangeUsername && <small>Логин можно будет изменить после {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profileDraft.username_change_available_at))}.</small>}<small>Логин также используется для входа.</small></label>
            <div className="profile-settings-dialog__two-columns">
              <label className="profile-settings-dialog__field"><span>Основная почта</span><input type="email" maxLength="254" autoComplete="email" value={profileDraft.email} onChange={(event) => setProfileDraft((current) => ({ ...current, email: event.target.value }))} placeholder="name@example.com" /></label>
              <label className="profile-settings-dialog__field"><span>Дополнительная почта</span><input type="email" maxLength="254" autoComplete="email" value={profileDraft.secondary_email} onChange={(event) => setProfileDraft((current) => ({ ...current, secondary_email: event.target.value }))} placeholder="name@example.com" /></label>
            </div>
            <label className="profile-settings-dialog__field"><span>О себе</span><textarea maxLength="1200" value={profileDraft.about} onChange={(event) => setProfileDraft((current) => ({ ...current, about: event.target.value }))} placeholder="Расскажите немного о себе" /></label>
            <fieldset className="profile-settings-dialog__account-type"><legend>Тип аккаунта</legend><div>{[
              ['individual', 'Личный'], ['team', 'Для команды'], ['corporate', 'Корпоративный'],
            ].map(([value, label]) => <label className={profileDraft.account_type === value ? 'is-selected' : ''} key={value}><input type="radio" name="profile-account-type" value={value} checked={profileDraft.account_type === value} onChange={(event) => setProfileDraft((current) => ({ ...current, account_type: event.target.value }))} /><BoardTypeIcon type={value === 'team' ? 'community' : value} /><span>{label}</span></label>)}</div></fieldset>
            <details className="profile-settings-dialog__password"><summary>Изменить пароль</summary><div className="profile-settings-dialog__password-fields"><label className="profile-settings-dialog__field"><span>Текущий пароль</span><input type="password" autoComplete="current-password" value={profileDraft.current_password} onChange={(event) => setProfileDraft((current) => ({ ...current, current_password: event.target.value }))} /></label><div className="profile-settings-dialog__two-columns"><label className="profile-settings-dialog__field"><span>Новый пароль</span><input type="password" autoComplete="new-password" value={profileDraft.new_password} onChange={(event) => setProfileDraft((current) => ({ ...current, new_password: event.target.value }))} /></label><label className="profile-settings-dialog__field"><span>Повторите новый пароль</span><input type="password" autoComplete="new-password" value={profileDraft.confirm_password} onChange={(event) => setProfileDraft((current) => ({ ...current, confirm_password: event.target.value }))} /></label></div></div></details>
            {profileError && <p className="profile-settings-dialog__error" role="alert">{profileError}</p>}
            <div className="profile-settings-dialog__actions"><button type="button" onClick={() => setProfileSettingsOpen(false)} disabled={profileSaving}>Отмена</button><button type="submit" disabled={profileSaving}>{profileSaving ? 'Сохраняем…' : 'Сохранить настройки'}</button></div>
          </form>}
        </section>
      </div>}
    </div>
  );
}
