import test from 'node:test';
import assert from 'node:assert';
import dbService from '../services/dbService.js';
import { getDriveTimeFromStorage, saveSchools } from '../schoolsStorage.js';

test('Drive Time Calculation', async (t) => {
  const adminId = 1;

  // Setup schools first to satisfy foreign key constraints
  const testSchools = [
    { id: 'school-a', name: 'School A', address: 'Addr A', availability: {} },
    { id: 'school-b', name: 'School B', address: 'Addr B', availability: {} },
    { id: 'school-c', name: 'School C', address: 'Addr C', availability: {} },
    { id: 'school-d', name: 'School D', address: 'Addr D', availability: {} }
  ];
  saveSchools(testSchools);

  await t.test('calculates drive time with default walk buffer (5min) and rounding up', () => {
    // Mock settings
    dbService.updateSettings(adminId, {
      googleMeetDuration: 60,
      customLocationDuration: 60,
      walkTimeBuffer: 5,
      themeColor: '#4f46e5',
      businessName: 'Test',
      businessDescription: 'Test'
    });

    // Mock drive times
    dbService.saveDriveTimes(adminId, {
      'school-a': { 'school-b': 12 }
    });

    const time = getDriveTimeFromStorage('school-a', 'school-b');
    // 12 + 5 = 17 -> round up to 20
    assert.strictEqual(time, 20);
  });

  await t.test('calculates drive time with custom walk buffer and rounding up', () => {
    // Update buffer to 10
    dbService.updateSettings(adminId, {
      googleMeetDuration: 60,
      customLocationDuration: 60,
      walkTimeBuffer: 10,
      themeColor: '#4f46e5',
      businessName: 'Test',
      businessDescription: 'Test'
    });

    const time = getDriveTimeFromStorage('school-a', 'school-b');
    // 12 + 10 = 22 -> round up to 25
    assert.strictEqual(time, 25);
  });

  await t.test('rounds up correctly when already a multiple of 5', () => {
     // buffer 5
    dbService.updateSettings(adminId, {
      googleMeetDuration: 60,
      customLocationDuration: 60,
      walkTimeBuffer: 5,
      themeColor: '#4f46e5',
      businessName: 'Test',
      businessDescription: 'Test'
    });

    dbService.saveDriveTimes(adminId, {
      'school-c': { 'school-d': 10 }
    });

    const time = getDriveTimeFromStorage('school-c', 'school-d');
    // 10 + 5 = 15 -> already multiple of 5
    assert.strictEqual(time, 15);
  });
});
