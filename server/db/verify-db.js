import db from './database.js';

const tables = [
  'users', 'schools', 'bookings', 'meeting_types',
  'settings', 'oauth_tokens', 'drive_times',
  'calendar_config', 'logo'
];

let allOk = true;

for (const table of tables) {
  const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (result) {
    console.log(`✓ Table '${table}' exists.`);
  } else {
    console.error(`✗ Table '${table}' is MISSING!`);
    allOk = false;
  }
}

const adminUser = db.prepare("SELECT * FROM users WHERE username='admin'").get();
if (adminUser) {
  console.log(`✓ Admin user exists (ID: ${adminUser.id}).`);
} else {
  console.error(`✗ Admin user is MISSING!`);
  allOk = false;
}

if (allOk) {
  console.log('\nVerification SUCCESSFUL');
  process.exit(0);
} else {
  console.log('\nVerification FAILED');
  process.exit(1);
}
