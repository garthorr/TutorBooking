import test from 'node:test';
import assert from 'node:assert';
import dbService from '../services/dbService.js';

test('DB Service', async (t) => {
  await t.test('Admin exists', () => {
    const admin = dbService.getAdminUser();
    assert.strictEqual(admin.username, 'admin');
  });
});
