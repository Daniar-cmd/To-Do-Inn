import React, { useEffect, useRef, useState } from 'react';
import { calendarDays, dateKey, isSelectableDate, quickDateHint, quickDates } from './listDate.js';

const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const selectedFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const repeatOptions = [['daily', 'Каждый день'], ['weekly', 'Каждую неделю'], ['monthly', 'Раз в месяц'], ['yearly', 'Каждый год']];

export function ListDatePicker({ value, open, onOpenChange, onChange, deadline, onDeadlineChange, repeat, onRepeatChange, label = 'Дата', showSelectedDate = true }) {
  const triggerRef = useRef(null);
  const repeatButtonRef = useRef(null);
  const [selectingDeadline, setSelectingDeadline] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const selected = value ? new Date(`${value}T12:00:00`) : null;
  const selectedDeadline = deadline ? new Date(`${deadline}T12:00:00`) : null;
  const activeDate = selectingDeadline ? deadline : value;
  const today = new Date();
  const todayKey = dateKey(today);
  const currentMonth = today.getFullYear() * 12 + today.getMonth();
  const displayedMonth = visibleMonth.getFullYear() * 12 + visibleMonth.getMonth();
  const monthDays = calendarDays(visibleMonth.getFullYear(), visibleMonth.getMonth());
  const triggerLabel = !showSelectedDate ? label : deadline ? selectedFormat.format(selectedDeadline) : selected ? selectedFormat.format(selected) : label;

  useEffect(() => {
    if (!open) { setSelectingDeadline(false); setRepeatOpen(false); }
  }, [open]);

  function chooseDate(date) {
    if (selectingDeadline) onDeadlineChange(date);
    else onChange(date);
    setVisibleMonth(new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1));
    onOpenChange(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function moveMonth(offset) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  return <div className={`list-date-picker${open ? ' is-open' : ''}${selectingDeadline ? ' is-deadline' : ''}${repeatOpen ? ' is-repeat-open' : ''}`} onKeyDown={(event) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenChange(false);
    triggerRef.current?.focus();
  }}>
     <button ref={triggerRef} className={`list-option-button list-date-picker__trigger${value || deadline ? ' is-selected' : ''}${deadline ? ' has-deadline' : ''}`} type="button" aria-expanded={open} aria-label={deadline ? `Дедлайн: ${dayFormat.format(selectedDeadline)}` : value ? `${label}: ${dayFormat.format(selected)}` : `Выбрать: ${label.toLowerCase()}`} onClick={() => {
       const date = activeDate || deadline;
       if (!open && date) setVisibleMonth(new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1));
       onOpenChange(!open);
     }}>
      {deadline ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 22c4.5 0 7-3 7-7 0-3-1.5-5-4-7 .3 2-1 3.3-2 4-1-3-.5-5.5-2.5-9C9 6 5 9 5 15c0 4 2.5 7 7 7Z"/><path d="M12 22c2.3 0 3.5-1.4 3.5-3.4 0-1.8-1-3-2.5-4.6-.2 1.4-1.1 2.2-2.1 2.8-.4-.8-.5-1.5-.4-2.3-1.4 1.7-2 3-2 4 0 2 1.2 3.1 3.5 3.1Z"/></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></svg>}
        <span>{triggerLabel}</span>
     </button>
     <div className="list-date-picker__panel" hidden={!open}>
       <div className="list-date-picker__sidebar">
        {onRepeatChange && <div className="list-date-picker__repeat-panel" hidden={!repeatOpen} role="group" aria-label="Частота повторения">
        <p className="list-date-picker__heading">Повторять</p>
        {repeatOptions.map(([interval, text]) => <button key={interval} type="button" className={repeat === interval ? 'is-selected' : ''} aria-pressed={repeat === interval} onClick={() => { repeatButtonRef.current?.focus(); onRepeatChange(interval); setRepeatOpen(false); }}>{text}</button>)}
        <button type="button" className="list-date-picker__repeat-clear" disabled={!repeat} onClick={() => { repeatButtonRef.current?.focus(); onRepeatChange(null); setRepeatOpen(false); }}>Без повторения</button>
        </div>}
        <p className="list-date-picker__heading list-date-picker__quick-heading" hidden={repeatOpen}>Быстрый выбор</p>
        <div className="list-date-picker__quick" hidden={repeatOpen}>
          {quickDates(today).map(([label, date]) => <button key={label} type="button" className={activeDate === date ? 'is-selected' : ''} aria-pressed={activeDate === date} onClick={() => chooseDate(date)}><span>{label}</span><small>{quickDateHint(date, label !== 'Через неделю', true)}</small></button>)}
        </div>
        {(onRepeatChange || onDeadlineChange) && <div className="list-date-picker__actions">
          {onRepeatChange && <button ref={repeatButtonRef} className="list-date-picker__repeat" type="button" aria-expanded={repeatOpen} aria-label="Повторять" title="Выбрать повторение" onClick={() => { setRepeatOpen((current) => !current); setSelectingDeadline(false); }}>Повторять <span aria-hidden="true">{repeat ? repeatOptions.find(([interval]) => interval === repeat)?.[1] : '‹'}</span></button>}
          {onDeadlineChange && <button className="list-date-picker__deadline" type="button" aria-pressed={selectingDeadline} title="Выбрать дату дедлайна" onClick={() => { setSelectingDeadline((current) => !current); setRepeatOpen(false); }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 22c4.5 0 7-3 7-7 0-3-1.5-5-4-7 .3 2-1 3.3-2 4-1-3-.5-5.5-2.5-9C9 6 5 9 5 15c0 4 2.5 7 7 7Z"/><path d="M12 22c2.3 0 3.5-1.4 3.5-3.4 0-1.8-1-3-2.5-4.6-.2 1.4-1.1 2.2-2.1 2.8-.4-.8-.5-1.5-.4-2.3-1.4 1.7-2 3-2 4 0 2 1.2 3.1 3.5 3.1Z"/></svg><span>Дедлайн</span><span className="list-date-picker__deadline-value">{deadline ? selectedFormat.format(new Date(`${deadline}T12:00:00`)) : '›'}</span></button>}
        </div>}
      </div>
      <div className="list-date-picker__calendar">
        <p className="list-date-picker__heading" role="status">{selectingDeadline ? 'Выберите дедлайн' : 'Выберите дату'}</p>
        <div className="list-date-picker__month">
          <button type="button" aria-label="Предыдущий месяц" disabled={displayedMonth <= currentMonth} onClick={() => moveMonth(-1)}>‹</button>
          <span aria-live="polite">{monthFormat.format(visibleMonth)}</span>
          <button type="button" aria-label="Следующий месяц" onClick={() => moveMonth(1)}>›</button>
        </div>
        <div className={`list-date-picker__days${monthDays.length > 35 ? ' has-six-weeks' : monthDays.length < 35 ? ' has-four-weeks' : ''}`} aria-label={`Календарь: ${monthFormat.format(visibleMonth)}`}>
          {weekdays.map((day) => <span className="list-date-picker__weekday" key={day}>{day}</span>)}
          {monthDays.map((date, index) => date
            ? <button key={date} type="button" className={`${activeDate === date ? 'is-selected ' : ''}${date === todayKey ? 'is-today' : ''}`} aria-label={dayFormat.format(new Date(`${date}T12:00:00`))} aria-pressed={activeDate === date} disabled={!isSelectableDate(date, today)} onClick={() => chooseDate(date)}>{Number(date.slice(-2))}</button>
            : <span key={`empty-${index}`} aria-hidden="true" />)}
        </div>
        <div className="list-date-picker__selection"><span>{activeDate ? `${selectingDeadline ? 'Дедлайн' : label}: ${dayFormat.format(new Date(`${activeDate}T12:00:00`))}` : selectingDeadline ? 'Дедлайн не выбран' : 'Дата не выбрана'}</span><button type="button" disabled={!activeDate} aria-label={selectingDeadline ? 'Сбросить дедлайн' : label === 'Дата' ? 'Сбросить дату' : `Сбросить ${label.toLowerCase()}`} onClick={() => {
          if (selectingDeadline) onDeadlineChange(null);
          else onChange(null);
         }}>Сбросить</button></div>
      </div>
    </div>
   </div>;
}
