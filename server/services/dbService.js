import db from '../db/database.js';

class DBService {
  // Common database operations
  getUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  }

  getAdminUser() {
    return db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  }

  // Settings
  getSettings(userId) {
    return db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  }

  updateSettings(userId, settings) {
    return db.prepare(`
      UPDATE settings SET
        google_meet_duration = ?,
        custom_location_duration = ?,
        walk_time_buffer = ?,
        theme_color = ?,
        business_name = ?,
        business_description = ?
      WHERE user_id = ?
    `).run(
      settings.googleMeetDuration,
      settings.customLocationDuration,
      settings.walkTimeBuffer || 5,
      settings.themeColor,
      settings.businessName,
      settings.businessDescription,
      userId
    );
  }

  // Bookings
  getBookings(userId) {
    return db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY date DESC, time DESC').all(userId);
  }

  addBooking(userId, b) {
    return db.prepare(`
      INSERT INTO bookings (
        id, user_id, date, time, meeting_type, location, school_id,
        name, email, phone, notes, session_duration, calendar_event_id,
        meet_link, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.id, userId, b.date, b.time, b.meetingType, b.location, b.schoolId,
      b.name, b.email, b.phone, b.notes, b.sessionDuration || 60,
      b.calendarEventId, b.meetLink, b.createdAt || new Date().toISOString()
    );
  }

  // Schools
  getSchools(userId) {
    return db.prepare('SELECT * FROM schools WHERE user_id = ?').all(userId);
  }

  saveSchools(userId, schools) {
    const deleteStmt = db.prepare('DELETE FROM schools WHERE user_id = ?');
    const insertStmt = db.prepare('INSERT INTO schools (id, user_id, name, address, availability, session_duration, logo_url) VALUES (?, ?, ?, ?, ?, ?, ?)');

    const transaction = db.transaction((schools) => {
      deleteStmt.run(userId);
      for (const school of schools) {
        insertStmt.run(
          school.id,
          userId,
          school.name,
          school.address,
          JSON.stringify(school.availability),
          school.sessionDuration || 60,
          school.logoUrl || null
        );
      }
    });

    transaction(schools);
    return true;
  }

  // Drive Times
  getDriveTimes(userId) {
    const rows = db.prepare('SELECT * FROM drive_times WHERE user_id = ?').all(userId);
    const driveTimes = {};
    for (const row of rows) {
      if (!driveTimes[row.from_school_id]) driveTimes[row.from_school_id] = {};
      driveTimes[row.from_school_id][row.to_school_id] = row.minutes;
    }
    return driveTimes;
  }

  saveDriveTimes(userId, driveTimes) {
    const deleteStmt = db.prepare('DELETE FROM drive_times WHERE user_id = ?');
    const insertStmt = db.prepare('INSERT INTO drive_times (user_id, from_school_id, to_school_id, minutes) VALUES (?, ?, ?, ?)');

    const transaction = db.transaction((driveTimes) => {
      deleteStmt.run(userId);
      for (const [fromId, targets] of Object.entries(driveTimes)) {
        for (const [toId, minutes] of Object.entries(targets)) {
          insertStmt.run(userId, fromId, toId, minutes);
        }
      }
    });

    transaction(driveTimes);
    return true;
  }

  // OAuth Tokens
  getTokens(userId) {
    const row = db.prepare('SELECT tokens FROM oauth_tokens WHERE user_id = ?').get(userId);
    return row ? JSON.parse(row.tokens) : null;
  }

  saveTokens(userId, tokens) {
    return db.prepare('INSERT OR REPLACE INTO oauth_tokens (user_id, tokens, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run(userId, JSON.stringify(tokens));
  }

  deleteTokens(userId) {
    return db.prepare('DELETE FROM oauth_tokens WHERE user_id = ?').run(userId);
  }

  // Calendar Config
  getCalendarConfig(userId) {
    const row = db.prepare('SELECT * FROM calendar_config WHERE user_id = ?').get(userId);
    if (!row) return null;
    return {
      checkCalendars: JSON.parse(row.check_calendars),
      bookingCalendar: row.booking_calendar
    };
  }

  saveCalendarConfig(userId, config) {
    return db.prepare('INSERT OR REPLACE INTO calendar_config (user_id, check_calendars, booking_calendar) VALUES (?, ?, ?)')
      .run(userId, JSON.stringify(config.checkCalendars), config.bookingCalendar);
  }

  // Meeting Types
  getMeetingTypes(userId) {
    const rows = db.prepare('SELECT * FROM meeting_types WHERE user_id = ? ORDER BY sort_order ASC').all(userId);
    return rows.map(r => ({
      id: r.id,
      label: r.label,
      description: r.description,
      icon: r.icon,
      enabled: Boolean(r.enabled),
      order: r.sort_order,
      sessionDuration: r.session_duration,
      availability: r.availability ? JSON.parse(r.availability) : null,
      isBuiltin: Boolean(r.is_builtin),
      requiresSchool: Boolean(r.requires_school)
    }));
  }

  saveMeetingTypes(userId, types) {
    const deleteStmt = db.prepare('DELETE FROM meeting_types WHERE user_id = ?');
    const insertStmt = db.prepare(`
      INSERT INTO meeting_types (
        id, user_id, label, description, icon, enabled, sort_order,
        session_duration, availability, is_builtin, requires_school
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((types) => {
      deleteStmt.run(userId);
      for (const t of types) {
        insertStmt.run(
          t.id, userId, t.label, t.description, t.icon, t.enabled ? 1 : 0, t.order || 0,
          t.sessionDuration, JSON.stringify(t.availability), t.isBuiltin ? 1 : 0, t.requiresSchool ? 1 : 0
        );
      }
    });

    transaction(types);
    return true;
  }

  // Logo
  getLogo(userId) {
    return db.prepare('SELECT * FROM logo WHERE user_id = ?').get(userId);
  }

  saveLogo(userId, dataUrl) {
    return db.prepare('INSERT OR REPLACE INTO logo (user_id, data_url) VALUES (?, ?)')
      .run(userId, dataUrl);
  }

  deleteLogo(userId) {
    return db.prepare('DELETE FROM logo WHERE user_id = ?').run(userId);
  }
}

export default new DBService();
