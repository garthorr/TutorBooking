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
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(schema);

/**
 * Initialize a default admin user if no users exist
 */
export async function initializeDefaultUser() {
  const userCount = db.prepare('SELECT count(*) as count FROM users').get().count;

  if (userCount === 0) {
    console.log('Initializing default admin user...');
    // $2b$12$cIQGLBLEIgm6yFVWW3jo2eOKN7AlZ80v1AC3PII7FAZWMq06DK1ZK is 'password'
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
