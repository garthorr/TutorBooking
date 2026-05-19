import test from 'node:test';
import assert from 'node:assert';
import dbService from '../services/dbService.js';
import { loadSchools, saveSchools } from '../schoolsStorage.js';

test('Schools CRUD', async (t) => {
  const adminId = 1;

  await t.test('save and load schools with all fields', () => {
    const testSchools = [
      {
        id: 'test-school',
        name: 'Test School',
        address: '123 Test St',
        sessionDuration: 45,
        logoUrl: 'data:image/png;base64,abc',
        availability: { '1': [{ start: '09:00', end: '17:00' }] }
      }
    ];

    saveSchools(testSchools);
    const loaded = loadSchools();

    const school = loaded.find(s => s.id === 'test-school');
    assert.ok(school, 'School should be found');
    assert.strictEqual(school.name, 'Test School');
    assert.strictEqual(school.address, '123 Test St');
    assert.strictEqual(school.sessionDuration, 45);
    assert.strictEqual(school.logoUrl, 'data:image/png;base64,abc');
    assert.deepStrictEqual(school.availability, { '1': [{ start: '09:00', end: '17:00' }] });
  });

  await t.test('save schools with default values', () => {
    const testSchools = [
      {
        id: 'minimal-school',
        name: 'Minimal School',
        address: '456 Min St',
        availability: {}
      }
    ];

    saveSchools(testSchools);
    const loaded = loadSchools();

    const school = loaded.find(s => s.id === 'minimal-school');
    assert.ok(school, 'School should be found');
    assert.strictEqual(school.sessionDuration, 60, 'Should default to 60');
    assert.strictEqual(school.logoUrl, null, 'Should default to null');
  });
});
