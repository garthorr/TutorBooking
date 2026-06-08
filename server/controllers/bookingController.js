import { google } from 'googleapis';
import crypto from 'crypto';
import dbService from '../services/dbService.js';
import { loadTokens, saveTokens } from '../tokenStorage.js';
import { loadSchools, getDriveTimeFromStorage } from '../schoolsStorage.js';
import { loadCalendarConfig } from '../calendarStorage.js';
import { loadMeetingTypes } from '../meetingTypesStorage.js';
import { addBooking as addBookingToDisk, loadBookings } from '../bookingsStorage.js';
import { sendConfirmation, sendReschedule, sendCancellation } from '../services/emailService.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const TIMEZONE = process.env.TIMEZONE || 'America/Chicago';
const ADMIN_ID = 1;

// Fallback weekly availability for "Other location" bookings, which have no
// stored per-location schedule. Mirrors the client default (Mon–Fri 9–5).
const CUSTOM_LOCATION_AVAILABILITY = {
  1: [{ start: '09:00', end: '17:00' }],
  2: [{ start: '09:00', end: '17:00' }],
  3: [{ start: '09:00', end: '17:00' }],
  4: [{ start: '09:00', end: '17:00' }],
  5: [{ start: '09:00', end: '17:00' }]
};

function tzDate(baseDate, hours, minutes) {
  const dateStr = baseDate.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const naive = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
  const naiveInTZ = new Date(naive.toLocaleString('en-US', { timeZone: TIMEZONE }));
  return new Date(naive.getTime() + (naive.getTime() - naiveInTZ.getTime()));
}

function initializeGoogleCalendar() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.on('tokens', (tokens) => {
      const current = loadTokens() || {};
      saveTokens({ ...current, ...tokens });
    });
    const savedTokens = loadTokens();
    if (savedTokens) {
      oauth2Client.setCredentials(savedTokens);
      return google.calendar({ version: 'v3', auth: oauth2Client });
    }
    return null;
  } catch (error) {
    return null;
  }
}

let calendar = initializeGoogleCalendar();

async function fetchEventsForPeriod(timeMin, timeMax) {
  if (!calendar) calendar = initializeGoogleCalendar();
  if (!calendar) return [];
  const { checkCalendars } = loadCalendarConfig();
  const ids = checkCalendars.length > 0 ? checkCalendars : ['primary'];
  const results = await Promise.all(
    ids.map(calId =>
      calendar.events.list({
        calendarId: calId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      }).then(r => r.data.items || []).catch(() => [])
    )
  );
  return results.flat();
}

function hasSchedulingConflict(slotStart, slotEnd, events, schoolId, walkTime) {
  for (const event of events) {
    let eventStart, eventEnd;
    if (event.start.date) {
      // All-day event: start.date and end.date are YYYY-MM-DD
      // Use noon UTC to ensure tzDate correctly identifies the calendar day in TIMEZONE
      eventStart = tzDate(new Date(event.start.date + 'T12:00:00.000Z'), 0, 0);
      eventEnd = tzDate(new Date(event.end.date + 'T12:00:00.000Z'), 0, 0);
    } else {
      eventStart = new Date(event.start.dateTime);
      eventEnd = new Date(event.end.dateTime);
    }
    const eventSchoolId = event.extendedProperties?.private?.schoolId;

    if (slotStart < eventEnd && slotEnd > eventStart) return true;

    const driveTimeBefore = getDriveTimeFromStorage(eventSchoolId, schoolId, walkTime);
    if (driveTimeBefore > 0) {
      const bufferEnd = new Date(eventEnd.getTime() + driveTimeBefore * 60 * 1000);
      if (slotStart >= eventEnd && slotStart < bufferEnd) return true;
    }

    const driveTimeAfter = getDriveTimeFromStorage(schoolId, eventSchoolId, walkTime);
    if (driveTimeAfter > 0) {
      const bufferStart = new Date(eventStart.getTime() - driveTimeAfter * 60 * 1000);
      if (slotEnd <= eventStart && slotEnd > bufferStart) return true;
    }
  }
  return false;
}

function getAvailableSlotsForDay(date, availabilityBlocks, sessionDuration, events, schoolId, walkTime) {
  const slots = [];
  const duration = sessionDuration || 60;
  for (const block of availabilityBlocks) {
    const [startH, startM] = block.start.split(':').map(Number);
    const [endH, endM] = block.end.split(':').map(Number);
    let slotStart = tzDate(date, startH, startM);
    const blockEnd = tzDate(date, endH, endM);
    while (slotStart < blockEnd) {
      const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);
      if (slotEnd > blockEnd) break;
      const isBlocked = hasSchedulingConflict(slotStart, slotEnd, events, schoolId, walkTime);
      if (!isBlocked) slots.push({ time: slotStart.toISOString(), available: true, blockName: block.name || null });
      slotStart = new Date(slotStart.getTime() + 5 * 60 * 1000);
    }
  }
  return slots;
}

