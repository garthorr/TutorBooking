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
  });
});
