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
