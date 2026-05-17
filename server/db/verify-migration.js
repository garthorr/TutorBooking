import db from './database.js';

const tables = [
  'users', 'schools', 'bookings', 'meeting_types',
  'settings', 'oauth_tokens', 'drive_times',
  'calendar_config', 'logo'
];

console.log('--- Migration Verification ---');
for (const table of tables) {
  const result = db.prepare(`SELECT count(*) as count FROM ${table}`).get();
  console.log(`${table}: ${result.count} records`);
}
console.log('--- Verification Done ---');
