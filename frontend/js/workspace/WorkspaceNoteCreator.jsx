import React, { useEffect, useRef, useState } from 'react';
import { createWorkspaceNote, updateWorkspace } from '../api.js';
import { FlagIcon, PlusIcon, StarIcon } from '../ui/icons.jsx';
import { listThemes, uiText } from '../ui/text.js';

export function WorkspaceNoteCreator({ boardId, flags, csrfToken, onCreated, onFlagCreated, isSaving, onSavingChange }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [annotation, setAnnotation] = useState('');
  const [important, setImportant] = useState(false);
  const [theme, setTheme] = useState('blue');
  const [selectedFlagId, setSelectedFlagId] = useState(null);
  const [newFlagName, setNewFlagName] = useState('');
  const [creatingFlag, setCreatingFlag] = useState(false);
  const [feedback, setFeedback] = useState('');
  const bodyRef = useRef(null);
  const expanded = title.trim().length > 0;
  const selectedFlag = flags.find((flag) => flag.id === selectedFlagId);

  useEffect(() => {
    const field = bodyRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [body, expanded]);

  function reset() {
    setTitle('');
    setBody('');
    setAnnotation('');
    setImportant(false);
    setTheme('blue');
    setSelectedFlagId(null);
    setNewFlagName('');
    setFeedback('');
  }

  function chooseFlag(id, event) {
    setSelectedFlagId(id);
    setNewFlagName('');
    const details = event.currentTarget.closest('details');
    if (details) details.open = false;
  }

  async function createFlag(event) {
    event.preventDefault();
    const name = newFlagName.trim();
    if (!name || creatingFlag) return;
    const details = event.currentTarget.closest('details');
    setCreatingFlag(true);
    setFeedback('');
    try {
      const { flag } = await updateWorkspace({ action: 'create_flag', board_id: boardId, name }, csrfToken);
      onFlagCreated(flag);
      setSelectedFlagId(flag.id);
      setNewFlagName('');
      if (details) details.open = false;
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setCreatingFlag(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isSaving) return;
    onSavingChange(true);
    setFeedback('');
    try {
      const { note } = await createWorkspaceNote({
        board_id: boardId,
        title: trimmedTitle,
        body,
        annotation: annotation.trim(),
        is_important: important,
        theme,
        flag_id: selectedFlagId,
        new_flag_name: newFlagName.trim(),
      }, csrfToken);
      onCreated(note);
      reset();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      onSavingChange(false);
    }
  }

  function cancel() {
    if (isSaving) return;
    reset();
  }

  return <form className={expanded ? 'is-expanded' : ''} onSubmit={submit}>
    <div className="list-creator__name-row">
      <button className="list-creator__cancel" type="button" aria-label={expanded ? 'Отменить создание заметки' : 'Ввести название новой заметки'} title={expanded ? 'Отменить создание' : uiText.creator.newNote} disabled={isSaving} onClick={() => expanded ? cancel() : document.getElementById('new-note-title')?.focus()}><PlusIcon /></button>
      <label className="list-creator__name-field" htmlFor="new-note-title">
        <input id="new-note-title" name="note-title" type="text" maxLength="80" placeholder={uiText.creator.newNote} autoComplete="off" aria-label="Название новой заметки" value={title} onChange={(event) => { setTitle(event.target.value); setFeedback(''); }} />
      </label>
      {expanded && <button className="list-creator__submit" type="submit" disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Создать заметку'}</button>}
    </div>

    {expanded && <div className="note-creator__expanded">
      <textarea ref={bodyRef} className="note-creator__body" name="note-body" rows="3" maxLength="1200" placeholder="Текст заметки" aria-label="Текст заметки" value={body} onChange={(event) => setBody(event.target.value)} />
      <div className="list-creator__options note-creator__options">
        <div className="list-creator__toolbar note-creator__toolbar">
          <button className={`list-option-button${important ? ' is-selected' : ''}`} type="button" aria-pressed={important} aria-label={important ? 'Убрать важность заметки' : 'Сделать заметку важной'} title="Важная заметка" onClick={() => setImportant((current) => !current)}>
            <StarIcon />
          </button>

          <details className="list-description-picker">
            <summary className="list-option-button" aria-label="Добавить аннотацию" title="Аннотация">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5h14M5 10h14M5 15h9M5 19h6" /></svg>
            </summary>
            <div className="list-description-picker__panel">
              <textarea id="new-note-annotation" aria-label="Аннотация заметки" maxLength="200" placeholder="Аннотация" value={annotation} onChange={(event) => setAnnotation(event.target.value)} />
            </div>
          </details>

          <details className="flag-picker">
            <summary className={`list-option-button${selectedFlag || newFlagName.trim() ? ' is-selected' : ''}`} aria-label="Назначить флаг заметке" title="Назначить флаг">
              <FlagIcon color={newFlagName.trim() ? 'blue' : selectedFlag?.color} />
              <span className="flag-picker__selected-label">{newFlagName ? 'Новый флаг' : selectedFlag?.name || 'Флаг'}</span>
            </summary>
            <div className="flag-picker__panel">
              <p className="flag-picker__title">Выберите флаг</p>
              <button className={`flag-picker__choice${selectedFlagId === null && !newFlagName ? ' is-selected' : ''}`} type="button" aria-pressed={selectedFlagId === null && !newFlagName} onClick={(event) => chooseFlag(null, event)}>Без флага</button>
              <div className="flag-picker__existing">
                {flags.map((flag) => <button className={`flag-picker__choice${selectedFlagId === flag.id ? ' is-selected' : ''}`} type="button" key={flag.id} aria-pressed={selectedFlagId === flag.id} onClick={(event) => chooseFlag(flag.id, event)}><FlagIcon color={flag.color} /><span>{flag.name}</span></button>)}
              </div>
              <label className="flag-picker__custom-label" htmlFor="new-note-flag-name">Или создайте свой</label>
              <div className="flag-picker__create-row">
                <input className="flag-picker__custom-input" id="new-note-flag-name" name="note-flag-label" type="text" maxLength="40" placeholder="Название флага" autoComplete="off" value={newFlagName} onChange={(event) => { setNewFlagName(event.target.value); setSelectedFlagId(null); }} />
                {newFlagName.trim() && <button className="flag-picker__create-button" type="button" aria-label="Создать флаг" title="Создать флаг" disabled={creatingFlag} onClick={createFlag}><PlusIcon /></button>}
              </div>
            </div>
          </details>

          <div className="list-theme-picker" role="group" aria-label="Цвет заметки">
            {listThemes.map(([value, label]) => <button className={`list-theme-swatch${theme === value ? ' is-selected' : ''}`} type="button" data-list-theme={value} aria-label={label} aria-pressed={theme === value} key={value} onClick={() => setTheme(value)} />)}
          </div>
        </div>
        {feedback && <p className="list-creator__feedback" role="alert">{feedback}</p>}
      </div>
    </div>}
  </form>;
}
