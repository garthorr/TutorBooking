// Use a fixed timezone so slot ISO strings are deterministic. Must be set
// before importing the module under test, which reads TIMEZONE at load.
process.env.TIMEZONE = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import {
  tzDate,
  toDateStr,
  dayOfWeekFromStr,
  isDateInOverrides,
  hasSchedulingConflict,
  getAvailableSlotsForDay,
  normalizeTime,
  normalizeAvailability
} from '../services/availability.js';

const DAY = new Date('2026-06-10T12:00:00.000Z'); // a Wednesday in UTC

test('tzDate resolves wall-clock time on the given day in TIMEZONE (UTC)', () => {
  assert.strictEqual(tzDate(DAY, 9, 30).toISOString(), '2026-06-10T09:30:00.000Z');
});

test('toDateStr zero-pads month/day', () => {
  assert.strictEqual(toDateStr(2026, 5, 3), '2026-06-03');
});

test('dayOfWeekFromStr returns correct day of week', () => {
  assert.strictEqual(dayOfWeekFromStr('2026-06-10'), 3); // Wednesday
  assert.strictEqual(dayOfWeekFromStr('2026-06-07'), 0); // Sunday
});

test('isDateInOverrides matches exact strings and ranges', () => {
  assert.strictEqual(isDateInOverrides('2026-06-10', ['2026-06-10']), true);
  assert.strictEqual(isDateInOverrides('2026-06-11', ['2026-06-10']), false);
  assert.strictEqual(isDateInOverrides('2026-06-15', [{ start: '2026-06-10', end: '2026-06-20' }]), true);
  assert.strictEqual(isDateInOverrides('2026-06-25', [{ start: '2026-06-10', end: '2026-06-20' }]), false);
  assert.strictEqual(isDateInOverrides('2026-06-10', null), false);
});

test('getAvailableSlotsForDay generates 5-minute-stepped slots that fit the block', () => {
  const slots = getAvailableSlotsForDay(DAY, [{ start: '09:00', end: '10:00' }], 30, [], 'school-1', 5);
  // Starts every 5 min from 09:00 up to 09:30 (last slot ends exactly at 10:00).
  assert.strictEqual(slots.length, 7);
  assert.strictEqual(slots[0].time, '2026-06-10T09:00:00.000Z');
  assert.strictEqual(slots[slots.length - 1].time, '2026-06-10T09:30:00.000Z');
});

test('getAvailableSlotsForDay removes slots overlapping a calendar event', () => {
  const events = [{
    start: { dateTime: '2026-06-10T09:00:00.000Z' },
    end: { dateTime: '2026-06-10T09:30:00.000Z' }
  }];
  const slots = getAvailableSlotsForDay(DAY, [{ start: '09:00', end: '10:00' }], 30, events, 'school-1', 5);
  // Only the 09:30 slot avoids overlapping the 09:00–09:30 event.
  assert.deepStrictEqual(slots.map(s => s.time), ['2026-06-10T09:30:00.000Z']);
});

test('hasSchedulingConflict respects an injected drive-time buffer after an event', () => {
  const events = [{
    start: { dateTime: '2026-06-10T09:00:00.000Z' },
    end: { dateTime: '2026-06-10T09:30:00.000Z' },
    extendedProperties: { private: { schoolId: 'A' } }
  }];
  const slotStart = new Date('2026-06-10T09:35:00.000Z');
  const slotEnd = new Date('2026-06-10T10:05:00.000Z');
  const getDriveTime = (from, to) => (from === 'A' && to === 'B' ? 30 : 0);

  // 30-min drive buffer pushes availability to 10:00, so 09:35 is blocked...
  assert.strictEqual(hasSchedulingConflict(slotStart, slotEnd, events, 'B', 5, getDriveTime), true);
  // ...but with no drive time the (non-overlapping) slot is free.
  assert.strictEqual(hasSchedulingConflict(slotStart, slotEnd, events, 'B', 5, () => 0), false);
});

