import React from 'react';
import { formatListDueDate } from './listDate.js';
import { taskUrgencyLevels } from '../ui/text.js';

export function TaskBadges({ flag, dueDate, deadline, urgency, location }) {
  const deadlineLabel = deadline
    ? `${deadline.slice(8, 10)}.${deadline.slice(5, 7)}.${deadline.slice(2, 4)}`
    : '';
  return <span className="task-list-card__task-badges">
    {flag && <span className={`task-list-card__flag-tag is-${flag.color}`}>{flag.name}</span>}
    {dueDate && <time className="task-list-card__due-date is-scheduled" dateTime={dueDate}>{formatListDueDate(dueDate)}</time>}
    {deadline && <time className="task-list-card__due-date is-deadline" dateTime={deadline} aria-label={`Дедлайн: ${deadlineLabel}`} title={`Дедлайн: ${deadlineLabel}`}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 22c4.5 0 7-3 7-7 0-3-1.5-5-4-7 .3 2-1 3.3-2 4-1-3-.5-5.5-2.5-9C9 6 5 9 5 15c0 4 2.5 7 7 7Z"/><path d="M12 22c2.3 0 3.5-1.4 3.5-3.4 0-1.8-1-3-2.5-4.6-.2 1.4-1.1 2.2-2.1 2.8-.4-.8-.5-1.5-.4-2.3-1.4 1.7-2 3-2 4 0 2 1.2 3.1 3.5 3.1Z"/></svg>{deadlineLabel}</time>}
    {urgency > 0 && <span className={`task-list-card__task-urgency is-level-${urgency}`} aria-label={`Срочность: ${taskUrgencyLevels[urgency - 1]?.label}`} title={taskUrgencyLevels[urgency - 1]?.label}>{'!'.repeat(urgency)}</span>}
    {location && <span className="task-list-card__location">{location}</span>}
  </span>;
}
