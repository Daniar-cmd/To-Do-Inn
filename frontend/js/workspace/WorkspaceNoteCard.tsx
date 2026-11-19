import React, { useEffect, useState } from 'react';
import { PaperclipIcon, StarIcon } from '../ui/icons.tsx';
import { listThemes } from '../ui/text.ts';
import type { Note } from './types.ts';
import type { Flag } from './types.ts';

function formatCreatedAt(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

export function WorkspaceNoteCard({ note, flags = [], onSave, onTogglePin, onDrag, isFullscreen = false }: {
  note: Note; flags?: Flag[];
  onSave?: (note: Note, fields: { title: string; body: string; annotation: string; is_important: boolean; theme: string; flag_id: number | string | null }, imageChange: { file?: File; remove?: boolean; offset?: number }) => Promise<unknown> | void;
  onTogglePin?: (note: Note, pinned: boolean) => Promise<unknown> | void;
  onDrag?: { disabled: boolean; locked: boolean; onPointerDown: React.PointerEventHandler<HTMLElement>; onOpen: React.MouseEventHandler<HTMLElement> };
  isFullscreen?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body || '');
  const [annotation, setAnnotation] = useState(note.annotation || '');
  const [important, setImportant] = useState(note.is_important);
  const [theme, setTheme] = useState(note.theme);
  const [flagId, setFlagId] = useState<number | string>(note.flag?.id || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageOffset, setImageOffset] = useState(note.image?.offset ?? 0);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const [imagePreview, setImagePreview] = useState('');

  useEffect(() => {
    if (!imageFile) { setImagePreview(''); return undefined; }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  useEffect(() => {
    if (editing) return;
    setTitle(note.title); setBody(note.body || ''); setAnnotation(note.annotation || '');
    setImportant(note.is_important); setTheme(note.theme); setFlagId(note.flag?.id || '');
    setImageFile(null); setRemoveImage(false); setImageOffset(note.image?.offset ?? 0);
  }, [editing, note]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true); setError('');
    try {
      if (onSave) await onSave(note, { title: title.trim(), body, annotation: annotation.trim(), is_important: important,
        theme, flag_id: flagId || null }, { file: imageFile ?? undefined, remove: removeImage, offset: imageOffset });
      setEditing(false);
    } catch (saveError) { setError((saveError as Error).message); }
    finally { setSaving(false); }
  }

  async function togglePin() {
    if (pinning) return;
    setPinning(true); setError('');
    try { if (onTogglePin) await onTogglePin(note, !note.is_pinned); }
    catch (pinError) { setError((pinError as Error).message); }
    finally { setPinning(false); }
  }

  const card = <article className={`task-list-card workspace-note-card${editing ? ' is-editing' : ''}${note.is_pinned ? ' is-pinned' : ''}`} data-theme={editing ? theme : note.theme}>
    <header className="task-list-card__header">
      {onDrag && !editing && <button className={`task-list-card__drag-handle${note.is_pinned ? ' is-disabled' : ''}`} type="button" aria-label={note.is_pinned ? 'Заметка закреплена' : `Переместить заметку «${note.title}»`} title={note.is_pinned ? 'Сначала открепите заметку' : 'Перетащить заметку'} disabled={onDrag.disabled} aria-disabled={note.is_pinned} onPointerDown={onDrag.onPointerDown} onDragStart={(event) => event.preventDefault()}><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>}
      <div className="task-list-card__created">
        {note.is_important && <span className="task-list-card__important-badge" role="img" aria-label="Важная заметка"><StarIcon /></span>}
        <time dateTime={note.created_at}>{formatCreatedAt(note.created_at)}</time>
      </div>
      <div className="task-list-card__actions">
        {!isFullscreen && <button className="task-list-card__open-button" type="button" aria-label={`Открыть заметку «${note.title}»`} title="Открыть заметку" onClick={onDrag?.onOpen}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/><path d="M8 8h8v8H8z"/></svg></button>}
        <button className={`task-list-card__pin-button${note.is_pinned ? ' is-pinned' : ''}`} type="button" aria-label={note.is_pinned ? 'Открепить заметку' : 'Закрепить заметку'} aria-pressed={note.is_pinned} title={note.is_pinned ? 'Открепить заметку' : 'Закрепить заметку'} disabled={pinning || onDrag?.locked} onClick={togglePin}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3h8l-1 5 3 3v2H6v-2l3-3-1-5Z"/><path d="M12 13v8"/></svg></button>
        <button className="task-list-card__edit-button" type="button" aria-label="Изменить заметку" title="Изменить заметку" disabled={saving} onClick={() => setEditing((value) => !value)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button>
      </div>
    </header>
    {editing ? <form className="task-list-card__edit" onSubmit={save}>
      <label className="task-list-card__field"><span>Название</span><input className="task-list-card__title-input" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="task-list-card__field"><span>Текст заметки</span><textarea ref={bodyRef} maxLength={1200} value={body} onChange={(event) => setBody(event.target.value)} /></label>
      <div className="workspace-note-card__image-controls">
        <button className="list-option-button" type="button" aria-label={note.image || imageFile ? 'Заменить изображение' : 'Прикрепить изображение'} title={note.image || imageFile ? 'Заменить изображение' : 'Прикрепить изображение'} onClick={() => { setImageOffset(bodyRef.current?.selectionStart ?? body.length); imageInputRef.current?.click(); }}><PaperclipIcon /></button>
        {(note.image && !removeImage || imageFile) && <button className="workspace-note-card__image-remove" type="button" onClick={() => { setImageFile(null); setRemoveImage(true); }}>Убрать изображение</button>}
        <input ref={imageInputRef} className="note-creator__file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/avif,.png,.jpg,.jpeg,.webp,.gif,.heic,.avif" aria-label="Выбрать изображение" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 1_048_576) { setError('Изображение должно быть не больше 1 МБ.'); return; } setImageFile(file); setRemoveImage(false); setError(''); }} />
      </div>
      {note.image && !removeImage && !imagePreview && <div className="workspace-note-card__image-preview"><img src={note.image.url} alt="Изображение заметки" /></div>}
      {imagePreview && <div className="workspace-note-card__image-preview"><img src={imagePreview} alt="Предпросмотр изображения заметки" /></div>}
      <label className="task-list-card__field"><span>Аннотация</span><textarea maxLength={200} value={annotation} onChange={(event) => setAnnotation(event.target.value)} /></label>
      <div className="task-list-card__edit-toolbar">
        <button className={`list-option-button${important ? ' is-selected' : ''}`} type="button" aria-pressed={important} aria-label="Важная заметка" onClick={() => setImportant((value: boolean) => !value)}><StarIcon /></button>
        <div className="list-theme-picker" role="group" aria-label="Цвет заметки">{listThemes.map(([value, label]) => <button className={`list-theme-swatch${theme === value ? ' is-selected' : ''}`} type="button" data-list-theme={value} aria-label={label} aria-pressed={theme === value} key={value} onClick={() => setTheme(value)} />)}</div>
      </div>
      <label className="task-list-card__field"><span>Флаг</span><select value={flagId} onChange={(event) => setFlagId(event.target.value)}><option value="">Без флага</option>{flags.map((flag: Flag) => <option key={flag.id} value={flag.id}>{flag.name}</option>)}</select></label>
      {error && <p className="task-list-card__error" role="alert">{error}</p>}
      <div className="task-list-card__edit-actions"><button type="button" className="task-list-card__cancel" disabled={saving} onClick={() => setEditing(false)}>Отмена</button><button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
    </form> : <div className="task-list-card__intro">
      <div className="task-list-card__title-row"><h2>{note.title}</h2></div>
      {note.annotation && <p className="workspace-note-card__annotation">{note.annotation}</p>}
      {note.flag && <div className="task-list-card__meta-tags"><span className={`task-list-card__flag-tag is-${note.flag.color}`}>{note.flag.name}</span></div>}
      {(note.body || note.image) && <div className="workspace-note-card__body">{note.image && <>{note.body.slice(0, Math.max(0, Math.min(note.image.offset, note.body.length)))}<img src={note.image.url} alt="" /></>}{note.body.slice(note.image ? Math.max(0, Math.min(note.image.offset, note.body.length)) : 0)}</div>}
    </div>}
    {error && !editing && <p role="alert" className="task-list-card__error">{error}</p>}
  </article>;

  return card;
}
