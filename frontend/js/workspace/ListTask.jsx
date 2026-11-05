import React, { useEffect, useRef, useState } from 'react';
import { updateWorkspace } from '../api.js';
import { StarIcon } from '../ui/icons.jsx';
import { ListDeleteDialog } from './ListDeleteDialog.jsx';
import { TaskBadges } from './TaskBadges.jsx';

export function ListTask({ task, csrfToken, onToggle, onChange, onReorder, onDelete, animating, nativeDrag = false, isFullscreen = false }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [error, setError] = useState('');
  const [dropTarget, setDropTarget] = useState(false);
  const [confirmingRepeatStop, setConfirmingRepeatStop] = useState(false);
  const [stoppingRepeat, setStoppingRepeat] = useState(false);
  const cancelledEdit = useRef(false);
  const savingTitle = useRef(false);
  const draggedRef = useRef(false);
  const completed = task.is_completed || animating;
  const annotation = task.description?.replace(/\s+/g, ' ').trim();

  useEffect(() => setTitle(task.title), [task.title]);

  async function saveTitle() {
    if (cancelledEdit.current) {
      cancelledEdit.current = false;
      setEditing(false);
      setTitle(task.title);
      return;
    }
    if (savingTitle.current) return;
    const nextTitle = title.trim();
    setEditing(false);
    if (!nextTitle || nextTitle === task.title) {
      setTitle(task.title);
      return;
    }
    savingTitle.current = true;
    try {
      await updateWorkspace({ action: 'update_task', task_id: task.id, title: nextTitle }, csrfToken);
      setError('');
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      savingTitle.current = false;
    }
  }

  async function stopRepeat() {
    if (stoppingRepeat) return;
    setStoppingRepeat(true);
    try {
      await updateWorkspace({ action: 'stop_task_repeat', task_id: task.id }, csrfToken);
      setError('');
      setConfirmingRepeatStop(false);
      await onChange();
    } catch (err) { setError(err.message); }
    finally { setStoppingRepeat(false); }
  }

  return <li data-task-id={task.id} className={`${dropTarget ? 'is-drop-target ' : ''}${nativeDrag && draggedRef.current ? 'is-dragging' : ''}`} onDragOver={nativeDrag ? (event) => { if (task.is_completed) return; event.preventDefault(); setDropTarget(true); } : undefined} onDragLeave={nativeDrag ? () => setDropTarget(false) : undefined} onDrop={nativeDrag ? (event) => { event.preventDefault(); setDropTarget(false); if (task.is_completed) return; const draggedId = Number(event.dataTransfer.getData('text/plain')); if (draggedId && draggedId !== task.id) onReorder?.(draggedId, task.id); } : undefined}>
    <div className={`task-list-card__task${completed ? ' is-completed' : ''}${animating ? ' is-completing' : ''}`}>
      {task.is_important && !editing && <span className="task-list-card__task-important" aria-label="Важная задача" title="Важная задача"><StarIcon /></span>}
      <span className="task-list-card__task-control">
        <input type="checkbox" aria-label={`Отметить задачу «${task.title}» выполненной`} checked={task.is_completed || animating} onChange={() => onToggle(task)} />
        <span className="task-list-card__task-mark" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="m5 10 3.2 3.2L15 6.5" /></svg></span>
      </span>
      <div className="task-list-card__task-content">
        <div className="task-list-card__task-line">
          {editing ? <input className="task-list-card__task-edit" aria-label="Название задачи" autoFocus maxLength="240" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={saveTitle} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelledEdit.current = true; event.currentTarget.blur(); } }} /> : <span className="task-list-card__task-title" onDoubleClick={() => { if (!completed) { setTitle(task.title); setEditing(true); } }}>{task.title}</span>}{' '}
           {!editing && <TaskBadges flag={task.flag} dueDate={task.due_date} deadline={task.deadline} urgency={task.urgency} location={task.location && `${task.location}${task.scheduled_time ? ` · ${task.scheduled_time.slice(0, 5)}` : ''}`} />}
        </div>
        {annotation && <span className="task-list-card__task-description" title={task.description}>{Array.from(annotation).slice(0, 60).join('')}{Array.from(annotation).length > 60 ? '…' : ''}</span>}
        {isFullscreen && task.repeat_interval && <button className="task-list-card__stop-repeat" type="button" aria-label={`Остановить повторение: ${({ daily: 'ежедневно', weekly: 'еженедельно', monthly: 'ежемесячно', yearly: 'ежегодно' })[task.repeat_interval]}`} title="Новые экземпляры больше не создадутся" onClick={() => setConfirmingRepeatStop(true)}>Повтор {({ daily: 'ежедневно', weekly: 'еженедельно', monthly: 'ежемесячно', yearly: 'ежегодно' })[task.repeat_interval]} · Остановить</button>}
      </div>
      {!editing && !completed && <button className="task-list-card__task-menu" type="button" draggable={nativeDrag} aria-label="Перетащить задачу или изменить её название" title="Нажми для переименования, перетащи для сортировки" onClick={(event) => { if (event.currentTarget.dataset.dragged) { delete event.currentTarget.dataset.dragged; return; } if (!draggedRef.current) { setTitle(task.title); setEditing(true); } }} onDragStart={nativeDrag ? (event) => { draggedRef.current = true; event.currentTarget.closest('li')?.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(task.id)); } : undefined} onDragEnd={nativeDrag ? (event) => { event.currentTarget.closest('li')?.classList.remove('is-dragging'); window.setTimeout(() => { draggedRef.current = false; }, 0); } : undefined}><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>}
      {!editing && task.is_completed && <button className="task-list-card__task-delete" type="button" aria-label={`Удалить выполненную задачу «${task.title}»`} title="Удалить выполненную задачу" onClick={onDelete}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></svg></button>}
    </div>
    {error && <p className="task-list-card__error" role="alert">{error}</p>}
    {confirmingRepeatStop && <ListDeleteDialog id={`stop-repeat-title-${task.id}`} title="Остановить повторение?" error={error} busy={stoppingRepeat} busyLabel="Останавливаем…" confirmLabel="Остановить" onClose={() => { if (!stoppingRepeat) { setConfirmingRepeatStop(false); setError(''); } }} onConfirm={stopRepeat} theme={document.querySelector?.('.workspace-shell')?.dataset.theme}>
      Новые экземпляры задачи «{task.title}» больше не будут создаваться. Уже созданные задачи останутся.
    </ListDeleteDialog>}
  </li>;
}
