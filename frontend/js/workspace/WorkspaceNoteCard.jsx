import React from 'react';
import { StarIcon } from '../ui/icons.jsx';

export function WorkspaceNoteCard({ note }) {
  return <article className="workspace-note-card" data-theme={note.theme}>
    <header className="workspace-note-card__header">
      <h2>{note.title}</h2>
      {note.is_important && <span className="workspace-note-card__important" aria-label="Важная заметка"><StarIcon /></span>}
    </header>
    {note.annotation && <p className="workspace-note-card__annotation">{note.annotation}</p>}
    {note.body && <div className="workspace-note-card__body">{note.body}</div>}
    {note.flag && <div className="workspace-note-card__meta"><span className={`task-list-card__flag-tag is-${note.flag.color}`}>{note.flag.name}</span></div>}
  </article>;
}
