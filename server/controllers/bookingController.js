import crypto from 'crypto';
import dbService from '../services/dbService.js';
import { loadSchools, createDriveTimeResolver } from '../schoolsStorage.js';
import { loadCalendarConfig } from '../calendarStorage.js';
import { loadMeetingTypes } from '../meetingTypesStorage.js';
import { CUSTOM_LOCATION_AVAILABILITY } from '../customLocationConfig.js';
import { addBooking as addBookingToDisk, loadBookings } from '../bookingsStorage.js';
import { sendConfirmation, sendReschedule, sendCancellation, notifyAdminOfBooking, manageUrl } from '../services/emailService.js';
import { normalizeGuestEmails, parseGuestEmails } from '../services/guests.js';
import { verifyCaptcha } from '../services/captchaService.js';
import { getCalendar } from '../services/googleClient.js';
import {
  tzDate,
  toDateStr,
  dayOfWeekFromStr,
  isDateInOverrides,
  getAvailableSlotsForDay
} from '../services/availability.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const TIMEZONE = process.env.TIMEZONE || 'America/Chicago';
const ADMIN_ID = 1;

// Sentinel the client sends for the "Other location" tile.
const CUSTOM_LOCATION_ID = '__CUSTOM__';
// Drive-time key used for custom locations. Matches what the client sends to
// the availability endpoints, so travel buffers resolve identically whether a
// slot is being listed or booked.
const CUSTOM_DRIVE_TIME_ID = 'custom';

async function fetchEventsForPeriod(timeMin, timeMax) {
  const calendar = getCalendar();
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

/*
 * The earliest instant a session may start.
 *
 * On a day with nothing booked, this is the only thing standing between a
 * visitor and a session starting in five minutes. It is a floor on the whole
 * day and is independent of travel buffers, which space sessions apart from
 * each other; a slot has to satisfy both.
 *
 * Admin-initiated bookings pass bypass=true: the rule exists to stop the tutor
 * being ambushed, and the tutor booking someone in themselves is not an ambush.
 */
function earliestBookableStart(bypass = false, noticeMinutes = null) {
  const now = Date.now();
  if (bypass) return new Date(now);
  const minutes = noticeMinutes ?? dbService.getSettings(ADMIN_ID)?.minimum_notice_minutes ?? 120;
  return new Date(now + Math.max(0, minutes) * 60 * 1000);
}

// A meeting type may override the global notice — a phone call is worth taking
// at short notice even when a school visit is not. null means inherit.
// Resolved from the stored type by id, never from a value the client sends.
function noticeForMeetingType(meetingTypeId) {
  if (!meetingTypeId) return null;
  const mt = loadMeetingTypes().find(t => t.id === meetingTypeId);
  return mt?.minimumNoticeMinutes ?? null;
}

/*
 * The latest instant a session may start, or null when unbounded.
 *
 * The booking page's calendar already stopped at 90 days, but only in the UI —
 * the API accepted any future date, so a direct request could book years out.
 * Admin bookings are unbounded for the same reason they skip the notice: the
 * limit protects the tutor from the public, not from themselves.
 */
function latestBookableStart(bypass = false) {
  if (bypass) return null;
  const days = dbService.getSettings(ADMIN_ID)?.max_advance_days ?? 90;
  return new Date(Date.now() + Math.max(1, days) * DAY_MS);
}

// The app's own confirmed bookings, shaped like Google Calendar events so the
// same conflict logic covers both.
//
// Google Calendar alone is not a safe source of truth here: fetchEventsForPeriod
// returns [] when no calendar is connected AND when the Calendar API call fails,
// so relying on it alone means every slot looks free — and the same slot can be
// booked over and over — before a calendar is linked, after tokens expire, or
// during a Google outage.
function bookingsAsEvents(timeMin, timeMax, excludeBookingId = null) {
  // Pad the window so bookings stored in a non-UTC ISO format are still caught;
  // hasSchedulingConflict does the precise overlap maths on parsed dates.
  const pad = DAY_MS;
  const rows = dbService.getConfirmedBookingsBetween(
    new Date(timeMin.getTime() - pad).toISOString(),
    new Date(timeMax.getTime() + pad).toISOString()
  );
  const events = [];
  for (const b of rows) {
    if (excludeBookingId && b.id === excludeBookingId) continue;
    const start = new Date(b.time);
    if (isNaN(start.getTime())) continue;
    events.push({
      id: `booking:${b.id}`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: new Date(start.getTime() + (b.session_duration || 60) * 60 * 1000).toISOString() },
      extendedProperties: { private: { schoolId: b.school_id || '' } }
    });
  }
  return events;
}

