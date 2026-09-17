process.env.TIMEZONE = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import { decideSyncAction, resolveBookingEvents } from '../services/calendarSync.js';

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

/* ── resolveBookingEvents: one list call, with a safety net ───────────────── */

// Minimal fake of the Google Calendar client, counting how it is called.
function fakeCalendar({ listPages = [[]], getById = {}, listThrows = false, getThrows = null } = {}) {
  const calls = { list: 0, get: 0, gotIds: [] };
  return {
    calls,
    events: {
      list: async () => {
        calls.list++;
        if (listThrows) throw new Error('quota exceeded');
        const page = listPages[calls.list - 1] || [];
        return { data: { items: page, nextPageToken: calls.list < listPages.length ? 'next' : undefined } };
      },
      get: async ({ eventId }) => {
        calls.get++;
        calls.gotIds.push(eventId);
        if (getThrows) throw getThrows;
        if (eventId in getById) return { data: getById[eventId] };
        const err = new Error('Not Found'); err.code = 404; throw err;
      }
    }
  };
}

const bookingAt = (id, eventId, iso) => ({ id, calendar_event_id: eventId, time: iso, user_id: 1 });

test('resolveBookingEvents uses a single list call for events in the window', async () => {
  const b1 = bookingAt('b1', 'e1', '2026-06-10T15:00:00.000Z');
  const b2 = bookingAt('b2', 'e2', '2026-06-11T15:00:00.000Z');
  const cal = fakeCalendar({ listPages: [[
    { id: 'e1', start: { dateTime: '2026-06-10T15:00:00.000Z' } },
    { id: 'e2', start: { dateTime: '2026-06-11T15:00:00.000Z' } }
  ]] });
  const resolved = await resolveBookingEvents(cal, 'primary', [b1, b2]);
  assert.strictEqual(cal.calls.list, 1, 'one list call');
  assert.strictEqual(cal.calls.get, 0, 'no per-booking gets');
  assert.strictEqual(resolved.get('b1').id, 'e1');
  assert.strictEqual(resolved.get('b2').id, 'e2');
});

test('resolveBookingEvents confirms a missing event with a direct get, so a moved event is not read as deleted', async () => {
  const b = bookingAt('b1', 'e1', '2026-06-10T15:00:00.000Z');
  // Absent from the window, but alive a year later.
  const moved = { id: 'e1', start: { dateTime: '2027-06-10T15:00:00.000Z' } };
  const cal = fakeCalendar({ listPages: [[]], getById: { e1: moved } });
  const resolved = await resolveBookingEvents(cal, 'primary', [b]);
  assert.strictEqual(cal.calls.get, 1, 'falls back to a direct get');
  assert.strictEqual(resolved.get('b1'), moved, 'the moved event is found, not treated as gone');
  assert.strictEqual(decideSyncAction(b, resolved.get('b1')).type, 'reschedule');
});

test('resolveBookingEvents reports a genuinely deleted event as null', async () => {
  const b = bookingAt('b1', 'gone', '2026-06-10T15:00:00.000Z');
  const cal = fakeCalendar({ listPages: [[]] });
  const resolved = await resolveBookingEvents(cal, 'primary', [b]);
  assert.strictEqual(resolved.get('b1'), null);
  assert.strictEqual(decideSyncAction(b, resolved.get('b1')).type, 'cancel');
});

test('resolveBookingEvents falls back to gets when the list call fails', async () => {
  const b = bookingAt('b1', 'e1', '2026-06-10T15:00:00.000Z');
  const live = { id: 'e1', start: { dateTime: '2026-06-10T15:00:00.000Z' } };
  const cal = fakeCalendar({ listThrows: true, getById: { e1: live } });
  const resolved = await resolveBookingEvents(cal, 'primary', [b]);
  assert.strictEqual(resolved.get('b1'), live, 'a failed list must not cancel every booking');
});

test('resolveBookingEvents leaves a booking unresolved when its lookup errors', async () => {
  const b = bookingAt('b1', 'e1', '2026-06-10T15:00:00.000Z');
  const cal = fakeCalendar({ listPages: [[]], getThrows: Object.assign(new Error('500'), { code: 500 }) });
  const resolved = await resolveBookingEvents(cal, 'primary', [b]);
  assert.strictEqual(resolved.has('b1'), false, 'skipped this run, retried next - never read as deleted');
});

test('resolveBookingEvents follows pagination', async () => {
  const b = bookingAt('b1', 'e2', '2026-06-10T15:00:00.000Z');
  const cal = fakeCalendar({ listPages: [
    [{ id: 'e1', start: { dateTime: '2026-06-10T14:00:00.000Z' } }],
    [{ id: 'e2', start: { dateTime: '2026-06-10T15:00:00.000Z' } }]
  ] });
  const resolved = await resolveBookingEvents(cal, 'primary', [b]);
  assert.strictEqual(cal.calls.list, 2, 'second page fetched');
  assert.strictEqual(cal.calls.get, 0, 'found on page two, no fallback needed');
  assert.strictEqual(resolved.get('b1').id, 'e2');
});
