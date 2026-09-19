import test from 'node:test';
import assert from 'node:assert';
import { decideReminder, decideSmsReminder } from '../jobs/reminderJob.js';
import { clampLead, normalizeLeads, leadLabel, DEFAULT_REMINDERS, loadSmsChannels } from '../services/reminderConfig.js';
import dbService from '../services/dbService.js';

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


/* ── SMS reminders ──────────────────────────────────────────────────────────
 *
 * The text rides the second reminder's lead time, so these windows track
 * config.secondMinutes. The point of the matrix below is that the second email
 * and the text no longer exclude each other, and that a text still goes out on
 * an install with no email at all.
 */

const smsConfig = { enabled: true, smsEnabled: true, firstMinutes: 1440, secondMinutes: 60 };

// A booking `minutes` from now that is eligible for a text: opted in, textable
// number, nothing sent yet.
function smsBooking(minutes, over = {}) {
  return {
    id: 'b1',
    user_id: 1,
    time: new Date(NOW + minutes * MIN).toISOString(),
    phone: '(555) 234-5678',
    sms_consent: 1,
    sms_second_sent: 0,
    ...over
  };
}

test('no text while the session is further away than the second lead time', () => {
  assert.strictEqual(decideSmsReminder(smsBooking(120), smsConfig, NOW), null);
});

test('a text is due inside the second window, with the number normalized', () => {
  assert.deepStrictEqual(decideSmsReminder(smsBooking(30), smsConfig, NOW), {
    label: 'in 1 hour',
    to: '+15552345678'
  });
});

test('the text follows the second lead time rather than a fixed hour', () => {
  const config = { ...smsConfig, firstMinutes: 1440, secondMinutes: 30 };
  assert.strictEqual(decideSmsReminder(smsBooking(45), config, NOW), null, 'outside the 30-minute window');
  assert.deepStrictEqual(decideSmsReminder(smsBooking(20), config, NOW), {
    label: 'in 30 minutes',
    to: '+15552345678'
  });
});

test('nothing is texted once the session has started', () => {
  assert.strictEqual(decideSmsReminder(smsBooking(0), smsConfig, NOW), null);
  assert.strictEqual(decideSmsReminder(smsBooking(-30), smsConfig, NOW), null);
});

test('a text already attempted is not attempted again', () => {
  assert.strictEqual(decideSmsReminder(smsBooking(30, { sms_second_sent: 1 }), smsConfig, NOW), null);
});

test('no consent, no text', () => {
  assert.strictEqual(decideSmsReminder(smsBooking(30, { sms_consent: 0 }), smsConfig, NOW), null);
});

test('a number we cannot normalize is skipped rather than guessed at', () => {
  for (const phone of [null, '', '555-5678', '+44 7700 900000']) {
    assert.strictEqual(decideSmsReminder(smsBooking(30, { phone }), smsConfig, NOW), null, phone);
  }
});

test('the master reminder switch and the SMS toggle each suppress the text', () => {
  assert.strictEqual(decideSmsReminder(smsBooking(30), { ...smsConfig, enabled: false }, NOW), null);
  assert.strictEqual(decideSmsReminder(smsBooking(30), { ...smsConfig, smsEnabled: false }, NOW), null);
});

test('turning the second reminder off takes the text with it', () => {
  const config = { ...smsConfig, firstMinutes: 1440, secondMinutes: 0 };
  assert.strictEqual(decideSmsReminder(smsBooking(30), config, NOW), null);
});

test('the second email and the text do not exclude each other', () => {
  // Both channels look at the same window and each has its own flag, so every
  // combination is reachable.
  const both = { ...smsBooking(30), reminder_first_sent: 0, reminder_second_sent: 0 };
  assert.deepStrictEqual(decideReminder(both, smsConfig, NOW), { which: 'second', label: 'in 1 hour' });
  assert.ok(decideSmsReminder(both, smsConfig, NOW), 'a text is due alongside the email');

  // Email already sent: the text is still due, because sms_second_sent is a
  // separate column.
  const emailed = { ...both, reminder_second_sent: 1 };
  assert.strictEqual(decideReminder(emailed, smsConfig, NOW), null);
  assert.ok(decideSmsReminder(emailed, smsConfig, NOW), 'the text is not blocked by the email flag');

  // Text already sent: the email is unaffected.
  const texted = { ...both, sms_second_sent: 1 };
  assert.deepStrictEqual(decideReminder(texted, smsConfig, NOW), { which: 'second', label: 'in 1 hour' });
  assert.strictEqual(decideSmsReminder(texted, smsConfig, NOW), null);
});

