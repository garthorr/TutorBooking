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
  getAvailableSlotsForDay
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