// Google Calendar events plus the app's own bookings for the same window.
async function fetchBusyForPeriod(timeMin, timeMax, excludeBookingId = null) {
  const events = await fetchEventsForPeriod(timeMin, timeMax);
  return events.concat(bookingsAsEvents(timeMin, timeMax, excludeBookingId));
}

async function handleAvailability(req, res, bypassNotice = false) {
  try {
    const { date, schoolId, sessionDuration, availabilityBlocks, availableDates, unavailableDates, meetingType } = req.body;
    // The client sends only the id; the notice value is read from the stored
    // meeting type, so it cannot be widened by a crafted request.
    const notice = noticeForMeetingType(meetingType);
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
    const events = await fetchBusyForPeriod(timeMin, timeMax);
    const walkTime = dbService.getSettings(1)?.walk_time ?? 5;
    const slots = getAvailableSlotsForDay(noonUTC, blocks, sessionDuration, events, schoolId, walkTime, createDriveTimeResolver(), earliestBookableStart(bypassNotice, notice), latestBookableStart(bypassNotice));
    res.json({ slots });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
}

export const getAvailability = (req, res) => handleAvailability(req, res);
// Admin slot picker: shows times inside the minimum-notice window, which the
// admin is allowed to book into.
export const getAvailabilityAsAdmin = (req, res) => handleAvailability(req, res, true);

async function handleAvailableDays(req, res, bypassNotice = false) {
  try {
    const { year, month, schoolId, sessionDuration, availabilityBlocks, availableDates: mtAvailableDates, unavailableDates: mtUnavailableDates, meetingType } = req.body;
    const notice = noticeForMeetingType(meetingType);
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
    const allEvents = await fetchBusyForPeriod(timeMin, timeMax);
    const walkTime = dbService.getSettings(1)?.walk_time ?? 5;
    // One drive-time read for the whole month, not one per lookup.
    const getDriveTime = createDriveTimeResolver();
    const now = earliestBookableStart(bypassNotice, notice);
    const latest = latestBookableStart(bypassNotice);
    const latestDateStr = latest ? latest.toLocaleDateString('en-CA', { timeZone: TIMEZONE }) : null;
    // Working out which calendar day a timed event falls on costs a timezone
    // conversion, so do it once per event and bucket by day. Re-deriving it for
    // every day of the month made this the most expensive part of the request.
    const timedByDay = new Map();
    const allDayEvents = [];
    for (const e of allEvents) {
      if (e.start?.date) { allDayEvents.push(e); continue; }
      if (!e.start?.dateTime) continue;
      const key = new Date(e.start.dateTime).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
      const bucket = timedByDay.get(key);
      if (bucket) bucket.push(e); else timedByDay.set(key, [e]);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toDateStr(year, month, d);
      if (dateStr < todayStr) continue;
      if (latestDateStr && dateStr > latestDateStr) break;

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
      // Timed events come from the pre-built index; all-day events span a range
      // so they are still checked per day, but there are few of them.
      const dayEvents = (timedByDay.get(dateStr) || [])
        .concat(allDayEvents.filter(e => dateStr >= e.start.date && dateStr < e.end.date));
      const slots = getAvailableSlotsForDay(date, blocks, sessionDuration, dayEvents, schoolId, walkTime, getDriveTime, now, latest);
      if (slots.length > 0) {
        availableDates.push(dateStr);
      }
    }
    res.json({ availableDates });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch available days' });
  }
}

export const getAvailableDays = (req, res) => handleAvailableDays(req, res);
export const getAvailableDaysAsAdmin = (req, res) => handleAvailableDays(req, res, true);

/* ── Server-side availability rules ────────────────────────────────── */

// Resolve the availability rules governing a *requested* booking. Everything
// here comes from stored config — the request body only chooses which meeting
// type and location to look up. A caller therefore cannot invent a schedule, a
// session length, or a meeting type that is disabled or does not exist.
// Returns { config } or { error } with a client-safe message.
function resolveBookingConfig(meetingTypeId, schoolId) {
  const mt = loadMeetingTypes().find(t => t.id === meetingTypeId);
  if (!mt || !mt.enabled) return { error: 'That meeting type is not available.' };

  if (!mt.requiresSchool) {
    return {
      config: {
        schoolId: '',
        sessionDuration: mt.sessionDuration || 60,
        weeklyAvailability: mt.availability || {},
        availableDates: mt.availableDates || null,
        unavailableDates: mt.unavailableDates || null,
        minimumNoticeMinutes: mt.minimumNoticeMinutes ?? null
      }
    };
  }

  if (schoolId && schoolId !== CUSTOM_LOCATION_ID) {
    const school = loadSchools().find(s => s.id === schoolId);
    if (!school) return { error: 'That location is not available.' };
    return {
      config: {
        schoolId: school.id,
        sessionDuration: school.sessionDuration || 60,
        weeklyAvailability: school.availability || {},
        availableDates: null,
        unavailableDates: null,
        // The schedule comes from the school, but the notice is a property of
        // how you are meeting, so it still comes from the meeting type.
        minimumNoticeMinutes: mt.minimumNoticeMinutes ?? null
      }
    };
  }

  // "Other location" — no stored schedule, so use the shared default.
  return {
    config: {
      schoolId: CUSTOM_DRIVE_TIME_ID,
      sessionDuration: dbService.getSettings(ADMIN_ID)?.custom_location_duration || 60,
      weeklyAvailability: CUSTOM_LOCATION_AVAILABILITY,
      availableDates: null,
      unavailableDates: null,
      minimumNoticeMinutes: mt.minimumNoticeMinutes ?? null
    }
  };
}

// Is `startISO` a slot we would actually have offered under `cfg`? Regenerates
// the day's slots with the same logic that built them for the client and
// requires an exact match, which rejects times outside the weekly blocks,
// off-grid times, overridden dates, past days and double-bookings in one pass.
// `excludeEventId` drops a booking's own calendar event so a reschedule does
// not conflict with itself.
async function isSlotAvailable(cfg, startISO, exclude = {}, bypassNotice = false) {
  const start = new Date(startISO);
  if (isNaN(start.getTime())) return false;

  const dateStr = start.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  if (dateStr < todayStr) return false;

  if (isDateInOverrides(dateStr, cfg.unavailableDates)) return false;
  if (cfg.availableDates && cfg.availableDates.length > 0 && !isDateInOverrides(dateStr, cfg.availableDates)) return false;

  const dayOfWeek = dayOfWeekFromStr(dateStr);
  const blocks = cfg.weeklyAvailability?.[dayOfWeek] || [];
  if (blocks.length === 0) return false;

  const noonUTC = new Date(dateStr + 'T12:00:00.000Z');
  let events = await fetchBusyForPeriod(tzDate(noonUTC, 0, 0), tzDate(noonUTC, 23, 59), exclude.bookingId || null);
  if (exclude.eventId) events = events.filter(e => e.id !== exclude.eventId);

  const walkTime = dbService.getSettings(ADMIN_ID)?.walk_time ?? 5;
  const slots = getAvailableSlotsForDay(noonUTC, blocks, cfg.sessionDuration, events, cfg.schoolId, walkTime, createDriveTimeResolver(), earliestBookableStart(bypassNotice, cfg.minimumNoticeMinutes ?? null), latestBookableStart(bypassNotice));
  return slots.some(s => new Date(s.time).getTime() === start.getTime());
}

// Basic validation/limits for the public booking endpoint.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateBookingInput(b) {
  if (!b.name || !b.email || !b.time || !b.meetingType) return 'Missing required booking fields';
  if (typeof b.email !== 'string' || b.email.length > 200 || !EMAIL_RE.test(b.email)) return 'Invalid email address';
  if (String(b.name).length > 100) return 'Name is too long';
  if (b.phone && String(b.phone).length > 40) return 'Phone number is too long';
  if (b.notes && String(b.notes).length > 2000) return 'Notes are too long';
  if (b.location && String(b.location).length > 300) return 'Location is too long';
  if (b.timezone && String(b.timezone).length > 64) return 'Invalid timezone';
  if (isNaN(new Date(b.time).getTime())) return 'Invalid time';
  return null;
}

