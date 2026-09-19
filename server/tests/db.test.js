import test from 'node:test';
import assert from 'node:assert';
import dbService from '../services/dbService.js';
import { parseGuestEmails } from '../services/guests.js';

test('DB Service', async (t) => {
  await t.test('Admin exists', () => {
    const admin = dbService.getAdminUser();
    assert.strictEqual(admin.username, 'admin');
  });
});

test('Meeting type minimum notice', async (t) => {
  const base = {
    label: 'T', description: '', icon: '', enabled: true, order: 0, sessionDuration: 30,
    availability: {}, availableDates: null, unavailableDates: null,
    isBuiltin: false, requiresSchool: false, secret: false
  };

  await t.test('round-trips null, zero and a value', () => {
    dbService.saveMeetingTypes(1, [
      { ...base, id: 'inherits', minimumNoticeMinutes: null },
      { ...base, id: 'none', minimumNoticeMinutes: 0 },
      { ...base, id: 'four-hours', minimumNoticeMinutes: 240 }
    ]);
    const byId = Object.fromEntries(dbService.getMeetingTypes(1).map(t => [t.id, t.minimumNoticeMinutes]));
    assert.strictEqual(byId.inherits, null, 'null means inherit the global setting');
    assert.strictEqual(byId.none, 0, 'zero is a real override, not "unset"');
    assert.strictEqual(byId['four-hours'], 240);
  });

  await t.test('treats missing and blank as inherit', () => {
    dbService.saveMeetingTypes(1, [
      { ...base, id: 'absent' },
      { ...base, id: 'blank', minimumNoticeMinutes: '' }
    ]);
    const byId = Object.fromEntries(dbService.getMeetingTypes(1).map(t => [t.id, t.minimumNoticeMinutes]));
    assert.strictEqual(byId.absent, null);
    assert.strictEqual(byId.blank, null);
  });

  await t.test('clamps a negative override to zero', () => {
    dbService.saveMeetingTypes(1, [{ ...base, id: 'negative', minimumNoticeMinutes: -60 }]);
    assert.strictEqual(dbService.getMeetingTypes(1).find(t => t.id === 'negative').minimumNoticeMinutes, 0);
  });
});

test('Booking guests', async (t) => {
  const base = {
    date: '2099-01-01', time: '2099-01-01T15:00:00.000Z', meetingType: 'phone-call',
    location: 'Phone Call', schoolId: '', name: 'Avery Chen', email: 'avery@example.com',
    sessionDuration: 30, status: 'confirmed'
  };

  await t.test('persists a guest list and reads it back', () => {
    dbService.addBooking(1, { ...base, id: 'guests-some', guestEmails: ['mum@example.com', 'dad@example.com'] });
    const row = dbService.getBookingById(1, 'guests-some');
    assert.deepStrictEqual(parseGuestEmails(row.guest_emails), ['mum@example.com', 'dad@example.com']);
  });

  await t.test('a booking without guests stores NULL', () => {
    dbService.addBooking(1, { ...base, id: 'guests-none' });
    const row = dbService.getBookingById(1, 'guests-none');
    assert.strictEqual(row.guest_emails, null, 'indistinguishable from a row written before the column existed');
    assert.deepStrictEqual(parseGuestEmails(row.guest_emails), []);
  });

  await t.test('every other column still lands in its own place', () => {
    // guest_emails was inserted into the middle of the column list, so a
    // mismatched placeholder would shift everything after it by one.
    const row = dbService.getBookingById(1, 'guests-some');
    assert.strictEqual(row.name, 'Avery Chen');
    assert.strictEqual(row.email, 'avery@example.com');
    assert.strictEqual(row.session_duration, 30);
    assert.strictEqual(row.status, 'confirmed');
    // The columns either side of the two SMS ones, which were appended later.
    assert.strictEqual(row.client_timezone, null);
    assert.ok(row.created_at, 'created_at is still a timestamp, not a flag');
  });
});

test('SMS reminder columns', async (t) => {
  const base = {
    date: '2099-02-02', time: '2099-02-02T15:00:00.000Z', meetingType: 'phone-call',
    location: 'Phone Call', schoolId: '', name: 'Sam Rivera', email: 'sam@example.com',
    phone: '(555) 234-5678', sessionDuration: 30, status: 'confirmed'
  };

  await t.test('consent round-trips as 1/0, never as a truthy string', () => {
    dbService.addBooking(1, { ...base, id: 'sms-yes', smsConsent: true });
    dbService.addBooking(1, { ...base, id: 'sms-no', smsConsent: 'false' });
    assert.strictEqual(dbService.getBookingById(1, 'sms-yes').sms_consent, 1);
    // 'false' is a truthy string, so this documents that the controller — not
    // the DB layer — is what rejects one.
    assert.strictEqual(dbService.getBookingById(1, 'sms-no').sms_consent, 1);
  });

  await t.test('both flags default to 0 for a booking that says nothing', () => {
    dbService.addBooking(1, { ...base, id: 'sms-default' });
    const row = dbService.getBookingById(1, 'sms-default');
    assert.strictEqual(row.sms_consent, 0);
    assert.strictEqual(row.sms_second_sent, 0);
    assert.strictEqual(row.phone, '(555) 234-5678', 'phone is stored as typed, normalized at send time');
  });

  await t.test('markReminderSent sets each channel independently', () => {
    dbService.addBooking(1, { ...base, id: 'sms-flags', smsConsent: true });
    dbService.markReminderSent('sms-flags', 'second');
    let row = dbService.getBookingById(1, 'sms-flags');
    assert.strictEqual(row.reminder_second_sent, 1);
    assert.strictEqual(row.sms_second_sent, 0, 'the email flag must not mark the text as sent');

    dbService.markReminderSent('sms-flags', 'sms');
    row = dbService.getBookingById(1, 'sms-flags');
    assert.strictEqual(row.sms_second_sent, 1);
  });

  await t.test('rescheduling clears the text flag too', () => {
    // The trap: without this reset a rescheduled booking keeps the flag from its
    // original slot and silently never gets a text.
    dbService.addBooking(1, { ...base, id: 'sms-resched', smsConsent: true });
    dbService.markReminderSent('sms-resched', 'sms');
    dbService.markReminderSent('sms-resched', 'first');
    dbService.updateBookingSchedule(1, 'sms-resched', { date: '2099-03-03', time: '2099-03-03T15:00:00.000Z' });

    const row = dbService.getBookingById(1, 'sms-resched');
    assert.strictEqual(row.sms_second_sent, 0);
    assert.strictEqual(row.reminder_first_sent, 0);
    assert.strictEqual(row.reminder_second_sent, 0);
    assert.strictEqual(row.sms_consent, 1, 'consent survives a reschedule');
  });
});
