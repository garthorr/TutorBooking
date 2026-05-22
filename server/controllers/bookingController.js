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
    const eventStart = new Date(event.start.dateTime || event.start.date);
    const eventEnd = new Date(event.end.dateTime || event.end.date);
    const eventSchoolId = event.extendedProperties?.private?.schoolId;

    if (slotStart < eventEnd && slotEnd > eventStart) return true;

    const driveTimeBefore = getDriveTimeFromStorage(eventSchoolId, schoolId, walkTime);
    if (driveTimeBefore > 0) {
      const bufferEnd = new Date(eventEnd.getTime() + driveTimeBefore * 60 * 1000);
      if (slotStart < bufferEnd) return true;
    }

    const driveTimeAfter = getDriveTimeFromStorage(schoolId, eventSchoolId, walkTime);
    if (driveTimeAfter > 0) {
      const bufferStart = new Date(eventStart.getTime() - driveTimeAfter * 60 * 1000);
      if (slotEnd > bufferStart) return true;
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
      slotStart = new Date(slotStart.getTime() + duration * 60 * 1000);
    }
  }
  return slots;
}

function isDateInOverrides(date, overrides) {
  if (!overrides || !Array.isArray(overrides)) return false;
  // date is either a Date object or an ISO string.
  // We want to compare YYYY-MM-DD.
  const d = new Date(date);
  const target = d.toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // YYYY-MM-DD

  return overrides.some(override => {
    if (typeof override === 'string') {
      return override === target;
    } else if (override.start && override.end) {
      return target >= override.start && target <= override.end;
    }
    return false;
  });
}

export const getAvailability = async (req, res) => {
  try {
    const { date, schoolId, sessionDuration, availabilityBlocks, availableDates, unavailableDates } = req.body;
    const selectedDate = new Date(date);

    // Check unavailable dates override
    if (isDateInOverrides(selectedDate, unavailableDates)) {
      return res.json({ slots: [] });
    }

    // Check available dates override (if present, must be in it)
    if (availableDates && availableDates.length > 0) {
      if (!isDateInOverrides(selectedDate, availableDates)) {
        return res.json({ slots: [] });
      }
    }

    const dayOfWeek = selectedDate.getDay();
    let blocks = availabilityBlocks;
    if (!blocks) {
      const schools = loadSchools();
      const school = schools.find(s => s.id === schoolId);
      blocks = school?.availability?.[dayOfWeek] || [];
    }
    const timeMin = new Date(selectedDate); timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(selectedDate); timeMax.setHours(23, 59, 59, 999);
    const events = await fetchEventsForPeriod(timeMin, timeMax);
    const walkTime = dbService.getSettings(1)?.walk_time ?? 5;
    const slots = getAvailableSlotsForDay(selectedDate, blocks, sessionDuration, events, schoolId, walkTime);
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
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const availableDates = [];
    const allEvents = await fetchEventsForPeriod(firstDay, lastDay);
    const walkTime = dbService.getSettings(1)?.walk_time ?? 5;
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      if (date < today) continue;

      // Check overrides
      if (isDateInOverrides(date, mtUnavailableDates)) continue;
      if (mtAvailableDates && mtAvailableDates.length > 0) {
        if (!isDateInOverrides(date, mtAvailableDates)) continue;
      }

      const dayOfWeek = date.getDay();
      const blocks = availability[dayOfWeek] || [];
      if (blocks.length === 0) continue;
      const dayEvents = allEvents.filter(e => {
        const start = new Date(e.start.dateTime || e.start.date);
        return start.getFullYear() === year && start.getMonth() === month && start.getDate() === d;
      });
      const slots = getAvailableSlotsForDay(date, blocks, sessionDuration, dayEvents, schoolId, walkTime);
      if (slots.length > 0) {
        availableDates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
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
