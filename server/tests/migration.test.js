import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/*
 * The additive migrations in db/database.js, run against a database shaped the
 * way a live one is *before* this feature: no sms_consent, no sms_second_sent,
 * no sms_reminders_enabled.
 *
 * database.js opens its connection and runs its migrations at import time, and
 * reads DATA_DIR at module scope, so each run below points DATA_DIR at a fresh
 * directory and re-imports with a cache-busting query string. A plain re-import
 * would hand back the already-initialized module from tests/setup.js.
 */

// The bookings and settings tables as they stood before this change. Written out
// rather than derived from schema.js, because the point is to pin the old shape.
const OLD_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  meeting_type TEXT NOT NULL,
  location TEXT,
  school_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  guest_emails TEXT,
  session_duration INTEGER NOT NULL,
  calendar_event_id TEXT,
  meet_link TEXT,
  status TEXT DEFAULT 'confirmed',
  manage_token TEXT,
  reminder_first_sent INTEGER DEFAULT 0,
  reminder_second_sent INTEGER DEFAULT 0,
  client_timezone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  user_id INTEGER PRIMARY KEY,
  google_meet_duration INTEGER DEFAULT 60,
  custom_location_duration INTEGER DEFAULT 60,
  walk_time INTEGER DEFAULT 5,
  minimum_notice_minutes INTEGER DEFAULT 120,
  max_advance_days INTEGER DEFAULT 90,
  theme_color TEXT DEFAULT '#4f46e5',
  business_name TEXT,
  business_description TEXT,
  reminders_enabled INTEGER DEFAULT 1,
  reminder_first_minutes INTEGER DEFAULT 1440,
  reminder_second_minutes INTEGER DEFAULT 60
);
`;

function seedOldDatabase(dir) {
  const db = new Database(path.join(dir, 'database.sqlite'));
  db.exec(OLD_SCHEMA);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)').run('admin', 'hash');
  db.prepare('INSERT INTO settings (user_id) VALUES (1)').run();
  db.prepare(`
    INSERT INTO bookings (
      id, user_id, date, time, meeting_type, location, name, email, phone,
      session_duration, status, manage_token, reminder_first_sent,
      reminder_second_sent, client_timezone
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
  `).run(
    'legacy-1', '2099-01-01', '2099-01-01T15:00:00.000Z', 'phone-call', 'Phone Call',
    'Jordan Lee', 'jordan@example.com', '(555) 234-5678', 45, 'confirmed', 'tok-legacy', 'America/New_York'
  );
  db.close();
}

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

test('additive SMS migrations on a pre-feature database', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tutorbooking-migration-'));
  const previousDataDir = process.env.DATA_DIR;
  seedOldDatabase(dir);
  process.env.DATA_DIR = dir;

  let migrated;
  try {
    // Importing runs the migrations as a side effect, exactly as server startup does.
    migrated = (await import('../db/database.js?migration-test=1')).default;

    await t.test('adds the three new columns', () => {
      const bookingCols = columnsOf(migrated, 'bookings');
      assert.ok(bookingCols.includes('sms_consent'));
      assert.ok(bookingCols.includes('sms_second_sent'));
      assert.ok(columnsOf(migrated, 'settings').includes('sms_reminders_enabled'));
    });

    await t.test('the existing booking reads 0 for both flags, with no backfill', () => {
      const row = migrated.prepare('SELECT * FROM bookings WHERE id = ?').get('legacy-1');
      assert.strictEqual(row.sms_consent, 0);
      assert.strictEqual(row.sms_second_sent, 0);
    });

    await t.test('every other column on that row is untouched', () => {
      const row = migrated.prepare('SELECT * FROM bookings WHERE id = ?').get('legacy-1');
      assert.strictEqual(row.name, 'Jordan Lee');
      assert.strictEqual(row.email, 'jordan@example.com');
      assert.strictEqual(row.phone, '(555) 234-5678');
      assert.strictEqual(row.session_duration, 45);
      assert.strictEqual(row.status, 'confirmed');
      assert.strictEqual(row.manage_token, 'tok-legacy');
      assert.strictEqual(row.client_timezone, 'America/New_York');
      // Reminders already sent stay sent: the new column must not disturb them.
      assert.strictEqual(row.reminder_first_sent, 1);
      assert.strictEqual(row.reminder_second_sent, 1);
    });

    await t.test('SMS starts off, so upgrading never begins texting anyone', () => {
      const settings = migrated.prepare('SELECT * FROM settings WHERE user_id = 1').get();
      assert.strictEqual(settings.sms_reminders_enabled, 0);
      // The existing schedule is left exactly as the tutor had it.
      assert.strictEqual(settings.reminders_enabled, 1);
      assert.strictEqual(settings.reminder_first_minutes, 1440);
      assert.strictEqual(settings.reminder_second_minutes, 60);
    });

    await t.test('running the migrations a second time is a no-op', async () => {
      // A second ALTER TABLE for a column that now exists would throw, so simply
      // importing again without error is most of the assertion.
      const again = (await import('../db/database.js?migration-test=2')).default;
      const row = again.prepare('SELECT * FROM bookings WHERE id = ?').get('legacy-1');
      assert.strictEqual(row.sms_consent, 0);
      assert.strictEqual(row.sms_second_sent, 0);
      assert.strictEqual(row.name, 'Jordan Lee');
      again.close();
    });
  } finally {
    try { migrated?.close(); } catch { /* already closed */ }
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