function isDateInOverrides(date, overrides) {
  if (!overrides || !Array.isArray(overrides)) return false;
  // date is either a Date object or a YYYY-MM-DD string.
  let target;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    target = date;
  } else {
    target = new Date(date).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  }

  return overrides.some(override => {
    if (typeof override === 'string') {
      return override === target;
    } else if (override.start && override.end) {
      return target >= override.start && target <= override.end;
    }
    return false;
  });
}

// Returns YYYY-MM-DD string for a given year/month(0-indexed)/day in TIMEZONE.
function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Returns 0-6 day-of-week from a YYYY-MM-DD string (Sunday=0).
function dayOfWeekFromStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export const getAvailability = async (req, res) => {
  try {
    const { date, schoolId, sessionDuration, availabilityBlocks, availableDates, unavailableDates } = req.body;
    // date is expected to be YYYY-MM-DD
    const tzDateStr = date;

    // Check unavailable dates override
    if (isDateInOverrides(tzDateStr, unavailableDates)) {
      return res.json({ slots: [] });
    }

    // Check available dates override (if present, must be in it)
    if (availableDates && availableDates.length > 0) {
      if (!isDateInOverrides(tzDateStr, availableDates)) {
        return res.json({ slots: [] });
      }
    }

    const dayOfWeek = dayOfWeekFromStr(tzDateStr);
    let blocks = availabilityBlocks;
    if (!blocks) {
      const schools = loadSchools();
      const school = schools.find(s => s.id === schoolId);
      blocks = school?.availability?.[dayOfWeek] || [];
    }
    // Fetch events for the full TIMEZONE calendar day
    const noonUTC = new Date(tzDateStr + 'T12:00:00.000Z');
    const timeMin = tzDate(noonUTC, 0, 0);
    const timeMax = tzDate(noonUTC, 23, 59);
    const events = await fetchEventsForPeriod(timeMin, timeMax);
    const walkTime = dbService.getSettings(1)?.walk_time ?? 5;
    const slots = getAvailableSlotsForDay(noonUTC, blocks, sessionDuration, events, schoolId, walkTime);
    res.json({ slots });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
};

export const getAvailableDays = async (req, res) => {
  try {
    const { year, month, schoolId, sessionDuration, availabilityBlocks, availableDates: mtAvailableDates, unavailableDates: mtUnavailableDates } = req.body;
    let availability = availabilityBlocks;
    if (!availability) {
      const schools = loadSchools();
      const school = schools.find(s => s.id === schoolId);
      availability = school?.availability || {};
    }

    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Fetch events for a slightly larger window to account for timezone differences
    const timeMin = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    timeMin.setHours(timeMin.getHours() - 24);
    const timeMax = new Date(Date.UTC(year, month, daysInMonth, 23, 59, 59));
    timeMax.setHours(timeMax.getHours() + 24);

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const availableDates = [];
    const allEvents = await fetchEventsForPeriod(timeMin, timeMax);
    const walkTime = dbService.getSettings(1)?.walk_time ?? 5;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toDateStr(year, month, d);
      if (dateStr < todayStr) continue;

      if (isDateInOverrides(dateStr, mtUnavailableDates)) continue;
      if (mtAvailableDates && mtAvailableDates.length > 0) {
        if (!isDateInOverrides(dateStr, mtAvailableDates)) continue;
      }

      const dayOfWeek = dayOfWeekFromStr(dateStr);
      let blocks = availability[dayOfWeek] || [];

      // If this date is explicitly ALLOWED but has no weekly blocks,
      // and we have mtAvailableDates, it might be blocking.
      // However, usually overrides should define blocks too if they want specific times.
      // But let's check if blocks is empty.
      if (blocks.length === 0) continue;

      // Use noon UTC so tzDate always resolves to the correct TIMEZONE calendar day
      const date = new Date(dateStr + 'T12:00:00.000Z');
      // Filter events for this day to improve performance, while being careful with all-day events
      const dayEvents = allEvents.filter(e => {
        if (e.start.date) {
          return dateStr >= e.start.date && dateStr < e.end.date;
        }
        const start = new Date(e.start.dateTime);
        return start.toLocaleDateString('en-CA', { timeZone: TIMEZONE }) === dateStr;
      });
      const slots = getAvailableSlotsForDay(date, blocks, sessionDuration, dayEvents, schoolId, walkTime);
      if (slots.length > 0) {
        availableDates.push(dateStr);
      }
    }
    res.json({ availableDates });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch available days' });
  }
};

