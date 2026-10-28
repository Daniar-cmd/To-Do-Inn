import React, { useEffect, useRef, useState } from 'react';
import { createBoard, createTaskList, deleteBoard, deleteTaskList, getProfile, getSession, getWorkspace, searchWorkspace, sendAuthRequest, updateProfile, updateWorkspace } from '../api.js';
import { NotificationsMenu } from '../NotificationsMenu.jsx';
import brandLogo from '../../../logos/ToDo-Inn-logo.svg';

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
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.28 7.28 0 0 0-1.63-.94l-.36-2.54A.49.49 0 0 0 13.89 2h-3.78a.49.49 0 0 0-.49.42l-.36 2.54c-.59.23-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54a.49.49 0 0 0 .49.42h3.78a.49.49 0 0 0 .49-.42l.36-2.54c.59-.23 1.13-.55 1.63-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" /></svg>;
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

function ListCard({ list, tasks, flags, csrfToken, onChange, onFlagCreated }) {
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
  const [creatingFlag, setCreatingFlag] = useState(false);
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

  async function createFlag(event) {
    event.preventDefault();
    const trimmedName = newFlagName.trim();
    if (!trimmedName) return;
    const details = event.currentTarget.closest('details');
    setCreatingFlag(true);
    setError('');
    try {
      const { flag } = await updateWorkspace({ action: 'create_flag', board_id: list.board_id, name: trimmedName }, csrfToken);
      onFlagCreated(flag);
      setFlagId(flag.id);
      setNewFlagName('');
      details.open = false;
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingFlag(false);
    }
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
        {list.flag && <span className={`task-list-card__flag-mark is-${list.flag.color}`} data-tooltip={list.flag.name} title={list.flag.name} aria-label={`Флаг: ${list.flag.name}`} role="img" tabIndex="0"><FlagIcon color={list.flag.color} /></span>}
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
      <label className="task-list-card__field"><span>Название</span><input className="task-list-card__title-input" aria-label="Название списка" maxLength="80" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="task-list-card__field"><span>Описание</span><textarea ref={descriptionRef} aria-label="Описание списка" maxLength="2000" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="task-list-card__edit-toolbar">
        <button className={`list-option-button${important ? ' is-selected' : ''}`} type="button" aria-pressed={important} aria-label={important ? 'Убрать важность списка' : 'Сделать список важным'} title="Важный список" onClick={() => setImportant((value) => !value)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill={important ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
        </button>
        <div className="list-theme-picker" role="group" aria-label="Цвет темы списка">{themes.map(([value, label]) => <button className={`list-theme-swatch${cardTheme === value ? ' is-selected' : ''}`} type="button" data-list-theme={value} aria-label={label} aria-pressed={cardTheme === value} key={value} onClick={() => setCardTheme(value)} />)}</div>
      </div>
      <div className="task-list-card__field"><span>Флаг</span><details className="flag-picker task-list-card__flag-picker"><summary className="list-option-button" aria-label="Изменить флаг списка">{flagId && <FlagIcon color={flags.find((item) => String(item.id) === String(flagId))?.color || 'blue'} />}<span>{newFlagName ? 'Новый флаг' : flags.find((item) => String(item.id) === String(flagId))?.name || 'Без флага'}</span><svg className="task-list-card__flag-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg></summary><div className="flag-picker__panel"><p className="flag-picker__title">Выберите флаг</p><button className={`flag-picker__choice${!flagId && !newFlagName ? ' is-selected' : ''}`} type="button" onClick={(event) => { setFlagId(''); setNewFlagName(''); event.currentTarget.closest('details').open = false; }}><span className="flag-picker__empty-icon" aria-hidden="true" />Без флага</button>{flags.map((flag) => <button className={`flag-picker__choice${String(flagId) === String(flag.id) && !newFlagName ? ' is-selected' : ''}`} type="button" key={flag.id} onClick={(event) => { setFlagId(flag.id); setNewFlagName(''); event.currentTarget.closest('details').open = false; }}><FlagIcon color={flag.color} /><span>{flag.name}</span></button>)}<label className="flag-picker__custom-label" htmlFor={`edit-flag-name-${list.id}`}>Или создайте новый</label><div className="flag-picker__create-row"><input className="flag-picker__custom-input" id={`edit-flag-name-${list.id}`} type="text" maxLength="40" placeholder="Название флага" value={newFlagName} onChange={(event) => { setNewFlagName(event.target.value); setFlagId(''); }} />{newFlagName.trim() && <button className="flag-picker__create-button" type="button" aria-label="Создать флаг" title="Создать флаг" disabled={creatingFlag} onClick={createFlag}><PlusIcon /></button>}</div></div></details></div>
      {error && <p className="task-list-card__error" role="alert">{error}</p>}
      <div className="task-list-card__edit-actions"><button type="button" className="task-list-card__cancel" onClick={() => { setEditing(false); setName(list.name); setDescription(list.description || ''); setCardTheme(list.theme); setFlagId(list.flag?.id || ''); setNewFlagName(''); setImportant(list.is_important); }}>Отмена</button><button type="submit">Сохранить</button></div>
    </form> : <>
      <div className="task-list-card__intro"><div className="task-list-card__title-row"><h2>{list.name}</h2></div>{description && <p className="task-list-card__description">{description}</p>}</div>
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
  const [registrationArrival, setRegistrationArrival] = useState(() => {
    try { return window.sessionStorage.getItem('todo-inn-registration-arrival') === '1'; } catch { return false; }
  });
  const [themePreference, setThemePreference] = useState(() => {
    try { return localStorage.getItem('todo-inn-theme') || 'system'; } catch { return 'system'; }
  });
  const [systemTheme, setSystemTheme] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const theme = themePreference === 'system' ? systemTheme : themePreference;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [csrfToken, setCsrfToken] = useState('');
  const [account, setAccount] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationError, setNotificationError] = useState('');
  const [notificationBusyId, setNotificationBusyId] = useState(null);
  const [legacyUpdateRequired, setLegacyUpdateRequired] = useState(false);
  const [legacyNoticeDismissed, setLegacyNoticeDismissed] = useState(false);
  const [workspaceLoadError, setWorkspaceLoadError] = useState('');
  const activeBoardId = useRef(null);
  const workspaceRequestId = useRef(0);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [board, setBoard] = useState(null);
  const [boards, setBoards] = useState([]);
  const [corporateAccounts, setCorporateAccounts] = useState([]);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteAccountId, setInviteAccountId] = useState('');
  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const [inviteRole, setInviteRole] = useState('admin');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviting, setInviting] = useState(false);
  const [boardFormOpen, setBoardFormOpen] = useState(false);
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);
  const [editingBoardId, setEditingBoardId] = useState(null);
  const [boardDeleteTarget, setBoardDeleteTarget] = useState(null);
  const [boardDeleteError, setBoardDeleteError] = useState('');
  const [deletingBoard, setDeletingBoard] = useState(false);
  const [boardName, setBoardName] = useState('');
  const [boardDescription, setBoardDescription] = useState('');
  const [boardType, setBoardType] = useState('personal');
  const [boardCorporateAccountId, setBoardCorporateAccountId] = useState('');
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
  const [creatingFlag, setCreatingFlag] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = 'Рабочее пространство — To Do Inn!';
    document.body.classList.add('workspace-body');
    return () => document.body.classList.remove('workspace-body');
  }, []);

  useEffect(() => {
    if (!registrationArrival) return undefined;
    try { window.sessionStorage.removeItem('todo-inn-registration-arrival'); } catch { /* Transition is an enhancement only. */ }
    const timer = window.setTimeout(() => setRegistrationArrival(false), 850);
    return () => window.clearTimeout(timer);
  }, [registrationArrival]);

  useEffect(() => {
    function closeOpenMenus(event) {
      document.querySelectorAll('details[open]').forEach((details) => {
        if (!details.contains(event.target)) details.open = false;
      });
    }
    document.addEventListener('click', closeOpenMenus);
    return () => document.removeEventListener('click', closeOpenMenus);
  }, []);

  useEffect(() => {
    try { localStorage.setItem('todo-inn-theme', themePreference); } catch { /* Theme remains active for this page. */ }
  }, [themePreference]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const updateSystemTheme = (event) => setSystemTheme(event.matches ? 'dark' : 'light');
    updateSystemTheme(media);
    media.addEventListener?.('change', updateSystemTheme);
    return () => media.removeEventListener?.('change', updateSystemTheme);
  }, []);

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
    getSession()
      .then(async (session) => {
        if (!session.user) {
          window.location.replace('/');
          return;
        }

        // The auth session intentionally contains only public identity fields; load the full
        // profile here so a persisted avatar appears in the header after page reloads.
        const [profileData, defaultWorkspace] = await Promise.all([getProfile(), getWorkspace()]);
        const lastBoardStorageKey = `todo-inn-last-board-${session.user.id}`;
        let rememberedBoardId = null;
        try {
          rememberedBoardId = window.localStorage.getItem(lastBoardStorageKey);
        } catch { /* Restore the default board when browser storage is unavailable. */ }
        const rememberedBoardExists = rememberedBoardId
          && defaultWorkspace.boards.some((item) => String(item.id) === rememberedBoardId);
        const workspace = rememberedBoardExists && String(defaultWorkspace.board.id) !== rememberedBoardId
          ? await getWorkspace(rememberedBoardId)
          : defaultWorkspace;
        activeBoardId.current = String(workspace.board.id);
        try {
          window.localStorage.setItem(lastBoardStorageKey, String(workspace.board.id));
        } catch { /* Board selection remains active for this page. */ }
        setAccount(profileData.profile);
        setThemePreference(profileData.profile.preferred_theme || 'system');
        setCsrfToken(session.csrf_token);
        sendAuthRequest('legacy_account_status', {}, session.csrf_token)
          .then((status) => setLegacyUpdateRequired(status.required === true))
          .catch(() => {});
        setBoard(workspace.board);
        setBoards(workspace.boards);
        setCorporateAccounts(workspace.corporate_accounts || []);
        setFlags(workspace.flags);
        setLists(workspace.lists);
        setTasks(workspace.tasks || []);
      })
      .catch((error) => setWorkspaceLoadError(error.message));
  }, []);

  useEffect(() => {
    if (!csrfToken) return undefined;
    let active = true;
    sendAuthRequest('get_notifications', {}, csrfToken)
      .then((data) => { if (active) setNotifications(data.notifications || []); })
      .catch((error) => { if (active) setNotificationError(error.message); });
    return () => { active = false; };
  }, [csrfToken]);

  async function markNotificationRead(notification) {
    if (notification.is_read || notificationBusyId !== null) return;
    setNotificationBusyId(notification.id);
    setNotificationError('');
    try {
      await sendAuthRequest('mark_notification_read', { notification_id: notification.id }, csrfToken);
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
    } catch (error) {
      setNotificationError(error.message);
    } finally {
      setNotificationBusyId(null);
    }
  }

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
    const requestId = ++workspaceRequestId.current;
    activeBoardId.current = String(boardId);
    if (String(boardId) === String(board.id)) return;
    try {
      const workspace = await getWorkspace(boardId);
      if (requestId !== workspaceRequestId.current) return;
      setBoard(workspace.board);
      try {
        if (account?.id) window.localStorage.setItem(`todo-inn-last-board-${account.id}`, String(workspace.board.id));
      } catch { /* Board selection remains active for this page. */ }
      setBoards(workspace.boards);
      setCorporateAccounts(workspace.corporate_accounts || []);
      setFlags(workspace.flags);
      setLists(workspace.lists);
      setTasks(workspace.tasks || []);
      setFilter('all');
      setActiveListId(null);
    } catch (error) {
      if (requestId === workspaceRequestId.current) {
        activeBoardId.current = String(board.id);
        setFeedback(error.message);
      }
    }
  }

  async function refreshBoardData(boardId) {
    if (String(activeBoardId.current) !== String(boardId)) return;
    const requestId = ++workspaceRequestId.current;
    try {
      const workspace = await getWorkspace(boardId);
      if (requestId !== workspaceRequestId.current || String(activeBoardId.current) !== String(boardId)) return;
      setLists(workspace.lists);
      setFlags(workspace.flags);
      setTasks(workspace.tasks || []);
    } catch (error) {
      if (requestId === workspaceRequestId.current && String(activeBoardId.current) === String(boardId)) {
        setFeedback(error.message);
      }
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
        ...(boardType === 'corporate' ? { corporate_account_id: Number(boardCorporateAccountId) } : {}),
      }, csrfToken);
      const workspace = await getWorkspace(createdBoard.id);
      activeBoardId.current = String(workspace.board.id);
      setBoards(workspace.boards);
      setCorporateAccounts(workspace.corporate_accounts || []);
      setBoard(workspace.board);
      try {
        if (account?.id) window.localStorage.setItem(`todo-inn-last-board-${account.id}`, String(workspace.board.id));
      } catch { /* Board selection remains active for this page. */ }
      setFlags(workspace.flags);
      setLists(workspace.lists);
      setTasks(workspace.tasks || []);
      setFilter('all');
      setActiveListId(null);
      setSearchQuery('');
      setBoardName('');
      setBoardDescription('');
      setBoardType('personal');
      setBoardCorporateAccountId('');
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
    setBoardCorporateAccountId(item.corporate_account_id ? String(item.corporate_account_id) : '');
    setBoardFormError('');
    setBoardSettingsOpen(true);
  }

  async function handleInviteMember(event) {
    event.preventDefault();
    if (!inviteIdentifier.trim() || !inviteAccountId || inviting) return;
    setInviting(true);
    setInviteMessage('');
    try {
      const result = await updateWorkspace({
        action: 'invite_member',
        corporate_account_id: Number(inviteAccountId),
        identifier: inviteIdentifier.trim(),
        role: inviteRole,
      }, csrfToken);
      setInviteMessage(result.email_sent ? 'Приглашение отправлено.' : 'Приглашение создано, но письмо не отправилось.');
      if (result.email_sent) setInviteIdentifier('');
    } catch (error) {
      setInviteMessage(error.message);
    } finally {
      setInviting(false);
    }
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
        activeBoardId.current = String(workspace.board.id);
        setBoard(workspace.board);
        try {
          if (account?.id) window.localStorage.setItem(`todo-inn-last-board-${account.id}`, String(workspace.board.id));
        } catch { /* Board selection remains active for this page. */ }
        setBoards(workspace.boards);
        setCorporateAccounts(workspace.corporate_accounts || []);
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

  function addCreatedFlag(flag) {
    const appendUnique = (current) => current.some((item) => String(item.id) === String(flag.id))
      ? current
      : [...current, flag].sort((first, second) => first.name.localeCompare(second.name, 'ru'));
    if (String(activeBoardId.current) === String(flag.board_id)) {
      setFlags(appendUnique);
    }
    setSearchResults((current) => current?.map((result) => String(result.board_id) === String(flag.board_id)
      ? { ...result, flags: appendUnique(result.flags) }
      : result) ?? null);
  }

  async function createFlagForNewList(event) {
    event.preventDefault();
    const trimmedName = newFlagName.trim();
    if (!trimmedName) return;
    const details = event.currentTarget.closest('details');
    setCreatingFlag(true);
    setFeedback('');
    try {
      const { flag } = await updateWorkspace({ action: 'create_flag', board_id: board.id, name: trimmedName }, csrfToken);
      addCreatedFlag(flag);
      setSelectedFlagId(flag.id);
      setNewFlagName('');
      setFlagPickerOpen(false);
      if (details) details.open = false;
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setCreatingFlag(false);
    }
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
      setName('');
      setExpanded(false);
      setImportant(false);
      setSelectedTheme('blue');
      setSelectedFlagId(null);
      setNewFlagName('');
      setFlagPickerOpen(false);
      setFeedback('');
      void refreshBoardData(board.id);
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
    setProfileDraft(null);
    setProfileSettingsOpen(true);
    try {
      const { profile } = await getProfile();
      setAccount(profile);
      setProfileDraft({
        username: profile.username,
        email: profile.email || '',
        secondary_email: profile.secondary_email || '',
        about: profile.about || '',
        github_url: profile.github_url || '',
        telegram_url: profile.telegram_url || '',
        preferred_theme: profile.preferred_theme || 'system',
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
      setThemePreference(profile.preferred_theme || 'system');
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

  if (!account || !board) {
    return <div className="app-loading" role={workspaceLoadError ? 'alert' : 'status'}>
      {workspaceLoadError
        ? <><p>{workspaceLoadError}</p><button type="button" onClick={() => window.location.reload()}>Повторить</button></>
        : 'Загрузка рабочего пространства…'}
    </div>;
  }

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
  const manageableCorporateAccounts = corporateAccounts.filter((item) => item.role === 'owner');
  const canManageBoard = (item) => !item.corporate_account_id
    || corporateAccounts.some((organization) => organization.id === item.corporate_account_id && organization.role === 'owner');

  return (
    <div className={`workspace-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${mobileMenuOpen ? ' is-mobile-menu-open' : ''}${registrationArrival ? ' is-registration-arrival' : ''}`} data-theme={theme}>
      <header className="workspace-header">
        <div className="workspace-header__left">
          <button className="mobile-menu-toggle" type="button" aria-label={mobileMenuOpen ? 'Закрыть меню фильтров' : 'Открыть меню фильтров'} aria-controls="workspace-sidebar" aria-expanded={mobileMenuOpen} onClick={() => { setSidebarCollapsed(false); setMobileMenuOpen((current) => !current); }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
          <ThemeSwitch theme={theme} onChange={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')} />
        </div>

        <label className="workspace-search">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input type="search" placeholder="Поиск по всем доскам" aria-label="Поиск по всем доскам" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
        </label>

        <div className="workspace-header__right">
          <NotificationsMenu notifications={notifications} unreadCount={notifications.filter((item) => !item.is_read).length} onRead={markNotificationRead} busyId={notificationBusyId} error={notificationError} />

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
        </div>
      </header>
      {legacyUpdateRequired && !legacyNoticeDismissed && <aside className="legacy-update-notice" role="status">
        <button className="legacy-update-notice__close" type="button" aria-label="Закрыть предупреждение" onClick={() => setLegacyNoticeDismissed(true)}>×</button>
        <h2>Обновите данные!</h2>
        <p>С 1 ноября 2026 года мы прекращаем поддержку старых аккаунтов. Пройдите регистрацию заново, чтобы сохранить доступ. Ваши доски, списки и задачи останутся на месте.</p>
        <a className="legacy-update-notice__action" href="/pages/register.html?upgrade=1">Обновить</a>
      </aside>}
      {mobileMenuOpen && <button className="mobile-menu-backdrop" type="button" aria-label="Закрыть меню фильтров" onClick={() => setMobileMenuOpen(false)} />}

      <nav className="board-bar" aria-label="Рабочие доски">
        <button className={`sidebar-toggle ${sidebarCollapsed ? 'is-collapsed' : 'is-expanded'}`} type="button" aria-label={sidebarCollapsed ? 'Показать боковую панель' : 'Скрыть боковую панель'} aria-controls="workspace-sidebar" aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Показать боковую панель' : 'Скрыть боковую панель'} onClick={() => setSidebarCollapsed((current) => !current)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M14 9l-3 3 3 3" /></svg></button>
        <button className="board-bar__add" type="button" aria-label="Создать доску" title="Создать доску" onClick={() => { setBoardFormError(''); setBoardType('personal'); setBoardCorporateAccountId(String(manageableCorporateAccounts[0]?.id || '')); setBoardFormOpen(true); }}><PlusIcon /></button>
        {manageableCorporateAccounts.length > 0 && <button className="board-bar__invite" type="button" onClick={() => {
          setInviteAccountId(String(manageableCorporateAccounts[0].id));
          setInviteIdentifier('');
          setInviteMessage('');
          setInviteDialogOpen(true);
        }}>Пригласить участника</button>}
        {boards.map((item) => <div className={`board-tab-group${String(item.id) === String(board.id) ? ' is-active' : ''}`} key={item.id}>
          <button className="board-tab" type="button" aria-current={String(item.id) === String(board.id) ? 'page' : undefined} onClick={() => selectBoard(item.id)}>{item.name}</button>
          {canManageBoard(item) && <button className="board-tab-settings" type="button" disabled={String(item.id) !== String(board.id)} aria-label={`Настройки доски «${item.name}»`} title="Настройки доски" onClick={() => openBoardSettings(item)}><SettingsIcon /></button>}
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
                <input id="new-list-name" name="todo-list-title" type="text" maxLength="80" placeholder="Новый список" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck="false" aria-label="Название нового списка" value={name} onChange={(event) => handleNameChange(event.target.value)} />
              </label>

              {expanded && (
                <div className="list-creator__options">
                  <div className="list-creator__toolbar">
                    <button className={`list-option-button${important ? ' is-selected' : ''}`} type="button" aria-pressed={important} aria-label={important ? 'Убрать важность списка' : 'Сделать список важным'} title="Важный список" onClick={() => setImportant((current) => !current)}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
                    </button>

                    <details className="flag-picker" open={flagPickerOpen} onToggle={(event) => setFlagPickerOpen(event.currentTarget.open)}>
                      <summary className="list-option-button" aria-label="Назначить флаг" title="Назначить флаг">
                        <FlagIcon color={selectedFlag?.color || 'blue'} />
                        <span className="flag-picker__selected-label">{newFlagName ? 'Новый флаг' : selectedFlag?.name || 'Флаг'}</span>
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
                        <div className="flag-picker__create-row"><input className="flag-picker__custom-input" id="custom-flag-name" name="todo-flag-label" type="text" maxLength="40" placeholder="Название флага" autoComplete="off" autoCorrect="off" spellCheck="false" value={newFlagName} onChange={(event) => { setNewFlagName(event.target.value); setSelectedFlagId(null); }} />{newFlagName.trim() && <button className="flag-picker__create-button" type="button" aria-label="Создать флаг" title="Создать флаг" disabled={creatingFlag} onClick={createFlagForNewList}><PlusIcon /></button>}</div>
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
                <ListCard list={result} tasks={result.tasks} flags={result.flags} csrfToken={csrfToken} onChange={() => refreshSearchResults().catch((error) => setSearchError(error.message))} onFlagCreated={addCreatedFlag} />
              </div>)}
            </div> : <div className="workspace-lists__items">
              {[...visibleLists].reverse().map((list) => <ListCard key={list.id} list={list} flags={flags} tasks={tasks.filter((task) => task.list_id === list.id)} csrfToken={csrfToken} onChange={() => refreshBoardData(board.id)} onFlagCreated={addCreatedFlag} />)}
            </div>}
          </section>
          </>}
        </main>
      </div>

      <footer className="workspace-footer">
        <span className="workspace-footer__brand"><img className="workspace-footer__logo" src={brandLogo} alt="To Do Inn!" /><span aria-hidden="true">·</span> Пространство для важных дел</span>
        <a href="https://github.com/Daniar-cmd/To-Do-Inn" target="_blank" rel="noreferrer">О проекте</a>
      </footer>
      {(boardFormOpen || boardSettingsOpen) && <div className="board-form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creatingBoard) { setBoardFormOpen(false); setBoardSettingsOpen(false); } }}>
        <section className="board-form-dialog" role="dialog" aria-modal="true" aria-labelledby="board-form-title">
          <header className="board-form-dialog__header"><h2 id="board-form-title">{boardSettingsOpen ? 'Настройки доски' : 'Новая доска'}</h2><button type="button" aria-label="Закрыть форму" onClick={() => { setBoardFormOpen(false); setBoardSettingsOpen(false); }} disabled={creatingBoard}>×</button></header>
          <form onSubmit={boardSettingsOpen ? handleUpdateBoard : handleCreateBoard}>
            <label className="board-form-dialog__field"><span>Название доски <b aria-hidden="true">*</b></span><input autoFocus required maxLength="60" value={boardName} onChange={(event) => setBoardName(event.target.value)} placeholder="Например, Домашние дела" /></label>
            <label className="board-form-dialog__field"><span>Описание <small>необязательно</small></span><textarea maxLength="2000" value={boardDescription} onChange={(event) => setBoardDescription(event.target.value)} placeholder="Кратко опишите назначение доски" /></label>
            <fieldset className="board-form-dialog__types type-choice-grid"><legend>Для кого эта доска?</legend>
              {[
                ['personal', 'Личный'],
                ['community', 'Для команды'],
                ...(manageableCorporateAccounts.length > 0 && (!boardSettingsOpen || Boolean(boards.find((item) => item.id === editingBoardId)?.corporate_account_id)) ? [['corporate', 'Организации']] : []),
              ].map(([value, label]) => <label className={`board-form-dialog__type type-choice${boardType === value ? ' is-selected' : ''}`} key={value}>
                <input type="radio" name="board-type" value={value} checked={boardType === value} onChange={(event) => { setBoardType(event.target.value); if (event.target.value === 'corporate' && !boardCorporateAccountId) setBoardCorporateAccountId(String(manageableCorporateAccounts[0]?.id || '')); }} />
                <BoardTypeIcon type={value} />
                <span>{label}</span>
              </label>)}
            </fieldset>
            {boardType === 'corporate' && <label className="board-form-dialog__field"><span>Организация</span><select value={boardCorporateAccountId || String(manageableCorporateAccounts[0]?.id || '')} onChange={(event) => setBoardCorporateAccountId(event.target.value)} required>{manageableCorporateAccounts.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}</select></label>}
            {boardFormError && <p className="board-form-dialog__error" role="alert">{boardFormError}</p>}
            {boardSettingsOpen && <><button className="board-form-dialog__delete" type="button" onClick={() => { setBoardDeleteError(''); setBoardDeleteTarget(boards.find((item) => item.id === editingBoardId)); }} disabled={creatingBoard || boards.length <= 1}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-.9 14H5.9L5 6m4 4v6m6-6v6" /></svg><span>Удалить доску</span></button>{boards.length <= 1 && <small className="board-form-dialog__delete-note">Нельзя удалить последнюю доску аккаунта.</small>}</>}
            <div className="board-form-dialog__actions"><button type="button" onClick={() => { setBoardFormOpen(false); setBoardSettingsOpen(false); }} disabled={creatingBoard}>Отмена</button><button type="submit" disabled={creatingBoard}>{creatingBoard ? (boardSettingsOpen ? 'Сохраняем…' : 'Создаём…') : (boardSettingsOpen ? 'Сохранить изменения' : 'Создать доску')}</button></div>
          </form>
        </section>
      </div>}
      {inviteDialogOpen && <div className="board-form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !inviting) setInviteDialogOpen(false); }}>
        <section className="board-form-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-member-title">
          <header className="board-form-dialog__header"><h2 id="invite-member-title">Пригласить участника</h2><button type="button" aria-label="Закрыть форму" onClick={() => setInviteDialogOpen(false)} disabled={inviting}>×</button></header>
          <form onSubmit={handleInviteMember}>
            {manageableCorporateAccounts.length > 1 && <label className="board-form-dialog__field"><span>Организация</span><select value={inviteAccountId} onChange={(event) => setInviteAccountId(event.target.value)}>{manageableCorporateAccounts.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}</select></label>}
            <label className="board-form-dialog__field"><span>Логин или e-mail</span><input autoFocus required maxLength="254" value={inviteIdentifier} onChange={(event) => setInviteIdentifier(event.target.value)} placeholder="@username или name@example.com" /></label>
            <label className="board-form-dialog__field"><span>Роль</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="admin">admin</option><option value="manager">manager</option><option value="support">support</option></select></label>
            {inviteMessage && <p className="board-form-dialog__error" role="status">{inviteMessage}</p>}
            <div className="board-form-dialog__actions"><button type="button" onClick={() => setInviteDialogOpen(false)} disabled={inviting}>Закрыть</button><button type="submit" disabled={inviting}>{inviting ? 'Отправляем…' : 'Отправить приглашение'}</button></div>
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
          {!profileDraft && !profileError && <p className="profile-settings-dialog__loading" role="status">Загружаем настройки…</p>}
          {profileError && !profileDraft && <p className="profile-settings-dialog__error" role="alert">{profileError}</p>}
          {profileDraft && <form onSubmit={saveProfileSettings}>
            <section className="profile-settings-dialog__avatar-section" aria-label="Аватар профиля">
              <span className="profile-settings-dialog__avatar">{profileDraft.avatar ? <img src={profileDraft.avatar} alt="Аватар профиля" /> : <UserIcon />}</span>
              <div><strong>Фото профиля</strong><p>JPEG, PNG или WebP, до 1 МБ</p><div className="profile-settings-dialog__avatar-actions"><label className="profile-settings-dialog__file-button">{profileDraft.avatar ? 'Изменить фото' : 'Загрузить фото'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarFile} /></label>{profileDraft.avatar && <button type="button" onClick={() => { setProfileDraft((current) => ({ ...current, avatar: null })); setAvatarChanged(true); }}>Удалить</button>}</div></div>
            </section>
            <label className="profile-settings-dialog__field"><span>Логин</span><input required maxLength="24" pattern="(?:[A-Za-z][A-Za-z0-9_@-]{3,23}|@[A-Za-z][A-Za-z0-9_-]{2,22})" value={profileDraft.username} disabled={!canChangeUsername} onChange={(event) => setProfileDraft((current) => ({ ...current, username: event.target.value }))} />{!canChangeUsername && <small>Логин можно будет изменить после {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profileDraft.username_change_available_at))}.</small>}<small>Логин также используется для входа.</small></label>
            <div className="profile-settings-dialog__two-columns">
              <label className="profile-settings-dialog__field"><span>Основная почта</span><input type="email" maxLength="254" autoComplete="email" value={profileDraft.email} onChange={(event) => setProfileDraft((current) => ({ ...current, email: event.target.value }))} placeholder="name@example.com" /></label>
              <label className="profile-settings-dialog__field"><span>Дополнительная почта</span><input type="email" maxLength="254" autoComplete="email" value={profileDraft.secondary_email} onChange={(event) => setProfileDraft((current) => ({ ...current, secondary_email: event.target.value }))} placeholder="name@example.com" /></label>
            </div>
            <label className="profile-settings-dialog__field"><span>О себе</span><textarea maxLength="1200" value={profileDraft.about} onChange={(event) => setProfileDraft((current) => ({ ...current, about: event.target.value }))} placeholder="Расскажите немного о себе" /></label>
            <label className="profile-settings-dialog__field"><span>GitHub</span><span className="profile-settings-social"><svg className="is-github" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.08c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.61 1.21 3.25.93.1-.72.39-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.06 1.15a10.6 10.6 0 0 1 5.57 0c2.12-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.12 2.96.71.78 1.14 1.78 1.14 3.01 0 4.29-2.62 5.23-5.11 5.5.4.35.75 1.03.75 2.08v3.09c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z"/></svg><input type="url" maxLength="255" value={profileDraft.github_url} onChange={(event) => setProfileDraft((current) => ({ ...current, github_url: event.target.value }))} placeholder="https://github.com/username" /></span></label>
            <label className="profile-settings-dialog__field"><span>Telegram</span><span className="profile-settings-social"><svg className="is-telegram" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.7 3.3 18.5 20c-.24 1.18-.87 1.47-1.76.91l-4.86-3.58-2.35 2.26c-.26.26-.48.48-.98.48l.35-4.94 8.99-8.12c.39-.35-.08-.55-.6-.2L6.17 13.87l-4.8-1.5c-1.04-.33-1.06-1.04.22-1.55L20.38 3.1c.86-.32 1.61.2 1.33.2Z"/></svg><input type="url" maxLength="255" value={profileDraft.telegram_url} onChange={(event) => setProfileDraft((current) => ({ ...current, telegram_url: event.target.value }))} placeholder="https://t.me/username" /></span></label>
            <label className="profile-settings-dialog__field"><span>Тема по умолчанию</span><select value={profileDraft.preferred_theme} onChange={(event) => setProfileDraft((current) => ({ ...current, preferred_theme: event.target.value }))}><option value="light">Светлая</option><option value="dark">Тёмная</option><option value="system">Как в системе</option></select></label>
            <fieldset className="profile-settings-dialog__account-type type-choice-grid"><legend>Тип аккаунта</legend><div>{[
              ['individual', 'Личный'], ['team', 'Для команды'], ['corporate', 'Корпоративный'],
            ].map(([value, label]) => <label className={`type-choice${profileDraft.account_type === value ? ' is-selected' : ''}`} key={value}><input type="radio" name="profile-account-type" value={value} checked={profileDraft.account_type === value} onChange={(event) => setProfileDraft((current) => ({ ...current, account_type: event.target.value }))} /><BoardTypeIcon type={value === 'team' ? 'community' : value} /><span>{label}</span></label>)}</div></fieldset>
            <details className="profile-settings-dialog__password"><summary>Изменить пароль</summary><div className="profile-settings-dialog__password-fields"><label className="profile-settings-dialog__field"><span>Текущий пароль</span><input type="password" autoComplete="current-password" value={profileDraft.current_password} onChange={(event) => setProfileDraft((current) => ({ ...current, current_password: event.target.value }))} /></label><div className="profile-settings-dialog__two-columns"><label className="profile-settings-dialog__field"><span>Новый пароль</span><input type="password" autoComplete="new-password" value={profileDraft.new_password} onChange={(event) => setProfileDraft((current) => ({ ...current, new_password: event.target.value }))} /></label><label className="profile-settings-dialog__field"><span>Повторите новый пароль</span><input type="password" autoComplete="new-password" value={profileDraft.confirm_password} onChange={(event) => setProfileDraft((current) => ({ ...current, confirm_password: event.target.value }))} /></label></div></div></details>
            {profileError && <p className="profile-settings-dialog__error" role="alert">{profileError}</p>}
            <div className="profile-settings-dialog__actions"><button type="button" onClick={() => setProfileSettingsOpen(false)} disabled={profileSaving}>Отмена</button><button type="submit" disabled={profileSaving}>{profileSaving ? 'Сохраняем…' : 'Сохранить настройки'}</button></div>
          </form>}
        </section>
      </div>}
    </div>
  );
}
