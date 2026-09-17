import test from 'node:test';
import assert from 'node:assert';
import dbService from '../services/dbService.js';

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
