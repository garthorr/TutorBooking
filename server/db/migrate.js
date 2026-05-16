import db from './database.js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

function migrateFile(filename, table, mapFn) {
  const filePath = path.join(DATA_DIR, filename);
  if (existsSync(filePath)) {
    console.log(`Migrating ${filename}...`);
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      mapFn(data);
      console.log(`✓ ${filename} migrated.`);
    } catch (error) {
      console.error(`Error migrating ${filename}:`, error);
    }
  } else {
    console.log(`Skipping ${filename} (not found).`);
  }
}

async function migrate() {
  const adminId = 1; // Default admin ID from init.js

  // Migrate Schools
  migrateFile('schools.json', 'schools', (data) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO schools (id, user_id, name, address, availability) VALUES (?, ?, ?, ?, ?)');
    for (const school of data) {
      stmt.run(school.id, adminId, school.name, school.address, JSON.stringify(school.availability));
    }
  });

  // Migrate Bookings
  migrateFile('bookings.json', 'bookings', (data) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO bookings (
        id, user_id, date, time, meeting_type, location, school_id,
        name, email, phone, notes, session_duration, calendar_event_id,
        meet_link, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of data) {
      stmt.run(
        b.id, adminId, b.date, b.time, b.meetingType, b.location, b.schoolId,
        b.name, b.email, b.phone, b.notes, b.sessionDuration || 60,
        b.calendarEventId, b.meetLink, b.createdAt || new Date().toISOString()
      );
    }
  });

  // Migrate Meeting Types
  migrateFile('meeting-types.json', 'meeting_types', (data) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO meeting_types (
        id, user_id, label, description, icon, enabled, sort_order,
        session_duration, availability, is_builtin, requires_school
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of data) {
      stmt.run(
        t.id, adminId, t.label, t.description, t.icon, t.enabled ? 1 : 0, t.order || 0,
        t.sessionDuration, JSON.stringify(t.availability), t.isBuiltin ? 1 : 0, t.requiresSchool ? 1 : 0
      );
    }
  });

  // Migrate Settings
  migrateFile('settings.json', 'settings', (data) => {
    db.prepare(`
      UPDATE settings SET
        google_meet_duration = ?,
        custom_location_duration = ?,
        theme_color = ?,
        business_name = ?,
        business_description = ?
      WHERE user_id = ?
    `).run(
      data.googleMeetDuration || 60,
      data.customLocationDuration || 60,
      data.themeColor || '#4f46e5',
      data.businessName || '',
      data.businessDescription || '',
      adminId
    );
  });

  // Migrate Calendar Config
  migrateFile('calendar-config.json', 'calendar_config', (data) => {
    db.prepare('INSERT OR REPLACE INTO calendar_config (user_id, check_calendars, booking_calendar) VALUES (?, ?, ?)')
      .run(adminId, JSON.stringify(data.checkCalendars), data.bookingCalendar);
  });

  // Migrate Logo
  migrateFile('logo.json', 'logo', (data) => {
    db.prepare('INSERT OR REPLACE INTO logo (user_id, data_url) VALUES (?, ?)')
      .run(adminId, data.dataUrl);
  });

  // Migrate Drive Times
  migrateFile('drivetimes.json', 'drive_times', (data) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO drive_times (user_id, from_school_id, to_school_id, minutes) VALUES (?, ?, ?, ?)');
    for (const [fromId, targets] of Object.entries(data)) {
      for (const [toId, minutes] of Object.entries(targets)) {
        stmt.run(adminId, fromId, toId, minutes);
      }
    }
  });

  // Migrate OAuth Tokens
  migrateFile('.tokens.json', 'oauth_tokens', (data) => {
    // Note: tokenStorage.js encrypts the whole JSON, migrate.js will store it as is since it's already encrypted
    db.prepare('INSERT OR REPLACE INTO oauth_tokens (user_id, tokens) VALUES (?, ?)')
      .run(adminId, JSON.stringify(data));
  });

  console.log('Migration completed.');
}

migrate();