export const createBooking = async (req, res) => {
  try {
    const { date, time, meetingType, location, schoolId, name, email, phone, notes, sessionDuration } = req.body;
    const booking = {
      id: Date.now().toString(),
      date, time, meetingType, location, schoolId, name, email, phone, notes,
      sessionDuration: sessionDuration || 60,
      status: 'confirmed',
      manageToken: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString()
    };
    if (!calendar) calendar = initializeGoogleCalendar();
    if (calendar) {
      const startDateTime = new Date(time);
      const durationMs = (sessionDuration || 60) * 60 * 1000;
      const endDateTime = new Date(startDateTime.getTime() + durationMs);
      const schools = loadSchools();
      const event = {
        summary: `${name} — Tutoring`,
        description: `Client: ${name}\nEmail: ${email}\nNotes: ${notes}`,
        start: { dateTime: startDateTime.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: endDateTime.toISOString(), timeZone: TIMEZONE },
        attendees: [{ email }],
        extendedProperties: { private: { schoolId: schoolId || '', meetingType } }
      };
      if (meetingType === 'google-meet') {
        event.conferenceData = { createRequest: { requestId: booking.id, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
      } else {
        event.location = location;
      }
      const { bookingCalendar } = loadCalendarConfig();
      const calendarEvent = await calendar.events.insert({
        calendarId: bookingCalendar || 'primary',
        resource: event,
        conferenceDataVersion: meetingType === 'google-meet' ? 1 : 0,
        sendUpdates: 'all'
      });
      booking.calendarEventId = calendarEvent.data.id;
      booking.meetLink = calendarEvent.data.hangoutLink || null;
    }
    // Suppress reminders that would otherwise fire immediately for a booking
    // made inside the reminder window.
    const msUntil = new Date(booking.time).getTime() - Date.now();
    booking.reminder24hSent = msUntil <= DAY_MS;
    booking.reminder1hSent = msUntil <= HOUR_MS;
    addBookingToDisk([], booking);
    sendConfirmation(booking);
    res.status(201).json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create booking' });
  }
};

export const getBookings = (req, res) => {
  res.json({ bookings: loadBookings() });
};

/* ── Cancel & reschedule ──────────────────────────────────────────────────── */

// Resolve the availability rules (weekly blocks + date overrides) that govern a
// given booking, based on its meeting type / school. Used both to drive the
// reschedule UI and to validate a requested new time server-side.
function getRescheduleConfig(booking) {
  const sessionDuration = booking.session_duration || 60;
  const mt = loadMeetingTypes().find(t => t.id === booking.meeting_type);

  if (mt && !mt.requiresSchool) {
    return {
      schoolId: '',
      sessionDuration,
      weeklyAvailability: mt.availability || {},
      availableDates: mt.availableDates || null,
      unavailableDates: mt.unavailableDates || null
    };
  }

  if (booking.school_id && booking.school_id !== '__CUSTOM__') {
    const school = loadSchools().find(s => s.id === booking.school_id);
    return {
      schoolId: booking.school_id,
      sessionDuration,
      weeklyAvailability: school?.availability || {},
      availableDates: null,
      unavailableDates: null
    };
  }

  // "Other location" booking — no stored schedule, use the shared default.
  return {
    schoolId: booking.school_id || 'custom',
    sessionDuration,
    weeklyAvailability: CUSTOM_LOCATION_AVAILABILITY,
    availableDates: null,
    unavailableDates: null
  };
}

// Shape the reschedule config for the client, matching the payload the public
// /api/availability + /api/availability/days endpoints already expect.
function rescheduleParams(booking) {
  const cfg = getRescheduleConfig(booking);
  return {
    schoolId: cfg.schoolId,
    sessionDuration: cfg.sessionDuration,
    availabilityBlocks: cfg.weeklyAvailability,
    availableDates: cfg.availableDates,
    unavailableDates: cfg.unavailableDates
  };
}

// Validate that a requested new start time is a real, conflict-free slot for the
// booking, reusing the same availability + drive-time logic as initial booking.
async function isSlotAvailableForReschedule(booking, newStartISO) {
  const cfg = getRescheduleConfig(booking);
  const newStart = new Date(newStartISO);
  if (isNaN(newStart.getTime())) return false;

  const dateStr = newStart.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  if (dateStr < todayStr) return false;

  if (isDateInOverrides(dateStr, cfg.unavailableDates)) return false;
  if (cfg.availableDates && cfg.availableDates.length > 0 && !isDateInOverrides(dateStr, cfg.availableDates)) return false;

  const dayOfWeek = dayOfWeekFromStr(dateStr);
  const blocks = cfg.weeklyAvailability?.[dayOfWeek] || [];
  if (blocks.length === 0) return false;

  const noonUTC = new Date(dateStr + 'T12:00:00.000Z');
  const timeMin = tzDate(noonUTC, 0, 0);
  const timeMax = tzDate(noonUTC, 23, 59);
  let events = await fetchEventsForPeriod(timeMin, timeMax);
  // Exclude the booking's own calendar event so it doesn't conflict with itself.
  if (booking.calendar_event_id) events = events.filter(e => e.id !== booking.calendar_event_id);

  const walkTime = dbService.getSettings(ADMIN_ID)?.walk_time ?? 5;
  const slots = getAvailableSlotsForDay(noonUTC, blocks, cfg.sessionDuration, events, cfg.schoolId, walkTime);
  return slots.some(s => new Date(s.time).getTime() === newStart.getTime());
}

async function deleteCalendarEvent(eventId) {
  if (!eventId) return;
  if (!calendar) calendar = initializeGoogleCalendar();
  if (!calendar) return;
  const { bookingCalendar } = loadCalendarConfig();
  try {
    await calendar.events.delete({ calendarId: bookingCalendar || 'primary', eventId, sendUpdates: 'all' });
  } catch (error) {
    // Event may have already been removed from Google Calendar — ignore.
  }
}

async function patchCalendarEvent(eventId, newStartISO, durationMin) {
  if (!eventId) return;
  if (!calendar) calendar = initializeGoogleCalendar();
  if (!calendar) return;
  const { bookingCalendar } = loadCalendarConfig();
  const start = new Date(newStartISO);
  const end = new Date(start.getTime() + (durationMin || 60) * 60 * 1000);
  try {
    await calendar.events.patch({
      calendarId: bookingCalendar || 'primary',
      eventId,
      resource: {
        start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: end.toISOString(), timeZone: TIMEZONE }
      },
      sendUpdates: 'all'
    });
  } catch (error) {
    // Best-effort — the local record is still updated below.
  }
}

// A minimal, client-safe view of a booking for the public manage page.
function toPublicBooking(b) {
  return {
    id: b.id,
    date: b.date,
    time: b.time,
    meetingType: b.meeting_type,
    location: b.location,
    name: b.name,
    sessionDuration: b.session_duration,
    status: b.status,
    meetLink: b.meet_link,
    manageToken: b.manage_token
  };
}

async function performCancel(booking) {
  await deleteCalendarEvent(booking.calendar_event_id);
  dbService.updateBookingStatus(booking.user_id, booking.id, 'cancelled');
  sendCancellation(booking);
}

async function performReschedule(booking, time) {
  const ok = await isSlotAvailableForReschedule(booking, time);
  if (!ok) return { error: 'That time is no longer available. Please pick another.', code: 409 };
  await patchCalendarEvent(booking.calendar_event_id, time, booking.session_duration);
  const date = new Date(time).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  dbService.updateBookingSchedule(booking.user_id, booking.id, { date, time });
  const updated = dbService.getBookingById(booking.user_id, booking.id);
  sendReschedule(updated);
  return { booking: updated };
}

// Admin: fetch a single booking plus the rules needed to reschedule it.
export const getBooking = (req, res) => {
  const booking = dbService.getBookingById(ADMIN_ID, req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  res.json({ booking, reschedule: rescheduleParams(booking) });
};

// Admin: cancel a booking by id.
export const cancelBooking = async (req, res) => {
  try {
    const booking = dbService.getBookingById(ADMIN_ID, req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    await performCancel(booking);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
};

// Admin: reschedule a booking by id.
export const rescheduleBooking = async (req, res) => {
  try {
    const booking = dbService.getBookingById(ADMIN_ID, req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Cannot reschedule a cancelled booking' });
    const result = await performReschedule(booking, req.body.time);
    if (result.error) return res.status(result.code || 400).json({ error: result.error });
    res.json({ success: true, booking: result.booking });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reschedule booking' });
  }
};

// Public (token-scoped): fetch a booking and its reschedule rules.
export const getManagedBooking = (req, res) => {
  const booking = dbService.getBookingByToken(req.params.token);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  res.json({ booking: toPublicBooking(booking), reschedule: rescheduleParams(booking) });
};

// Public (token-scoped): cancel a booking.
export const cancelManagedBooking = async (req, res) => {
  try {
    const booking = dbService.getBookingByToken(req.params.token);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'cancelled') await performCancel(booking);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
};

// Public (token-scoped): reschedule a booking.
export const rescheduleManagedBooking = async (req, res) => {
  try {
    const booking = dbService.getBookingByToken(req.params.token);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Cannot reschedule a cancelled booking' });
    const result = await performReschedule(booking, req.body.time);
    if (result.error) return res.status(result.code || 400).json({ error: result.error });
    res.json({ success: true, booking: toPublicBooking(result.booking) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reschedule booking' });
  }
};
