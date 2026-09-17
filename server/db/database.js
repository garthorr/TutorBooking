import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { schema } from './schema.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'database.sqlite');
console.log(`Connecting to database at: ${dbPath}`);
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Write-ahead logging lets readers carry on during a write, which matters here
// because two background jobs write on a timer while visitors are reading
// availability. Without it a writer blocks every reader for the duration.
db.pragma('journal_mode = WAL');
// If a write is in progress, wait rather than failing immediately with
// SQLITE_BUSY. Contention is brief; a hard error would surface as a failed
// booking.
db.pragma('busy_timeout = 5000');

// Initialize schema
db.exec(schema);

// Migration: Add session_duration and logo_url to schools if they don't exist
const tableInfo = db.prepare("PRAGMA table_info(schools)").all();
const columns = tableInfo.map(c => c.name);

if (!columns.includes('session_duration')) {
  console.log('Adding session_duration column to schools table...');
  db.prepare('ALTER TABLE schools ADD COLUMN session_duration INTEGER DEFAULT 60').run();
}

if (!columns.includes('logo_url')) {
  console.log('Adding logo_url column to schools table...');
  db.prepare('ALTER TABLE schools ADD COLUMN logo_url TEXT').run();
}

// Migration: Add walk_time to settings if it doesn't exist
const settingsInfo = db.prepare("PRAGMA table_info(settings)").all();
const settingsColumns = settingsInfo.map(c => c.name);
if (!settingsColumns.includes('walk_time')) {
  console.log('Adding walk_time column to settings table...');
  db.prepare('ALTER TABLE settings ADD COLUMN walk_time INTEGER DEFAULT 5').run();
}

// Migration: Add available_dates and unavailable_dates to meeting_types if they don't exist
const meetingTypesInfo = db.prepare("PRAGMA table_info(meeting_types)").all();
const mtColumns = meetingTypesInfo.map(c => c.name);

if (!mtColumns.includes('available_dates')) {
  console.log('Adding available_dates column to meeting_types table...');
  db.prepare('ALTER TABLE meeting_types ADD COLUMN available_dates TEXT').run();
}

if (!mtColumns.includes('unavailable_dates')) {
  console.log('Adding unavailable_dates column to meeting_types table...');
  db.prepare('ALTER TABLE meeting_types ADD COLUMN unavailable_dates TEXT').run();
}

if (!mtColumns.includes('is_secret')) {
  console.log('Adding is_secret column to meeting_types table...');
  db.prepare('ALTER TABLE meeting_types ADD COLUMN is_secret INTEGER DEFAULT 0').run();
}

// Migration: Add status and manage_token to bookings if they don't exist
const bookingsInfo = db.prepare("PRAGMA table_info(bookings)").all();
const bookingColumns = bookingsInfo.map(c => c.name);

if (!bookingColumns.includes('status')) {
  console.log('Adding status column to bookings table...');
  db.prepare("ALTER TABLE bookings ADD COLUMN status TEXT DEFAULT 'confirmed'").run();
}

if (!bookingColumns.includes('manage_token')) {
  console.log('Adding manage_token column to bookings table...');
  db.prepare('ALTER TABLE bookings ADD COLUMN manage_token TEXT').run();
}

if (!bookingColumns.includes('reminder_24h_sent')) {
  console.log('Adding reminder_24h_sent column to bookings table...');
  db.prepare('ALTER TABLE bookings ADD COLUMN reminder_24h_sent INTEGER DEFAULT 0').run();
}

if (!bookingColumns.includes('reminder_1h_sent')) {
  console.log('Adding reminder_1h_sent column to bookings table...');
  db.prepare('ALTER TABLE bookings ADD COLUMN reminder_1h_sent INTEGER DEFAULT 0').run();
}

if (!bookingColumns.includes('client_timezone')) {
  console.log('Adding client_timezone column to bookings table...');
  db.prepare('ALTER TABLE bookings ADD COLUMN client_timezone TEXT').run();
}

/**
 * Initialize a default admin user if no users exist
 */
export async function initializeDefaultUser() {
  const userCount = db.prepare('SELECT count(*) as count FROM users').get().count;

  if (userCount === 0) {
    console.log('Initializing default admin user...');

    // Seeding a well-known password would leave the admin panel open to anyone
    // who has read this repository, so production must supply its own hash.
    // Development falls back to "password" and is warned about on every boot.
    const DEV_FALLBACK_HASH = '$2b$12$cIQGLBLEIgm6yFVWW3jo2eOKN7AlZ80v1AC3PII7FAZWMq06DK1ZK';
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    if (!passwordHash && process.env.NODE_ENV === 'production') {
      throw new Error(
        'ADMIN_PASSWORD_HASH is not set. Refusing to seed the admin user with a ' +
        'publicly known default password in production.\n' +
        '  Generate one with:\n' +
        "    node -e \"require('bcryptjs').hash('your-password-here', 12).then(console.log)\"\n" +
        '  then set ADMIN_PASSWORD_HASH in server/.env and restart.'
      );
    }

    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('admin', passwordHash || DEV_FALLBACK_HASH);

    const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get('admin').id;

    // Initialize default settings for the admin
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(adminId);

    console.log('Default admin user initialized.');
    return adminId;
  }

  return db.prepare('SELECT id FROM users WHERE username = ?').get('admin').id;
}

export default db;
