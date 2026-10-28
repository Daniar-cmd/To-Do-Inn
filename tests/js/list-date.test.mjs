import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../frontend/js/workspace/listDate.js', import.meta.url), 'utf8');
const { dateKey, formatListDueDate, isSelectableDate, parseDateInput, quickDateHint, quickDates, calendarDays } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('list dates show short text this year, but full text after a month or in another year', () => {
  const today = new Date(2026, 9, 28);
  assert.equal(formatListDueDate('2026-10-28', today), '28 окт.');
  assert.equal(formatListDueDate('2026-01-10', new Date(2026, 0, 1)), '10 янв.');
  assert.equal(formatListDueDate('2026-09-28', today), '28 сент.');
  assert.equal(formatListDueDate('2026-09-27', today), '27.09.2026');
  assert.equal(formatListDueDate('2027-10-28', today), '28.10.2027');
  assert.equal(formatListDueDate('2025-10-28', today), '28.10.2025');
  assert.equal(formatListDueDate('2027-02-28', new Date(2027, 2, 31)), '28 февр.');
  assert.equal(formatListDueDate('2027-02-27', new Date(2027, 2, 31)), '27.02.2027');
});

test('quick dates follow local calendar days across months and years', () => {
  assert.deepEqual(quickDates(new Date(2026, 11, 31, 23, 59)), [
    ['Сегодня', '2026-12-31'],
    ['Завтра', '2027-01-01'],
    ['На выходных', '2027-01-03'],
    ['Через неделю', '2027-01-07'],
  ]);
  assert.equal(dateKey(new Date(2027, 0, 1)), '2027-01-01');
});

test('weekend shortcut chooses this Sunday, including today', () => {
  assert.equal(quickDates(new Date(2026, 9, 28))[2][1], '2026-11-01');
  assert.equal(quickDates(new Date(2026, 9, 31))[2][1], '2026-11-01');
  assert.equal(quickDates(new Date(2026, 10, 1))[2][1], '2026-11-01');
});

test('quick buttons show dates with short weekdays except next week', () => {
  assert.equal(quickDateHint('2026-10-29'), '29 октября, чт');
  assert.equal(quickDateHint(quickDates(new Date(2026, 9, 28))[2][1]), '1 ноября, вс');
  assert.equal(quickDateHint('2026-11-04', false), '4 ноября');
});

test('typed dates use the current month or year and reject past or nonexistent days', () => {
  const now = new Date(2026, 9, 28, 23, 59);
  assert.deepEqual(parseDateInput('28', now), { date: '2026-10-28', error: '' });
  assert.deepEqual(parseDateInput(' 29 ', now), { date: '2026-10-29', error: '' });
  assert.deepEqual(parseDateInput('30.11', now), { date: '2026-11-30', error: '' });
  assert.deepEqual(parseDateInput('28.10.27', now), { date: '2027-10-28', error: '' });
  assert.deepEqual(parseDateInput('28.09.2027', now), { date: '2027-09-28', error: '' });
  assert.match(parseDateInput('28.09.25', now).error, /Прошедшую/);
  assert.match(parseDateInput('28.09', now).error, /Прошедшую/);
  assert.match(parseDateInput('27', now).error, /Прошедшую/);
  for (const date of ['31.11', '29.02.2027', '0', '32', '12.13', '28.00']) {
    assert.match(parseDateInput(date, now).error, /Такой даты нет/);
  }
  assert.deepEqual(parseDateInput('28.', now), { date: null, error: '' });
  assert.deepEqual(parseDateInput('', now), { date: null, error: '' });
  assert.deepEqual(parseDateInput('01.01.2028', now), { date: '2028-01-01', error: '' });
  assert.match(parseDateInput('abc', now).error, /Введите дату/);
});

test('past calendar dates cannot be selected, today and future dates can', () => {
  const now = new Date(2026, 9, 28, 23, 59);
  assert.equal(isSelectableDate('2026-10-27', now), false);
  assert.equal(isSelectableDate('2026-10-28', now), true);
  assert.equal(isSelectableDate('2026-10-29', now), true);
  assert.equal(isSelectableDate('2026-09-30', now), false);
  assert.equal(isSelectableDate('2027-01-01', now), true);
});

test('calendar starts on Monday and covers every day including leap day', () => {
  const february = calendarDays(2028, 1);
  assert.equal(february.length % 7, 0);
  assert.equal(february[0], null);
  assert.equal(february[1], '2028-02-01');
  assert(february.includes('2028-02-29'));
  assert(!february.includes('2028-03-01'));
  assert.equal(calendarDays(2026, 5)[0], '2026-06-01');
});
