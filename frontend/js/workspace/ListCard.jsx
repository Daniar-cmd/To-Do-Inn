import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { deleteTaskList, updateWorkspace } from '../api.js';
import { AnnotationIcon, FlagIcon, LocationIcon, PlusIcon, StarIcon } from '../ui/icons.jsx';
import { listThemes, taskUrgencyLevels, uiText } from '../ui/text.js';
import { ListDatePicker } from './ListDatePicker.jsx';
import { ListDeleteDialog } from './ListDeleteDialog.jsx';
import { ListTask } from './ListTask.jsx';
import { TaskBadges } from './TaskBadges.jsx';
import { formatListDueDate } from './listDate.js';

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

function completedTasksLabel(count) {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  const noun = remainder100 >= 11 && remainder100 <= 14
    ? 'задач'
    : remainder10 === 1 ? 'задача' : remainder10 >= 2 && remainder10 <= 4 ? 'задачи' : 'задач';

  return `Выполнено ${count} ${noun}`;
}

export function ListCard({ list, tasks, flags, csrfToken, onChange, onDeleted, onFlagCreated, onTogglePin, dragHandle, isFullscreen = false }) {
  const [taskName, setTaskName] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskImportant, setTaskImportant] = useState(false);
  const [taskUrgency, setTaskUrgency] = useState(0);
  const [taskUrgencyOpen, setTaskUrgencyOpen] = useState(false);
  const [taskFlagId, setTaskFlagId] = useState('');
  const [taskNewFlagName, setTaskNewFlagName] = useState('');
  const [taskDueDate, setTaskDueDate] = useState(null);
  const [taskLocation, setTaskLocation] = useState('');
  const [taskDeadline, setTaskDeadline] = useState(null);
  const [taskRepeat, setTaskRepeat] = useState(null);
  const [taskLocationOpen, setTaskLocationOpen] = useState(false);
  const [taskDescriptionOpen, setTaskDescriptionOpen] = useState(false);
  const [taskMoreOptionsOpen, setTaskMoreOptionsOpen] = useState(false);
  const [taskFlagOpen, setTaskFlagOpen] = useState(false);
  const [taskDateOpen, setTaskDateOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [taskDeleteTarget, setTaskDeleteTarget] = useState(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [taskDeleteError, setTaskDeleteError] = useState('');
  const [pinning, setPinning] = useState(false);
  const [animatingTasks, setAnimatingTasks] = useState(() => new Set());
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description || '');
  const [cardTheme, setCardTheme] = useState(list.theme);
  const [flagId, setFlagId] = useState(list.flag?.id || '');
  const [newFlagName, setNewFlagName] = useState('');
  const [creatingFlag, setCreatingFlag] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState('');
  const descriptionRef = useRef(null);
  const articleRef = useRef(null);
  const deletingRef = useRef(false);
  const deletingTaskRef = useRef(false);
  const addingTaskRef = useRef(false);
  const pendingToggles = useRef(new Set());
  const savingDetailsRef = useRef(false);
  const [addingTask, setAddingTask] = useState(false);
  const [taskEntryOpen, setTaskEntryOpen] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const taskEntryRef = useRef(null);
  const taskTriggerRef = useRef(null);
  const taskInlineComposerRef = useRef(null);
  const taskOptionsRef = useRef(null);
  const pending = tasks.filter((task) => !task.is_completed);
  const completed = tasks.filter((task) => task.is_completed);
  const draftFlag = taskNewFlagName.trim()
    ? { name: taskNewFlagName.trim(), color: 'blue' }
    : flags.find((flag) => String(flag.id) === String(taskFlagId));

  function resetTaskDraft() {
    setTaskName('');
    setTaskDescription('');
    setTaskImportant(false);
    setTaskUrgency(0);
    setTaskUrgencyOpen(false);
    setTaskFlagId('');
    setTaskNewFlagName('');
    setTaskDueDate(null);
    setTaskLocation('');
    setTaskDeadline(null);
    setTaskRepeat(null);
    setTaskLocationOpen(false);
    setTaskDescriptionOpen(false);
    setTaskMoreOptionsOpen(false);
    setTaskFlagOpen(false);
    setTaskDateOpen(false);
  }

  function closeTaskPropertyPopovers(except = null) {
    const keepOptionsOpen = ['options', 'urgency', 'annotation', 'location', 'flag', 'date'].includes(except);
    if (!keepOptionsOpen) setTaskMoreOptionsOpen(false);
    if (except !== 'urgency') setTaskUrgencyOpen(false);
    if (except !== 'location') setTaskLocationOpen(false);
    if (except !== 'flag') setTaskFlagOpen(false);
    if (except !== 'date') setTaskDateOpen(false);
  }

  function toggleTaskOptions() {
    const open = !taskMoreOptionsOpen;
    closeTaskPropertyPopovers(open ? 'options' : null);
    setTaskMoreOptionsOpen(open);
  }

  function closeTaskComposer() {
    if (addingTaskRef.current) return;
    setTaskEntryOpen(false);
    resetTaskDraft();
  }

  useEffect(() => {
    if (!taskEntryOpen) return undefined;
    const body = document.body;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    const mobileOverlay = !isFullscreen && window.matchMedia('(max-width: 700px)').matches;
    const scrollTop = window.scrollY;
    if (!isFullscreen) {
      body.style.overflow = 'hidden';
      if (mobileOverlay) {
        body.style.position = 'fixed';
        body.style.top = `-${scrollTop}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
      }
    }
    taskEntryRef.current?.focus({ preventScroll: true });
    function closeOnEscape(event) {
      if (event.key === 'Escape' && !addingTaskRef.current) {
        event.preventDefault();
        closeTaskComposer();
      }
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (!isFullscreen) {
        Object.assign(body.style, previous);
        if (mobileOverlay) window.scrollTo(0, scrollTop);
      }
      if (taskTriggerRef.current?.isConnected) taskTriggerRef.current.focus({ preventScroll: true });
    };
  }, [taskEntryOpen, isFullscreen]);

  useEffect(() => {
    if (!taskMoreOptionsOpen && !taskFlagOpen && !taskDateOpen) return undefined;
    function closeTaskOptions(event) {
      if (taskOptionsRef.current?.contains(event.target)) return;
      closeTaskPropertyPopovers();
    }
    document.addEventListener('pointerdown', closeTaskOptions);
    return () => document.removeEventListener('pointerdown', closeTaskOptions);
  }, [taskMoreOptionsOpen, taskFlagOpen, taskDateOpen]);

  useEffect(() => {
    if (editing) return;
    setName(list.name);
    setDescription(list.description || '');
    setCardTheme(list.theme);
    setFlagId(list.flag?.id || '');
    setNewFlagName('');
  }, [editing, list.name, list.description, list.theme, list.flag?.id]);

  useEffect(() => {
    if (!editing || !descriptionRef.current) return;
    descriptionRef.current.style.height = 'auto';
    descriptionRef.current.style.height = `${descriptionRef.current.scrollHeight}px`;
  }, [editing, description]);

  async function addTask(event) {
    event.preventDefault();
    if (!taskName.trim() || addingTaskRef.current) return;
    addingTaskRef.current = true;
    setAddingTask(true);
    try {
      const result = await updateWorkspace({
        action: 'create_task', list_id: list.id, title: taskName.trim(),
        description: taskDescription.trim(), is_important: taskImportant, urgency: taskUrgency,
        flag_id: taskFlagId || null, new_flag_name: taskNewFlagName.trim(), due_date: taskDueDate,
        location: taskLocation.trim() || null, deadline: taskDeadline, repeat_interval: taskRepeat,
      }, csrfToken);
      if (result.task.flag) onFlagCreated({ ...result.task.flag, board_id: list.board_id });
      resetTaskDraft();
      setTaskEntryOpen(false);
      await onChange();
    } catch (err) { setError(err.message); }
    finally { addingTaskRef.current = false; setAddingTask(false); }
  }

  async function toggleTask(task) {
    if (pendingToggles.current.has(task.id)) return;
    pendingToggles.current.add(task.id);
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
      pendingToggles.current.delete(task.id);
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
    if (savingDetailsRef.current) return;
    savingDetailsRef.current = true;
    setSavingDetails(true);
    setError('');
    try {
      const saved = await updateWorkspace({ action: 'update_list', list_id: list.id, name, description, theme: cardTheme, flag_id: flagId || null, new_flag_name: newFlagName.trim(), is_important: list.is_important }, csrfToken);
      setFlagId(saved.flag?.id || '');
      setNewFlagName('');
      setEditing(false);
      await onChange();
    } catch (err) { setError(err.message); }
    finally { savingDetailsRef.current = false; setSavingDetails(false); }
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
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError('');
    try {
      await deleteTaskList(list.id, csrfToken);
      setConfirmingDelete(false);
      onDeleted(list);
      await onChange();
    } catch (err) {
      if (err.status === 404 && err.isApiError) {
        setConfirmingDelete(false);
        onDeleted(list, true);
        await onChange();
      } else {
        setError(err.message);
      }
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  async function handleDeleteTask() {
    if (!taskDeleteTarget || deletingTaskRef.current) return;
    deletingTaskRef.current = true;
    setDeletingTask(true);
    setTaskDeleteError('');
    try {
      await updateWorkspace({ action: 'delete_task', task_id: taskDeleteTarget.id }, csrfToken);
      setTaskDeleteTarget(null);
      await onChange();
    } catch (err) {
      setTaskDeleteError(err.message);
    } finally {
      deletingTaskRef.current = false;
      setDeletingTask(false);
    }
  }

  async function handleTogglePin() {
    setPinning(true);
    setError('');
    try {
      await onTogglePin(list, !list.is_pinned);
    } catch (err) {
      setError(err.message);
    } finally {
      setPinning(false);
    }
  }

  return <>
  <article ref={articleRef} className={`task-list-card${editing ? ' is-editing' : ''}${list.is_pinned ? ' is-pinned' : ''}`} data-theme={editing ? cardTheme : list.theme}>
    <header className="task-list-card__header">
      {dragHandle && !editing && <button className={`task-list-card__drag-handle${list.is_pinned ? ' is-disabled' : ''}`} type="button" aria-label={list.is_pinned ? 'Список закреплён' : `Переместить список «${list.name}»`} title={list.is_pinned ? 'Сначала открепите список' : 'Перетащить список'} disabled={dragHandle.disabled} aria-disabled={list.is_pinned} onPointerDown={dragHandle.onPointerDown} onDragStart={(event) => event.preventDefault()}><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>}
      <div className="task-list-card__created">
          {list.is_important && <span className="task-list-card__important-badge" role="img" aria-label="Важный список"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3-1.1-6.3L3 9.4l6.2-.9L12 2.8Z" /></svg></span>}
         <time dateTime={list.created_at}>{formatListCreatedAt(list.created_at)}</time>
      </div>
      <div className="task-list-card__actions">
      {dragHandle?.onOpen && <button className="task-list-card__open-button" type="button" aria-label={`Открыть список «${list.name}»`} title="Открыть список" onClick={dragHandle.onOpen}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/><path d="M8 8h8v8H8z"/></svg>
      </button>}
      <button className={`task-list-card__pin-button${list.is_pinned ? ' is-pinned' : ''}`} type="button" aria-label={list.is_pinned ? 'Открепить список' : 'Закрепить список'} aria-pressed={list.is_pinned} title={list.is_pinned ? 'Открепить список' : 'Закрепить список'} disabled={pinning || dragHandle?.locked} onClick={handleTogglePin}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3h8l-1 5 3 3v2H6v-2l3-3-1-5Z"/><path d="M12 13v8"/></svg>
      </button>
      <button className="task-list-card__edit-button" type="button" aria-label="Изменить список" title="Изменить список" disabled={savingDetails} onClick={() => setEditing((value) => !value)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
      </button>
      </div>
    </header>
    {editing ? <form onSubmit={saveDetails} className="task-list-card__edit">
      <label className="task-list-card__field"><span>Название</span><input className="task-list-card__title-input" aria-label="Название списка" maxLength="80" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="task-list-card__field"><span>Описание</span><textarea ref={descriptionRef} aria-label="Описание списка" maxLength="2000" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="task-list-card__edit-toolbar">
        <div className="list-theme-picker" role="group" aria-label="Цвет темы списка">{listThemes.map(([value, label]) => <button className={`list-theme-swatch${cardTheme === value ? ' is-selected' : ''}`} type="button" data-list-theme={value} aria-label={label} aria-pressed={cardTheme === value} key={value} onClick={() => setCardTheme(value)} />)}</div>
      </div>
      <div className="task-list-card__field"><span>Флаг</span><details className="flag-picker task-list-card__flag-picker"><summary className="list-option-button" aria-label="Изменить флаг списка"><FlagIcon color={newFlagName.trim() ? 'blue' : flags.find((item) => String(item.id) === String(flagId))?.color} /><span>{newFlagName ? 'Новый флаг' : flags.find((item) => String(item.id) === String(flagId))?.name || 'Без флага'}</span><svg className="task-list-card__flag-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg></summary><div className="flag-picker__panel"><p className="flag-picker__title">Выберите флаг</p><button className={`flag-picker__choice${!flagId && !newFlagName ? ' is-selected' : ''}`} type="button" onClick={(event) => { setFlagId(''); setNewFlagName(''); event.currentTarget.closest('details').open = false; }}><span className="flag-picker__empty-icon" aria-hidden="true" />Без флага</button>{flags.map((flag) => <button className={`flag-picker__choice${String(flagId) === String(flag.id) && !newFlagName ? ' is-selected' : ''}`} type="button" key={flag.id} onClick={(event) => { setFlagId(flag.id); setNewFlagName(''); event.currentTarget.closest('details').open = false; }}><FlagIcon color={flag.color} /><span>{flag.name}</span></button>)}<label className="flag-picker__custom-label" htmlFor={`edit-flag-name-${list.id}`}>Или создайте новый</label><div className="flag-picker__create-row"><input className="flag-picker__custom-input" id={`edit-flag-name-${list.id}`} type="text" maxLength="40" placeholder="Название флага" value={newFlagName} onChange={(event) => { setNewFlagName(event.target.value); setFlagId(''); }} />{newFlagName.trim() && <button className="flag-picker__create-button" type="button" aria-label="Создать флаг" title="Создать флаг" disabled={creatingFlag} onClick={createFlag}><PlusIcon /></button>}</div></div></details></div>
      {error && <p className="task-list-card__error" role="alert">{error}</p>}
      <button type="button" className="task-list-card__delete-list" disabled={savingDetails} onClick={() => setConfirmingDelete(true)}>Удалить список</button>
      <div className="task-list-card__edit-actions"><button type="button" className="task-list-card__cancel" disabled={savingDetails} onClick={() => setEditing(false)}>Отмена</button><button type="submit" disabled={savingDetails}>{savingDetails ? 'Сохраняем…' : 'Сохранить'}</button></div>
    </form> : <>
       <div className="task-list-card__intro"><div className="task-list-card__title-row"><h2>{list.name}</h2></div>{(list.flag || list.due_date) && <div className="task-list-card__meta-tags">{list.flag && <span className={`task-list-card__flag-tag is-${list.flag.color}`}>{list.flag.name}</span>}{list.due_date && <time className="task-list-card__due-date" dateTime={list.due_date}>{formatListDueDate(list.due_date)}</time>}</div>}{list.description && <p className="task-list-card__description">{list.description}</p>}</div>
          <div className={`task-list-card__composer-anchor${taskEntryOpen && isFullscreen ? ' is-expanded' : ''}`}>
            <form className="task-list-card__add" onSubmit={addTask}><input ref={taskTriggerRef} aria-label="Добавить новую задачу" placeholder="Добавить новую задачу" maxLength="240" value={taskName} disabled={addingTask} onClick={() => setTaskEntryOpen(true)} onChange={(event) => { setTaskName(event.target.value); if (event.target.value) setTaskEntryOpen(true); }} /><button type="submit" aria-label="Добавить задачу" disabled={addingTask}>Добавить</button></form>
            {isFullscreen && <div ref={taskInlineComposerRef} className={`task-list-card__inline-composer${taskEntryOpen ? ' is-open' : ''}`} />}
         </div>
       {pending.length > 0 && <div className="task-list-card__section-label">ЗАДАЧИ</div>}
        <ul data-list-id={list.id} data-board-id={list.board_id} className={`task-list-card__tasks${completed.length === 0 ? ' has-no-completed' : ''}`}>{pending.map((task) => <ListTask key={task.id} task={task} csrfToken={csrfToken} onToggle={toggleTask} onChange={onChange} onReorder={reorderTask} onDelete={() => { setTaskDeleteTarget(task); setTaskDeleteError(''); }} animating={animatingTasks.has(task.id)} nativeDrag={!dragHandle || isFullscreen} isFullscreen={isFullscreen} />)}</ul>
       {completed.length > 0 && <footer className="task-list-card__completed"><button type="button" aria-expanded={showDone} onClick={() => setShowDone((value) => !value)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5"/></svg><span className="task-list-card__completed-label">{completedTasksLabel(completed.length)}</span></button>{showDone && <ul className="task-list-card__tasks is-completed">{completed.map((task) => <ListTask key={task.id} task={task} csrfToken={csrfToken} onToggle={toggleTask} onChange={onChange} onReorder={reorderTask} onDelete={() => { setTaskDeleteTarget(task); setTaskDeleteError(''); }} animating={false} nativeDrag={!dragHandle || isFullscreen} isFullscreen={isFullscreen} />)}</ul>}</footer>}
      {error && <p role="alert" className="task-list-card__error">{error}</p>}
    </>}
  </article>
  {taskEntryOpen && createPortal(<div className={isFullscreen ? 'task-create-overlay is-inline' : 'workspace-shell task-create-overlay'} data-theme={articleRef.current?.closest('.workspace-shell')?.dataset.theme || 'light'} onMouseDown={(event) => {
    if (event.target === event.currentTarget) closeTaskComposer();
  }}>
    <form className={`task-create-dialog${isFullscreen ? ' task-create-dialog--inline' : ''}`} role="dialog" aria-modal={isFullscreen ? undefined : true} aria-label="Добавить новую задачу" onSubmit={addTask} onKeyDown={(event) => {
      if (event.key === 'Tab') {
        if (isFullscreen) return;
        const controls = [...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
          .filter((control) => control.getClientRects().length > 0
            && (!control.closest('details:not([open])') || control.tagName === 'SUMMARY'));
        const index = controls.indexOf(document.activeElement);
        if (event.shiftKey && index === 0) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
      }
    }}>
      {!isFullscreen && <h2 className="task-create-dialog__mobile-title">Новая задача</h2>}
      <div className="task-create-dialog__name-row">
        <button className="task-create-close" type="button" aria-label="Закрыть создание задачи" title="Закрыть" disabled={addingTask} onClick={closeTaskComposer}><PlusIcon /></button>
         <div className="task-create-dialog__inline-field">
            <span className="task-create-dialog__input-wrap"><span className="task-create-dialog__input-measure" aria-hidden="true">{taskName ? `${taskName} ` : 'Что нужно сделать?'}</span><input ref={taskEntryRef} aria-label="Название новой задачи" placeholder="Что нужно сделать?" enterKeyHint="done" maxLength="240" value={taskName} disabled={addingTask} onChange={(event) => setTaskName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /></span>
           <TaskBadges flag={draftFlag} dueDate={taskDueDate} deadline={taskDeadline} urgency={taskUrgency} location={taskLocation.trim()} />
         </div>
         <button className="task-create-dialog__submit" type="submit" aria-label="Добавить задачу" disabled={addingTask || !taskName.trim()}><span className="task-create-dialog__submit-label">{addingTask ? 'Добавляем…' : 'Добавить'}</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L19 7" /></svg></button>
      </div>
      <div ref={taskOptionsRef} className="task-create-dialog__options">
         {taskDescriptionOpen && <div id={`task-annotation-${list.id}`} className="task-create-dialog__description"><textarea rows="2" aria-label="Текст аннотации" maxLength="2000" placeholder="Напишите аннотацию" value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} /></div>}
          <div className={`list-creator__toolbar task-create-toolbar${taskMoreOptionsOpen ? ' is-more-open' : ''}`}>
          <button className={`list-option-button task-create-important-button${taskImportant ? ' is-selected' : ''}`} type="button" aria-label={taskImportant ? uiText.task.removeImportant : uiText.task.markImportant} title="Важная задача" aria-pressed={taskImportant} onClick={() => setTaskImportant((value) => !value)}>
            <StarIcon />
          </button>
          <button className="list-option-button list-creator__more task-create-more-button" type="button" aria-label={taskMoreOptionsOpen ? uiText.task.hideOptions : uiText.task.showOptions} aria-expanded={taskMoreOptionsOpen} aria-controls={`task-options-${list.id}`} onPointerDown={(event) => {
            if (event.button === 0) toggleTaskOptions();
          }} onClick={(event) => {
            // Pointer presses already toggle on down; keyboard/assistive clicks toggle here.
            if (!event || event.detail === 0) toggleTaskOptions();
          }}><PlusIcon /></button>
           <div id={`task-options-${list.id}`} className={`list-creator__extra-row task-create-menu${taskUrgencyOpen ? ' is-urgency-open' : ''}`} inert={!taskMoreOptionsOpen} aria-hidden={!taskMoreOptionsOpen} onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            if (taskUrgencyOpen) {
              setTaskUrgencyOpen(false);
              taskOptionsRef.current?.querySelector('.task-urgency-picker')?.focus();
            } else if (taskLocationOpen) {
              closeTaskPropertyPopovers('options');
              taskOptionsRef.current?.querySelector('[aria-label="Локация"]')?.focus();
            } else {
              setTaskMoreOptionsOpen(false);
              taskOptionsRef.current?.querySelector('.task-create-more-button')?.focus();
            }
          }}>
            <div className="task-create-menu__main">
              <div className="task-create-property">
               <button className={`list-option-button task-create-property-button task-urgency-picker${taskUrgency ? ` is-selected is-level-${taskUrgency}` : ''}`} type="button" aria-label={uiText.task.chooseUrgency} title={uiText.task.urgency} aria-pressed={taskUrgency > 0} aria-expanded={taskUrgencyOpen} aria-controls={`task-urgency-${list.id}`} onClick={() => {
                const open = !taskUrgencyOpen;
                closeTaskPropertyPopovers(open ? 'urgency' : 'options');
                setTaskUrgencyOpen(open);
              }}><span className="task-urgency-picker__mark">{taskUrgencyLevels[taskUrgency - 1]?.mark || '!'}</span><span>Срочность</span><svg className="task-urgency-picker__chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg></button>
              {taskUrgencyOpen && <div id={`task-urgency-${list.id}`} className="task-urgency-picker__panel" role="group" aria-label="Уровень срочности">
                {taskUrgencyLevels.map((level) => <button className={`flag-picker__choice task-urgency-picker__choice is-level-${level.value}${taskUrgency === level.value ? ' is-selected' : ''}`} type="button" key={level.value} aria-pressed={taskUrgency === level.value} onClick={() => { setTaskUrgency((current) => current === level.value ? 0 : level.value); setTaskUrgencyOpen(false); taskOptionsRef.current?.querySelector('.task-urgency-picker')?.focus(); }}><span className="task-urgency-picker__mark">{level.mark}</span><span>{level.label}</span></button>)}
            </div>}
              </div>
                <button className={`list-option-button task-create-property-button task-create-menu__toggle${taskDescriptionOpen ? ' is-open' : ''}${taskDescription.trim() ? ' is-selected' : ''}`} type="button" aria-label="Аннотация" title="Аннотация" aria-expanded={taskDescriptionOpen} aria-controls={`task-annotation-${list.id}`} onClick={() => {
                const open = !taskDescriptionOpen;
                closeTaskPropertyPopovers(open ? 'annotation' : 'options');
                setTaskDescriptionOpen(open);
              }}><span className="task-create-menu__icon"><AnnotationIcon /></span><span>Аннотация</span></button>
              <div className="task-create-property">
                <button className={`list-option-button task-create-property-button task-create-menu__toggle${taskLocationOpen ? ' is-open' : ''}${taskLocation.trim() ? ' is-selected' : ''}`} type="button" aria-label="Локация" title="Локация" aria-expanded={taskLocationOpen} aria-controls={`task-location-${list.id}`} onClick={() => {
                const open = !taskLocationOpen;
                closeTaskPropertyPopovers(open ? 'location' : 'options');
                setTaskLocationOpen(open);
              }}><span className="task-create-menu__icon"><LocationIcon /></span><span className="task-create-menu__label">Локация</span><svg className="task-create-menu__chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg></button>
              {taskLocationOpen && <div id={`task-location-${list.id}`} className="task-create-menu__field"><input aria-label="Указать локацию" maxLength="160" placeholder="Введите локацию" value={taskLocation} onChange={(event) => setTaskLocation(event.target.value)} /></div>}
              </div>
            </div>
          </div>
           <div className={`flag-picker${taskFlagOpen ? ' is-open' : ''}`} onKeyDown={(event) => {
             if (event.key !== 'Escape' || !taskFlagOpen) return;
             event.preventDefault();
             event.stopPropagation();
             setTaskFlagOpen(false);
             event.currentTarget.querySelector('.task-create-property-button')?.focus();
           }}>
             <button className={`list-option-button task-create-property-button${taskFlagId || taskNewFlagName.trim() ? ' is-selected' : ''}`} type="button" aria-label="Назначить флаг задаче" title={draftFlag?.name || 'Флаг задачи'} aria-expanded={taskFlagOpen} aria-controls={`task-flags-${list.id}`} onClick={() => {
               closeTaskPropertyPopovers('flag');
               setTaskFlagOpen((open) => !open);
             }}><FlagIcon color={draftFlag?.color} /><span className="flag-picker__selected-label">{draftFlag?.name || 'Флаг'}</span></button>
             <div id={`task-flags-${list.id}`} className="flag-picker__panel" hidden={!taskFlagOpen}>
              <p className="flag-picker__title">Выберите флаг</p>
               <button className={`flag-picker__choice${!taskFlagId && !taskNewFlagName ? ' is-selected' : ''}`} type="button" aria-pressed={!taskFlagId && !taskNewFlagName} onClick={() => { setTaskFlagId(''); setTaskNewFlagName(''); setTaskFlagOpen(false); }}>Без флага</button>
               <div className="flag-picker__existing">{flags.map((flag) => <button className={`flag-picker__choice${String(taskFlagId) === String(flag.id) && !taskNewFlagName ? ' is-selected' : ''}`} type="button" key={flag.id} aria-pressed={String(taskFlagId) === String(flag.id) && !taskNewFlagName} onClick={() => { setTaskFlagId(flag.id); setTaskNewFlagName(''); setTaskFlagOpen(false); }}><FlagIcon color={flag.color} /><span>{flag.name}</span></button>)}</div>
               {flags.length === 0 && <p className="task-create-flag-empty">Флагов пока нет — создайте первый ниже.</p>}
              <label className="flag-picker__custom-label" htmlFor={`task-flag-name-${list.id}`}>Или создайте свой</label>
               <div className="flag-picker__create-row"><input className="flag-picker__custom-input" id={`task-flag-name-${list.id}`} maxLength="40" placeholder="Название флага" value={taskNewFlagName} onChange={(event) => { setTaskNewFlagName(event.target.value); setTaskFlagId(''); }} /></div>
            </div>
           </div>
          <div className="list-creator__date"><ListDatePicker value={taskDueDate} open={taskDateOpen} onOpenChange={(open) => {
            if (open) closeTaskPropertyPopovers('date');
            setTaskDateOpen(open);
           }} onChange={(date) => { setTaskDueDate(date); if (date) setTaskDeadline(null); }} deadline={taskDeadline} onDeadlineChange={(date) => { setTaskDeadline(date); if (date) setTaskDueDate(null); }} repeat={taskRepeat} onRepeatChange={setTaskRepeat} label="Дата" /></div>
         </div>
      </div>
    </form>
    {error && <p className="task-create-error" role="alert">{error}</p>}
  </div>, isFullscreen ? taskInlineComposerRef.current || document.body : document.body)}
  {confirmingDelete && <ListDeleteDialog id={`delete-list-title-${list.id}`} title="Удалить список?" error={error} busy={deleting} confirmLabel="Удалить" onClose={() => setConfirmingDelete(false)} onConfirm={handleDeleteList} theme={articleRef.current?.closest('.workspace-shell')?.dataset.theme}>
    Вы точно хотите удалить этот список?
  </ListDeleteDialog>}
  {taskDeleteTarget && <ListDeleteDialog id={`delete-task-title-${taskDeleteTarget.id}`} title="Удалить выполненную задачу?" error={taskDeleteError} busy={deletingTask} confirmLabel="Удалить задачу" onClose={() => setTaskDeleteTarget(null)} onConfirm={handleDeleteTask} theme={articleRef.current?.closest('.workspace-shell')?.dataset.theme}>
    «{taskDeleteTarget.title}» будет удалена без возможности восстановления. Удалённые задачи не учитываются в продуктивности и общем количестве выполненных задач.
  </ListDeleteDialog>}
  </>;
}