test('getAvailableSlotsForDay drops slots that start before minStart', () => {
  // Mid-block "now": only slots at or after 09:20 should be offered.
  const now = new Date('2026-06-10T09:20:00.000Z');
  const slots = getAvailableSlotsForDay(DAY, [{ start: '09:00', end: '10:00' }], 30, [], 'school-1', 5, undefined, now);
  assert.strictEqual(slots[0].time, '2026-06-10T09:20:00.000Z');
  assert.ok(slots.every(s => new Date(s.time) >= now), 'no slot may start in the past');
});

test('getAvailableSlotsForDay without minStart still offers the whole block', () => {
  const slots = getAvailableSlotsForDay(DAY, [{ start: '09:00', end: '10:00' }], 30, [], 'school-1', 5);
  assert.strictEqual(slots.length, 7);
});

test('getAvailableSlotsForDay returns nothing when a slot cannot fit the block', () => {
  const slots = getAvailableSlotsForDay(DAY, [{ start: '09:00', end: '09:20' }], 30, [], 'school-1', 5);
  assert.strictEqual(slots.length, 0);
});

test('normalizeTime accepts 24-hour HH:MM and pads single-digit hours', () => {
  assert.strictEqual(normalizeTime('09:00'), '09:00');
  assert.strictEqual(normalizeTime('9:00'), '09:00');
  assert.strictEqual(normalizeTime('17:30'), '17:30');
  assert.strictEqual(normalizeTime('23:59'), '23:59');
  assert.strictEqual(normalizeTime('0:05'), '00:05');
});

test('normalizeTime rejects invalid values', () => {
  assert.strictEqual(normalizeTime('24:00'), null);
  assert.strictEqual(normalizeTime('12:60'), null);
  assert.strictEqual(normalizeTime('5:00 PM'), null);
  assert.strictEqual(normalizeTime('noon'), null);
  assert.strictEqual(normalizeTime(''), null);
  assert.strictEqual(normalizeTime(null), null);
  assert.strictEqual(normalizeTime(900), null);
});

test('normalizeAvailability normalizes times, keeps extra block fields, drops empty days', () => {
  const { value, error } = normalizeAvailability({
    1: [{ start: '9:00', end: '17:00', name: 'A2a' }],
    2: []
  });
  assert.strictEqual(error, undefined);
  assert.deepStrictEqual(value, { 1: [{ start: '09:00', end: '17:00', name: 'A2a' }] });
});

test('normalizeAvailability passes through null/undefined (meeting types without a schedule)', () => {
  assert.strictEqual(normalizeAvailability(null).value, null);
  assert.strictEqual(normalizeAvailability(undefined).value, undefined);
});

test('normalizeAvailability rejects bad days and bad times', () => {
  assert.ok(normalizeAvailability({ 7: [{ start: '09:00', end: '17:00' }] }).error);
  assert.ok(normalizeAvailability({ 1: [{ start: '9am', end: '17:00' }] }).error);
  assert.ok(normalizeAvailability([{ start: '09:00', end: '17:00' }]).error);
  assert.ok(normalizeAvailability({ 1: { start: '09:00', end: '17:00' } }).error);
});

test('normalizeAvailability tolerates inverted/empty ranges (legacy data)', () => {
  // These produce no slots downstream but must not block saving.
  assert.deepStrictEqual(
    normalizeAvailability({ 1: [{ start: '17:00', end: '09:00' }] }).value,
    { 1: [{ start: '17:00', end: '09:00' }] }
  );
  assert.strictEqual(normalizeAvailability({ 1: [{ start: '09:00', end: '09:00' }] }).error, undefined);
});

/* ── Minimum notice and travel buffers are independent ───────────────────── */

