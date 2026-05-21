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

// Migration: Add walk_time_buffer to settings if it doesn't exist
const settingsInfo = db.prepare("PRAGMA table_info(settings)").all();
const settingsColumns = settingsInfo.map(c => c.name);

if (!settingsColumns.includes('walk_time_buffer')) {
  console.log('Adding walk_time_buffer column to settings table...');
  db.prepare('ALTER TABLE settings ADD COLUMN walk_time_buffer INTEGER DEFAULT 5').run();
}

/**
 * Initialize a default admin user if no users exist
 */
export async function initializeDefaultUser() {
  const userCount = db.prepare('SELECT count(*) as count FROM users').get().count;

  if (userCount === 0) {
    console.log('Initializing default admin user...');
    // Use hash for 'password' if not set in .env
    const passwordHash = process.env.ADMIN_PASSWORD_HASH || '$2b$12$cIQGLBLEIgm6yFVWW3jo2eOKN7AlZ80v1AC3PII7FAZWMq06DK1ZK';

    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('admin', passwordHash);

    const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get('admin').id;

    // Initialize default settings for the admin
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(adminId);

    console.log('Default admin user initialized.');
    return adminId;
  }

  return db.prepare('SELECT id FROM users WHERE username = ?').get('admin').id;
}

export default db;
