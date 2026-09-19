import db from '../db/database.js';
import { serializeGuestEmails } from './guests.js';

// Which per-booking "already sent" flag each reminder channel owns. The text
// has its own so a failed send can be retried apart from the email, and so a
// booking whose email already went out is still eligible for a text.
const REMINDER_FLAGS = {
  first: 'reminder_first_sent',
  second: 'reminder_second_sent',
  sms: 'sms_second_sent'
};

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
        walk_time = ?,
        minimum_notice_minutes = ?,
        max_advance_days = ?,
        theme_color = ?,
        business_name = ?,
        business_description = ?,
        reminders_enabled = ?,
        reminder_first_minutes = ?,
        reminder_second_minutes = ?,
        sms_reminders_enabled = ?,
        sms_confirmation_enabled = ?,
        sms_changes_enabled = ?
      WHERE user_id = ?
    `).run(
      settings.googleMeetDuration,
      settings.customLocationDuration,
      settings.walkTime,
      settings.minimumNoticeMinutes,
      settings.maxAdvanceDays,
      settings.themeColor,
      settings.businessName,
      settings.businessDescription,
      settings.remindersEnabled ? 1 : 0,
      settings.reminderFirstMinutes,
      settings.reminderSecondMinutes,
      settings.smsRemindersEnabled ? 1 : 0,
      settings.smsConfirmationEnabled ? 1 : 0,
      settings.smsChangesEnabled ? 1 : 0,
      userId
    );
  }

  // Bookings
  getBookings(userId) {
    return db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY date DESC, time DESC').all(userId);
  }

  getBookingById(userId, id) {
    return db.prepare('SELECT * FROM bookings WHERE user_id = ? AND id = ?').get(userId, id);
  }

  getBookingByToken(token) {
    if (!token) return undefined;
    return db.prepare('SELECT * FROM bookings WHERE manage_token = ?').get(token);
  }

  addBooking(userId, b) {
    return db.prepare(`
      INSERT INTO bookings (
        id, user_id, date, time, meeting_type, location, school_id,
        name, email, phone, notes, guest_emails, session_duration, calendar_event_id,
        meet_link, status, manage_token, reminder_first_sent, reminder_second_sent,
        client_timezone, sms_consent, sms_second_sent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.id, userId, b.date, b.time, b.meetingType, b.location,
      // Non-school bookings (phone / Google Meet / "other location") have no
      // schools row — store NULL rather than '' to satisfy the FK constraint.
      b.schoolId && b.schoolId !== '__CUSTOM__' ? b.schoolId : null,
      b.name, b.email, b.phone ?? null, b.notes ?? null,
      serializeGuestEmails(b.guestEmails), b.sessionDuration || 60,
      b.calendarEventId ?? null, b.meetLink ?? null, b.status || 'confirmed', b.manageToken || null,
      b.reminderFirstSent ? 1 : 0, b.reminderSecondSent ? 1 : 0,
      b.timezone || null,
      b.smsConsent ? 1 : 0, b.smsSecondSent ? 1 : 0,
      b.createdAt || new Date().toISOString()
    );
  }

  updateBookingStatus(userId, id, status) {
    return db.prepare('UPDATE bookings SET status = ? WHERE user_id = ? AND id = ?').run(status, userId, id);
  }

  updateBookingSchedule(userId, id, { date, time }) {
    // Reset reminder flags so reminders fire again for the new time. sms_second_sent
    // belongs here too: without it a rescheduled booking keeps the flag from its
    // original slot and silently never gets a text.
    return db.prepare('UPDATE bookings SET date = ?, time = ?, reminder_first_sent = 0, reminder_second_sent = 0, sms_second_sent = 0 WHERE user_id = ? AND id = ?')
      .run(date, time, userId, id);
  }

  // Confirmed bookings whose start falls in [startISO, endISO]. Used as a
  // conflict source alongside Google Calendar, so the app still blocks double
  // bookings when no calendar is connected or the Calendar API is unreachable.
  getConfirmedBookingsBetween(startISO, endISO) {
    return db.prepare("SELECT * FROM bookings WHERE status = 'confirmed' AND time >= ? AND time <= ? ORDER BY time ASC")
      .all(startISO, endISO);
  }

  // Confirmed bookings starting after `afterISO`, used by the reminder job.
  getUpcomingConfirmed(afterISO) {
    return db.prepare("SELECT * FROM bookings WHERE status = 'confirmed' AND time > ? ORDER BY time ASC").all(afterISO);
  }

  // `which` is mapped to a column here rather than passed in as one, so no
  // caller can interpolate an arbitrary name into the statement.
  markReminderSent(id, which) {
    const column = REMINDER_FLAGS[which] || REMINDER_FLAGS.first;
    return db.prepare(`UPDATE bookings SET ${column} = 1 WHERE id = ?`).run(id);
  }

  // Schools
  getSchools(userId) {
    return db.prepare('SELECT * FROM schools WHERE user_id = ?').all(userId);
  }

  saveSchools(userId, schools) {
    const newIds = new Set(schools.map(s => s.id));
    const getExistingStmt = db.prepare('SELECT id FROM schools WHERE user_id = ?');
    const nullifyBookingsStmt = db.prepare('UPDATE bookings SET school_id = NULL WHERE school_id = ?');
    const deleteDTStmt = db.prepare('DELETE FROM drive_times WHERE user_id = ? AND (from_school_id = ? OR to_school_id = ?)');
    const deleteSchoolStmt = db.prepare('DELETE FROM schools WHERE id = ? AND user_id = ?');
    const upsertStmt = db.prepare(`
      INSERT INTO schools (id, user_id, name, address, availability, session_duration, logo_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        address = excluded.address,
        availability = excluded.availability,
        session_duration = excluded.session_duration,
        logo_url = excluded.logo_url
    `);

    const transaction = db.transaction((schools) => {
      // Only delete schools that are actually being removed; use upsert for the rest
      // to avoid breaking FK references from bookings and drive_times.
      const existing = getExistingStmt.all(userId);
      for (const { id } of existing) {
        if (!newIds.has(id)) {
          nullifyBookingsStmt.run(id);
          deleteDTStmt.run(userId, id, id);
          deleteSchoolStmt.run(id, userId);
        }
      }
      for (const school of schools) {
        upsertStmt.run(
          school.id,
          userId,
          school.name,
          school.address,
          JSON.stringify(school.availability || {}),
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
      availableDates: r.available_dates ? JSON.parse(r.available_dates) : null,
      unavailableDates: r.unavailable_dates ? JSON.parse(r.unavailable_dates) : null,
      isBuiltin: Boolean(r.is_builtin),
      requiresSchool: Boolean(r.requires_school),
      secret: Boolean(r.is_secret),
      // null means "use the global minimum notice"; a number overrides it.
      minimumNoticeMinutes: r.minimum_notice_minutes ?? null
    }));
  }

  saveMeetingTypes(userId, types) {
    const deleteStmt = db.prepare('DELETE FROM meeting_types WHERE user_id = ?');
    const insertStmt = db.prepare(`
      INSERT INTO meeting_types (
        id, user_id, label, description, icon, enabled, sort_order,
        session_duration, availability, available_dates, unavailable_dates, is_builtin, requires_school, is_secret,
        minimum_notice_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((types) => {
      deleteStmt.run(userId);
      for (const t of types) {
        insertStmt.run(
          t.id, userId, t.label, t.description, t.icon, t.enabled ? 1 : 0, t.order || 0,
          t.sessionDuration,
          JSON.stringify(t.availability),
          JSON.stringify(t.availableDates || null),
          JSON.stringify(t.unavailableDates || null),
          t.isBuiltin ? 1 : 0, t.requiresSchool ? 1 : 0, t.secret ? 1 : 0,
          t.minimumNoticeMinutes === null || t.minimumNoticeMinutes === undefined || t.minimumNoticeMinutes === ''
            ? null : Math.max(0, Math.round(Number(t.minimumNoticeMinutes)))
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
