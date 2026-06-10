process.env.TIMEZONE = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import { decideSyncAction } from '../services/calendarSync.js';

const booking = { time: '2026-06-10T09:00:00.000Z' };

test('decideSyncAction cancels when the event was deleted in Google', () => {
  assert.deepStrictEqual(decideSyncAction(booking, null), { type: 'cancel' });
});

test('decideSyncAction cancels when the event status is cancelled', () => {
  assert.deepStrictEqual(decideSyncAction(booking, { status: 'cancelled' }), { type: 'cancel' });
});

test('decideSyncAction does nothing when the event time is unchanged', () => {
  const event = { status: 'confirmed', start: { dateTime: '2026-06-10T09:00:00.000Z' } };
  assert.deepStrictEqual(decideSyncAction(booking, event), { type: 'none' });
});

test('decideSyncAction reschedules when the event was moved in Google', () => {
  const event = { status: 'confirmed', start: { dateTime: '2026-06-10T14:30:00.000Z' } };
  assert.deepStrictEqual(decideSyncAction(booking, event), {
    type: 'reschedule',
    time: '2026-06-10T14:30:00.000Z',
    date: '2026-06-10'
  });
});

test('decideSyncAction ignores all-day events (no dateTime)', () => {
  const event = { status: 'confirmed', start: { date: '2026-06-10' } };
  assert.deepStrictEqual(decideSyncAction(booking, event), { type: 'none' });
});

test('decideSyncAction treats an equal instant in another offset as unchanged', () => {
  const event = { status: 'confirmed', start: { dateTime: '2026-06-10T05:00:00.000-04:00' } };
  assert.deepStrictEqual(decideSyncAction(booking, event), { type: 'none' });
});
