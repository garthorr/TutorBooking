import { google } from 'googleapis';
import dbService from '../services/dbService.js';
import { loadTokens, saveTokens } from '../tokenStorage.js';
import { loadSchools, getDriveTimeFromStorage } from '../schoolsStorage.js';
import { loadCalendarConfig } from '../calendarStorage.js';
import { loadMeetingTypes } from '../meetingTypesStorage.js';
import { addBooking as addBookingToDisk, loadBookings } from '../bookingsStorage.js';

const TIMEZONE = process.env.TIMEZONE || 'America/Chicago';

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
  // date is either a Date object (parsed from ISO string) or a YYYY-MM-DD string.
  // Convert to YYYY-MM-DD in TIMEZONE.
  const target = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date(date).toLocaleDateString('en-CA', { timeZone: TIMEZONE });

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
      const blocks = availability[dayOfWeek] || [];
      if (blocks.length === 0) continue;

      // Use noon UTC so tzDate always resolves to the correct TIMEZONE calendar day
      const date = new Date(dateStr + 'T12:00:00.000Z');
      // Pass allEvents instead of filtering by day to avoid boundary issues with all-day events
      const slots = getAvailableSlotsForDay(date, blocks, sessionDuration, allEvents, schoolId, walkTime);
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
    addBookingToDisk([], booking);
    res.status(201).json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create booking' });
  }
};

export const getBookings = (req, res) => {
  res.json({ bookings: loadBookings() });
};
