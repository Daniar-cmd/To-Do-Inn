import React, { useEffect, useRef, useState } from 'react';
import { calendarDays, dateKey, isSelectableDate, parseDateInput, quickDateHint, quickDates } from './listDate.js';

const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const selectedFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function ListDatePicker({ value, open, onOpenChange, onChange }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const selected = value ? new Date(`${value}T12:00:00`) : null;
  const today = new Date();
  const todayKey = dateKey(today);
  const currentMonth = today.getFullYear() * 12 + today.getMonth();
  const displayedMonth = visibleMonth.getFullYear() * 12 + visibleMonth.getMonth();

  useEffect(() => {
    if (!open) return;
    setDraft(value ? `${Number(value.slice(8))}.${value.slice(5, 7)}${Number(value.slice(0, 4)) === new Date().getFullYear() ? '' : `.${value.slice(0, 4)}`}` : '');
    setError('');
    inputRef.current?.focus();
  }, [open]);

  function chooseDate(date) {
    onChange(date);
    setVisibleMonth(new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1));
    setDraft(`${Number(date.slice(8))}.${date.slice(5, 7)}${Number(date.slice(0, 4)) === today.getFullYear() ? '' : `.${date.slice(0, 4)}`}`);
    setError('');
  }

  function typeDate(text) {
    setDraft(text);
    const parsed = parseDateInput(text, new Date());
    setError(parsed.error);
    onChange(parsed.date);
    if (parsed.date) setVisibleMonth(new Date(Number(parsed.date.slice(0, 4)), Number(parsed.date.slice(5, 7)) - 1, 1));
  }

  function confirmDate() {
    const parsed = parseDateInput(draft, new Date());
    if (!parsed.date) {
      setError(parsed.error || 'Введите дату.');
      return;
    }
    chooseDate(parsed.date);
    onOpenChange(false);
  }

  function moveMonth(offset) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  return <details className="list-date-picker" open={open} onToggle={(event) => {
    if (event.currentTarget.open && value) {
      const date = new Date(`${value}T12:00:00`);
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
    onOpenChange(event.currentTarget.open);
  }}>
    <summary className={`list-option-button${value ? ' is-selected' : ''}`} aria-label={open ? 'Ввести дату' : value ? `Дата: ${dayFormat.format(selected)}` : 'Выбрать дату'}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></svg>
      {open ? <input ref={inputRef} className="list-date-picker__input" type="text" inputMode="numeric" autoComplete="off" maxLength="10" aria-label="Введите дату" aria-invalid={Boolean(error)} value={draft} onChange={(event) => typeDate(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); confirmDate(); }
        if (event.key === 'Escape') { event.stopPropagation(); onOpenChange(false); }
      }} /> : <span>{selected ? selectedFormat.format(selected) : 'Дата'}</span>}
    </summary>
    <div className="list-date-picker__panel">
      {error && <p className="list-date-picker__error" role="status">{error}</p>}
      <div className="list-date-picker__quick">
        {quickDates(today).map(([label, date]) => <button key={label} type="button" className={value === date ? 'is-selected' : ''} aria-pressed={value === date} onClick={() => chooseDate(date)}><span>{label}</span><small>{quickDateHint(date, label !== 'Через неделю')}</small></button>)}
      </div>
      <div className="list-date-picker__month">
        <button type="button" aria-label="Предыдущий месяц" disabled={displayedMonth <= currentMonth} onClick={() => moveMonth(-1)}>‹</button>
        <span aria-live="polite">{monthFormat.format(visibleMonth)}</span>
        <button type="button" aria-label="Следующий месяц" onClick={() => moveMonth(1)}>›</button>
      </div>
      <div className="list-date-picker__days" aria-label={`Календарь: ${monthFormat.format(visibleMonth)}`}>
        {weekdays.map((day) => <span className="list-date-picker__weekday" key={day}>{day}</span>)}
        {calendarDays(visibleMonth.getFullYear(), visibleMonth.getMonth()).map((date, index) => date
          ? <button key={date} type="button" className={`${value === date ? 'is-selected ' : ''}${date === todayKey ? 'is-today' : ''}`} aria-label={dayFormat.format(new Date(`${date}T12:00:00`))} aria-pressed={value === date} disabled={!isSelectableDate(date, today)} onClick={() => chooseDate(date)}>{Number(date.slice(-2))}</button>
          : <span key={`empty-${index}`} aria-hidden="true" />)}
      </div>
      <button className="list-date-picker__repeat" type="button" disabled title="Повторение добавим позже">Повторять</button>
    </div>
  </details>;
}