test('a text goes out on an install with no email configured', () => {
  // decideSmsReminder never consults the email side; runReminderCheck simply
  // skips the email branch when SMTP is unset.
  assert.ok(decideSmsReminder(smsBooking(30), smsConfig, NOW));
});


/* ── Which SMS channels are live ────────────────────────────────────────────
 *
 * loadSmsChannels is the one place that answers this, and both the public
 * booking form and the create-booking path read it. Getting it wrong shows a
 * consent box for texts that never arrive.
 */

// updateSettings writes every column, so a partial save would blank the rest.
function saveSettings(over = {}) {
  dbService.updateSettings(1, {
    googleMeetDuration: 60, customLocationDuration: 60, walkTime: 5,
    minimumNoticeMinutes: 120, maxAdvanceDays: 90, themeColor: '#4f46e5',
    businessName: 'Test', businessDescription: '',
    remindersEnabled: true, reminderFirstMinutes: 1440, reminderSecondMinutes: 60,
    smsRemindersEnabled: false, smsConfirmationEnabled: false, smsChangesEnabled: false,
    ...over
  });
}

async function withTwilio(fn) {
  process.env.TWILIO_ACCOUNT_SID = 'ACtestsid';
  process.env.TWILIO_AUTH_TOKEN = 'test-token';
  process.env.TWILIO_FROM_NUMBER = '+15550001111';
  try {
    return await fn();
  } finally {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  }
}

const NONE = { confirmation: false, reminder: false, changes: false };

test('loadSmsChannels', async (t) => {
  await t.test('nothing is live without Twilio, whatever the toggles say', () => {
    saveSettings({ smsRemindersEnabled: true, smsConfirmationEnabled: true, smsChangesEnabled: true });
    assert.deepStrictEqual(loadSmsChannels(), NONE);
  });

  await t.test('nothing is live with Twilio but every toggle off', async () => {
    saveSettings();
    await withTwilio(() => {
      assert.deepStrictEqual(loadSmsChannels(), NONE);
    });
  });

  await t.test('each toggle switches on only its own channel', async () => {
    await withTwilio(() => {
      saveSettings({ smsConfirmationEnabled: true });
      assert.deepStrictEqual(loadSmsChannels(), { ...NONE, confirmation: true });

      saveSettings({ smsRemindersEnabled: true });
      assert.deepStrictEqual(loadSmsChannels(), { ...NONE, reminder: true });

      saveSettings({ smsChangesEnabled: true });
      assert.deepStrictEqual(loadSmsChannels(), { ...NONE, changes: true });

      saveSettings({ smsConfirmationEnabled: true, smsRemindersEnabled: true, smsChangesEnabled: true });
      assert.deepStrictEqual(loadSmsChannels(), { confirmation: true, reminder: true, changes: true });
    });
  });

  await t.test('only the reminder depends on the schedule', async () => {
    const both = { smsConfirmationEnabled: true, smsChangesEnabled: true, smsRemindersEnabled: true };
    await withTwilio(() => {
      // The reminder text rides the second lead time, so turning that off stops
      // it — but a confirmation and a cancellation are not reminders.
      saveSettings({ ...both, reminderSecondMinutes: 0 });
      assert.deepStrictEqual(loadSmsChannels(), { confirmation: true, reminder: false, changes: true });

      // Same for the master reminder switch.
      saveSettings({ ...both, remindersEnabled: false });
      assert.deepStrictEqual(loadSmsChannels(), { confirmation: true, reminder: false, changes: true });
    });
  });

  // Leave the row as the rest of the suite expects to find it.
  saveSettings();
});
