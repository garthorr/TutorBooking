import test from 'node:test';
import assert from 'node:assert';
import { decideReminder } from '../jobs/reminderJob.js';
import { clampLead, normalizeLeads, leadLabel, DEFAULT_REMINDERS } from '../services/reminderConfig.js';

const NOW = Date.parse('2026-06-10T09:00:00.000Z');
const MIN = 60 * 1000;

// A booking `minutes` from now with neither reminder sent yet.
function booking(minutes, sent = {}) {
  return {
    id: 'b1',
    time: new Date(NOW + minutes * MIN).toISOString(),
    reminder_first_sent: sent.first ? 1 : 0,
    reminder_second_sent: sent.second ? 1 : 0
  };
}

const defaults = { enabled: true, firstMinutes: 1440, secondMinutes: 60 };

test('no reminder while the session is further away than the first lead time', () => {
  assert.strictEqual(decideReminder(booking(2000), defaults, NOW), null);
});

test('first reminder fires inside the first window', () => {
  assert.deepStrictEqual(decideReminder(booking(600), defaults, NOW), { which: 'first', label: 'in 1 day' });
});

test('first reminder is skipped once the second window is reached', () => {
  // Otherwise a booking sitting 30 minutes out would send both emails at once.
  assert.deepStrictEqual(decideReminder(booking(30), defaults, NOW), { which: 'second', label: 'in 1 hour' });
});

test('a reminder already sent is not sent again', () => {
  assert.strictEqual(decideReminder(booking(600, { first: true }), defaults, NOW), null);
  assert.strictEqual(decideReminder(booking(30, { second: true }), defaults, NOW), null);
});

test('nothing is sent once the session has started', () => {
  assert.strictEqual(decideReminder(booking(0), defaults, NOW), null);
  assert.strictEqual(decideReminder(booking(-30), defaults, NOW), null);
});

test('disabling reminders silences both', () => {
  const off = { ...defaults, enabled: false };
  assert.strictEqual(decideReminder(booking(600), off, NOW), null);
  assert.strictEqual(decideReminder(booking(30), off, NOW), null);
});

test('a lead time of 0 switches just that reminder off', () => {
  const firstOnly = { enabled: true, firstMinutes: 1440, secondMinutes: 0 };
  // With no second window, the first one runs all the way to the start time.
  assert.deepStrictEqual(decideReminder(booking(30), firstOnly, NOW), { which: 'first', label: 'in 1 day' });

  const secondOnly = { enabled: true, firstMinutes: 0, secondMinutes: 60 };
  assert.strictEqual(decideReminder(booking(600), secondOnly, NOW), null);
  assert.deepStrictEqual(decideReminder(booking(30), secondOnly, NOW), { which: 'second', label: 'in 1 hour' });
});

test('custom lead times are described in the label', () => {
  const config = { enabled: true, firstMinutes: 10080, secondMinutes: 120 };
  assert.deepStrictEqual(decideReminder(booking(5000), config, NOW), { which: 'first', label: 'in 7 days' });
  assert.deepStrictEqual(decideReminder(booking(90), config, NOW), { which: 'second', label: 'in 2 hours' });
});

test('a booking with an unparseable time is skipped rather than throwing', () => {
  assert.strictEqual(decideReminder({ time: 'not a date' }, defaults, NOW), null);
});

test('normalizeLeads puts the earlier reminder first', () => {
  assert.deepStrictEqual(normalizeLeads(60, 1440), { firstMinutes: 1440, secondMinutes: 60 });
  assert.deepStrictEqual(normalizeLeads(1440, 60), { firstMinutes: 1440, secondMinutes: 60 });
});

test('normalizeLeads drops a duplicated lead time instead of sending twice', () => {
  assert.deepStrictEqual(normalizeLeads(60, 60), { firstMinutes: 60, secondMinutes: 0 });
});

test('clampLead keeps 0 but falls back on a missing value', () => {
  assert.strictEqual(clampLead(0, 1440), 0);
  assert.strictEqual(clampLead('', 1440), 1440);
  assert.strictEqual(clampLead(null, 1440), 1440);
  assert.strictEqual(clampLead(undefined, 1440), 1440);
  assert.strictEqual(clampLead('abc', 1440), 1440);
  assert.strictEqual(clampLead(-5, 1440), 1440);
});

test('clampLead caps a lead time at 30 days', () => {
  assert.strictEqual(clampLead(999999, 1440), 30 * 24 * 60);
});

test('leadLabel reads naturally for the values the panel offers', () => {
  assert.strictEqual(leadLabel(15), 'in 15 minutes');
  assert.strictEqual(leadLabel(60), 'in 1 hour');
  assert.strictEqual(leadLabel(240), 'in 4 hours');
  assert.strictEqual(leadLabel(1440), 'in 1 day');
  assert.strictEqual(leadLabel(2880), 'in 2 days');
  assert.strictEqual(leadLabel(90), 'in 1 hour 30 minutes');
});

test('the defaults match the schedule that was hard-coded before', () => {
  assert.deepStrictEqual(DEFAULT_REMINDERS, { enabled: true, firstMinutes: 1440, secondMinutes: 60 });
});