test('minimum notice floors the day without disturbing travel buffers', () => {
  const day = new Date('2026-10-05T12:00:00.000Z');
  const at = h => new Date(`2026-10-05T${String(h).padStart(2, '0')}:00:00.000Z`);
  // An existing session at school-a, 13:00-14:00; 20 minutes to reach school-b.
  const events = [{
    id: 'existing',
    start: { dateTime: at(13).toISOString() },
    end: { dateTime: at(14).toISOString() },
    extendedProperties: { private: { schoolId: 'school-a' } }
  }];
  const drive = (from, to) => (from && to && from !== to) ? 20 : 0;
  const blocks = [{ start: '08:00', end: '18:00' }];
  const slots = f => getAvailableSlotsForDay(day, blocks, 60, events, 'school-b', 5, drive, f)
    .map(s => s.time.slice(11, 16));

  const noNotice = slots(null);
  const twoHours = slots(new Date(at(9).getTime() + 2 * 3600e3)); // "now" 09:00, 2h notice

  // The notice floor removes everything before 11:00 and nothing after it.
  assert.strictEqual(noNotice[0], '08:00');
  assert.strictEqual(twoHours[0], '11:00');
  assert.deepStrictEqual(twoHours, noNotice.filter(t => t >= '11:00'));

  // Travel buffers are untouched: last slot before the session must end 20
  // minutes early (11:40 + 60 = 12:40), and the next starts 20 minutes after.
  assert.ok(twoHours.includes('11:40'), 'last slot that leaves travel time');
  assert.ok(!twoHours.includes('11:45'), 'a later start would not leave travel time');
  assert.ok(!twoHours.includes('14:00'), 'cannot start the moment the session ends');
  assert.ok(twoHours.includes('14:20'), 'first slot after the travel buffer');
});

test('minimum notice of zero offers the whole block', () => {
  const day = new Date('2026-10-05T12:00:00.000Z');
  const blocks = [{ start: '09:00', end: '11:00' }];
  const all = getAvailableSlotsForDay(day, blocks, 60, [], '', 5, () => 0, null);
  const zero = getAvailableSlotsForDay(day, blocks, 60, [], '', 5, () => 0, new Date('2026-10-05T00:00:00.000Z'));
  assert.deepStrictEqual(zero.map(s => s.time), all.map(s => s.time));
});

test('maxStart stops slots beyond the booking window', () => {
  const day = new Date('2026-10-05T12:00:00.000Z');
  const blocks = [{ start: '09:00', end: '17:00' }];
  const all = getAvailableSlotsForDay(day, blocks, 60, [], '', 5, () => 0);
  // A ceiling mid-block keeps the earlier starts and drops the later ones.
  const ceiling = new Date('2026-10-05T11:00:00.000Z');
  const bounded = getAvailableSlotsForDay(day, blocks, 60, [], '', 5, () => 0, null, ceiling);
  assert.ok(bounded.length > 0 && bounded.length < all.length, 'some slots kept, some dropped');
  assert.strictEqual(bounded[bounded.length - 1].time, '2026-10-05T11:00:00.000Z', 'last slot is exactly at the ceiling');
  assert.ok(bounded.every(s => new Date(s.time) <= ceiling), 'nothing past the ceiling');
  assert.deepStrictEqual(bounded.map(s => s.time), all.filter(s => new Date(s.time) <= ceiling).map(s => s.time));
});

test('minStart and maxStart bound the day from both ends', () => {
  const day = new Date('2026-10-05T12:00:00.000Z');
  const blocks = [{ start: '09:00', end: '17:00' }];
  const from = new Date('2026-10-05T10:00:00.000Z');
  const to = new Date('2026-10-05T12:00:00.000Z');
  const slots = getAvailableSlotsForDay(day, blocks, 60, [], '', 5, () => 0, from, to);
  assert.strictEqual(slots[0].time, '2026-10-05T10:00:00.000Z');
  assert.strictEqual(slots[slots.length - 1].time, '2026-10-05T12:00:00.000Z');
});
