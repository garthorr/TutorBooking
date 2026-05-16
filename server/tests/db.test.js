import test from 'node:test';
import assert from 'node:assert';
import dbService from '../services/dbService.js';
import passwordStore from '../passwordStore.js';

test('DBService - user operations', async (t) => {
  await t.test('getAdminUser returns admin user', () => {
    const admin = dbService.getAdminUser();
    assert.strictEqual(admin.username, 'admin');
  });

  await t.test('getUserByUsername returns correct user', () => {
    const admin = dbService.getUserByUsername('admin');
    assert.strictEqual(admin.username, 'admin');
  });
});

test('DBService - settings operations', async (t) => {
  const adminId = 1;
  const initialSettings = dbService.getSettings(adminId);

  await t.test('getSettings returns settings', () => {
    assert.ok(initialSettings);
    assert.strictEqual(initialSettings.user_id, adminId);
  });

  await t.test('updateSettings updates values', () => {
    const newSettings = {
      ...initialSettings,
      businessName: 'Test Business',
      themeColor: '#ff0000'
    };
    dbService.updateSettings(adminId, newSettings);
    const updated = dbService.getSettings(adminId);
    assert.strictEqual(updated.business_name, 'Test Business');
    assert.strictEqual(updated.theme_color, '#ff0000');
  });
});

test('PasswordStore', async (t) => {
  await t.test('verifyPassword with correct password', async () => {
    // Default password 'password' for the hash we used in init.js
    const isValid = await passwordStore.verifyPassword('password');
    assert.strictEqual(isValid, true);
  });

  await t.test('verifyPassword with incorrect password', async () => {
    const isValid = await passwordStore.verifyPassword('wrong-password');
    assert.strictEqual(isValid, false);
  });
});
