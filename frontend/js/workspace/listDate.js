// Use local calendar dates, not UTC timestamps (which shift across time zones).
export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isSelectableDate(date, now = new Date()) {
  return date >= dateKey(now);
}

const dateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const weekdayLabel = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
const shortDateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

export function formatListDueDate(value, now = new Date()) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7)) - 1;
  const day = Number(value.slice(8, 10));
  // Clamp the previous-month boundary for dates like March 31 → February 28/29.
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const cutoff = new Date(previousMonth.getFullYear(), previousMonth.getMonth(),
    Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
  if (year !== now.getFullYear() || value < dateKey(cutoff)) {
    return `${String(day).padStart(2, '0')}.${String(month + 1).padStart(2, '0')}.${year}`;
  }
  return shortDateLabel.format(new Date(year, month, day, 12));
}

export function quickDateHint(date, withWeekday = true) {
  const localDate = new Date(`${date}T12:00:00`);
  return withWeekday ? `${dateLabel.format(localDate)}, ${weekdayLabel.format(localDate).replace(/\.$/, '')}` : dateLabel.format(localDate);
}

export function parseDateInput(input, now = new Date()) {
  const text = input.trim();
  if (!text) return { date: null, error: '' };

  const parts = /^(\d{1,2})(?:\.(\d{1,2})(?:\.(\d{2}|\d{4}))?)?$/.exec(text);
  if (!parts) {
    const incomplete = /^\d{1,2}\.(?:\d{0,2}\.)?(?:\d{0,3})$/.test(text);
    return { date: null, error: incomplete ? '' : 'Введите дату: 28, 28.09, 28.09.27 или 28.09.2027.' };
  }

  const day = Number(parts[1]);
  const month = parts[2] ? Number(parts[2]) : now.getMonth() + 1;
  const year = parts[3] ? (parts[3].length === 2 ? 2000 + Number(parts[3]) : Number(parts[3])) : now.getFullYear();
  const date = new Date(year, month - 1, day, 12);
  if (year < 1000 || year > 9999 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { date: null, error: 'Такой даты нет.' };
  }
  const key = dateKey(date);
  if (!isSelectableDate(key, now)) return { date: null, error: 'Прошедшую дату выбрать нельзя.' };
  return { date: key, error: '' };
}

export function quickDates(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (7 - today.getDay()) % 7);
  const nextWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  return [
    ['Сегодня', dateKey(today)],
    ['Завтра', dateKey(tomorrow)],
    ['На выходных', dateKey(sunday)],
    ['Через неделю', dateKey(nextWeek)],
  ];
}

export function calendarDays(year, month) {
  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const count = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const day = index - leadingDays + 1;
    return day < 1 || day > daysInMonth ? null : dateKey(new Date(year, month, day));
  });
}