/*
 * The Google Calendar event for a booking.
 *
 * Guests are attendees alongside the student. They get no email from us, so the
 * manage link goes in the description as well: every attendee sees it, which
 * makes the invite the one place a parent can reschedule or cancel from.
 *
 * Exported so the event's shape can be checked without a Google connection.
 */
export function buildBookingEvent(booking, start, end) {
  const guests = booking.guestEmails || [];
  const manageLink = manageUrl(booking.manageToken);
  const event = {
    summary: `${booking.name} — Tutoring`,
    description: [
      `Client: ${booking.name}`,
      `Email: ${booking.email}`,
      guests.length > 0 ? `Guests: ${guests.join(', ')}` : null,
      booking.notes ? `Notes: ${booking.notes}` : null,
      manageLink ? `\nReschedule or cancel: ${manageLink}` : null
    ].filter(Boolean).join('\n'),
    start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
    attendees: [{ email: booking.email }, ...guests.map(guest => ({ email: guest }))],
    extendedProperties: { private: { schoolId: booking.schoolId || '', meetingType: booking.meetingType } }
  };
  if (booking.meetingType === 'google-meet') {
    event.conferenceData = { createRequest: { requestId: booking.id, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  } else {
    event.location = booking.location;
  }
  return event;
}

// Shared by the public booking form and the admin panel. `options.bypassNotice`
// skips the minimum-notice floor, and `options.requireCaptcha` is false for the
// admin path, which is already behind authentication.
async function handleCreateBooking(req, res, options = {}) {
  const { bypassNotice = false, requireCaptcha = true, createdBy = 'public' } = options;
  try {
    const { time, meetingType, location, schoolId, name, email, phone, notes, timezone, captchaToken } = req.body;
    const validationError = validateBookingInput(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    // Runs after the email check above, since the student's own address is what
    // a duplicate guest entry is measured against.
    const { emails: guestEmails, error: guestError } = normalizeGuestEmails(req.body.guests, email);
    if (guestError) return res.status(400).json({ error: guestError });

    if (requireCaptcha) {
      // Gate the public endpoint behind CAPTCHA when configured. This is a
      // no-op (always passes) when no CAPTCHA provider is set up.
      const captchaOk = await verifyCaptcha(captchaToken, req.ip);
      if (!captchaOk) return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
    }

    // Resolve the meeting type and location against stored config. This rejects
    // unknown and disabled meeting types, rejects unknown schools, and decides
    // the session length server-side instead of trusting the request body.
    const { config, error: configError } = resolveBookingConfig(meetingType, schoolId);
    if (configError) return res.status(400).json({ error: configError });

    // The client only ever offers real, conflict-free future slots, but the
    // public endpoint must not trust that. Re-derive the day's slots and
    // require an exact match, the same check the reschedule path uses.
    const startDateTime = new Date(time);
    if (startDateTime.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'That time is in the past. Please pick another.' });
    }
    if (!await isSlotAvailable(config, startDateTime.toISOString(), {}, bypassNotice)) {
      return res.status(409).json({ error: 'That time is no longer available. Please pick another.' });
    }

    const duration = config.sessionDuration;
    const slotEnd = new Date(startDateTime.getTime() + duration * 60 * 1000);
    // Derive the calendar day from the instant in the business timezone. The
    // client's own date string is formatted in the visitor's timezone and can
    // be a day off for anyone booking from a different one.
    const bookingDate = startDateTime.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

    const booking = {
      // Not Date.now(): two bookings landing in the same millisecond collide on
      // the primary key, and the loser gets a 500 instead of a booking.
      id: crypto.randomUUID(),
      date: bookingDate,
      time: startDateTime.toISOString(),
      meetingType, location, schoolId, name, email, phone, notes,
      guestEmails,
      sessionDuration: duration,
      timezone: timezone || null,
      status: 'confirmed',
      manageToken: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString()
    };
    const calendar = getCalendar();
    if (calendar) {
      const { bookingCalendar } = loadCalendarConfig();
      const calendarEvent = await calendar.events.insert({
        calendarId: bookingCalendar || 'primary',
        resource: buildBookingEvent(booking, startDateTime, slotEnd),
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
    addBookingToDisk(booking);
    sendConfirmation(booking);
    // Tell the tutor too — otherwise a booking is only visible in the calendar
    // invite, and a same-day one suppresses both reminder emails.
    notifyAdminOfBooking(booking, { createdBy });
    res.status(201).json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create booking' });
  }
}

// Public booking form: CAPTCHA enforced, minimum notice applies.
export const createBooking = (req, res) => handleCreateBooking(req, res);

// Admin panel: already authenticated, and the tutor booking someone in is not
// the ambush the notice rule exists to prevent.
export const createBookingAsAdmin = (req, res) =>
  handleCreateBooking(req, res, { bypassNotice: true, requireCaptcha: false, createdBy: 'admin' });

export const getBookings = (req, res) => {
  // guest_emails is stored as JSON; hand the admin panel a real array so it
  // never has to know the storage format.
  res.json({
    bookings: loadBookings().map(b => ({ ...b, guestEmails: parseGuestEmails(b.guest_emails) }))
  });
};

/* ── Cancel & reschedule ──────────────────────────────────────────────────── */

// Resolve the availability rules (weekly blocks + date overrides) that govern a
// given booking, based on its meeting type / school. Used both to drive the
// reschedule UI and to validate a requested new time server-side.
function getRescheduleConfig(booking) {
  const sessionDuration = booking.session_duration || 60;
  const mt = loadMeetingTypes().find(t => t.id === booking.meeting_type);
  const minimumNoticeMinutes = mt?.minimumNoticeMinutes ?? null;

  if (mt && !mt.requiresSchool) {
    return {
      schoolId: '',
      sessionDuration,
      weeklyAvailability: mt.availability || {},
      availableDates: mt.availableDates || null,
      unavailableDates: mt.unavailableDates || null,
      minimumNoticeMinutes
    };
  }

  if (booking.school_id && booking.school_id !== CUSTOM_LOCATION_ID) {
    const school = loadSchools().find(s => s.id === booking.school_id);
    return {
      schoolId: booking.school_id,
      sessionDuration,
      weeklyAvailability: school?.availability || {},
      availableDates: null,
      unavailableDates: null,
      minimumNoticeMinutes
    };
  }

  // "Other location" booking — no stored schedule, use the shared default.
  return {
    schoolId: booking.school_id || CUSTOM_DRIVE_TIME_ID,
    sessionDuration,
    weeklyAvailability: CUSTOM_LOCATION_AVAILABILITY,
    availableDates: null,
    unavailableDates: null,
    minimumNoticeMinutes
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
    unavailableDates: cfg.unavailableDates,
    // So the slot picker applies this type's own minimum notice.
    meetingType: booking.meeting_type
  };
}

// Validate that a requested new start time is a real, conflict-free slot for the
// booking. Same check the initial booking runs, minus the booking's own event.
async function isSlotAvailableForReschedule(booking, newStartISO, bypassNotice = false) {
  return isSlotAvailable(getRescheduleConfig(booking), newStartISO, {
    eventId: booking.calendar_event_id || null,
    bookingId: booking.id
  }, bypassNotice);
}

async function deleteCalendarEvent(eventId) {
  if (!eventId) return;
  const calendar = getCalendar();
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
  const calendar = getCalendar();
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
    guests: parseGuestEmails(b.guest_emails),
    sessionDuration: b.session_duration,
    status: b.status,
    meetLink: b.meet_link,
    manageToken: b.manage_token,
    timezone: b.client_timezone
  };
}

async function performCancel(booking) {
  await deleteCalendarEvent(booking.calendar_event_id);
  dbService.updateBookingStatus(booking.user_id, booking.id, 'cancelled');
  sendCancellation(booking);
}

async function performReschedule(booking, time, bypassNotice = false) {
  const ok = await isSlotAvailableForReschedule(booking, time, bypassNotice);
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
    const result = await performReschedule(booking, req.body.time, true);
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
