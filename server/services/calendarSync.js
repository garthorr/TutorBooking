import dbService from './dbService.js';
import { getCalendar } from './googleClient.js';
import { loadCalendarConfig } from '../calendarStorage.js';
import { sendCancellation, sendReschedule } from './emailService.js';

const TIMEZONE = process.env.TIMEZONE || 'America/Chicago';
const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Two-way calendar sync (Google -> app).
 *
 * App-initiated cancel/reschedule already push to Google. This reconciles the
 * other direction: changes made directly in Google Calendar (an event deleted
 * or moved) are reflected back into the app's database so the dashboard and the
 * client's self-service page stay accurate.
 */

// Pure decision: given a local booking and the matching Google event (or null
// if it no longer exists), decide how the local record should change.
//   { type: 'none' }
//   { type: 'cancel' }
//   { type: 'reschedule', time: ISO, date: 'YYYY-MM-DD' }
export function decideSyncAction(booking, event) {
  if (!event || event.status === 'cancelled') return { type: 'cancel' };

  // Timed events expose start.dateTime; all-day events only have start.date and
  // aren't something we reschedule against, so leave those untouched.
  const startISO = event.start?.dateTime;
  if (!startISO) return { type: 'none' };

  const newStart = new Date(startISO);
  if (isNaN(newStart.getTime())) return { type: 'none' };

  if (newStart.getTime() !== new Date(booking.time).getTime()) {
    return {
      type: 'reschedule',
      time: newStart.toISOString(),
      date: newStart.toLocaleDateString('en-CA', { timeZone: TIMEZONE })
    };
  }

  return { type: 'none' };
}

// Fetch a single event by id; returns null if it was deleted (404/410).
// Exported so the reminder job can re-check one booking against Google right
// before it sends a text, without duplicating the deleted-event handling.
export async function fetchEvent(calendar, calendarId, eventId) {
  try {
    const res = await calendar.events.get({ calendarId, eventId });
    return res.data;
  } catch (error) {
    const code = error?.code || error?.response?.status;
    if (code === 404 || code === 410) return null;
    throw error;
  }
}

/*
 * Resolve the current Google event behind each booking, as a Map of
 * booking id -> event (or null when the event is gone).
 *
 * One events.list covers the window the bookings sit in, instead of one
 * events.get per booking every five minutes — at a hundred bookings that was
 * ~28,800 API calls a day against a quota.
 *
 * Absence from that list is not proof of deletion, though: an event moved
 * outside the window is missing for the same reason a deleted one is. Anything
 * not found is therefore confirmed with a direct get, which is the rare path,
 * so a normal run costs one call and never mistakes a moved event for a
 * cancelled booking.
 */
export async function resolveBookingEvents(calendar, calendarId, bookings) {
  const resolved = new Map();
  if (bookings.length === 0) return resolved;

  const times = bookings.map(b => new Date(b.time).getTime()).filter(t => !isNaN(t));
  const timeMin = new Date(Math.min(...times) - DAY_MS);
  const timeMax = new Date(Math.max(...times) + DAY_MS);

  const byId = new Map();
  let listed = false;
  try {
    let pageToken;
    do {
      const { data } = await calendar.events.list({
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        showDeleted: true,
        maxResults: 2500,
        pageToken
      });
      for (const e of data.items || []) if (e.id) byId.set(e.id, e);
      pageToken = data.nextPageToken;
    } while (pageToken);
    listed = true;
  } catch (error) {
    // Fall back to per-booking gets rather than treating every booking as
    // deleted because one list call failed.
    console.error('[calendar-sync] events.list failed, falling back to per-booking lookups:', error.message);
  }

  for (const booking of bookings) {
    if (listed && byId.has(booking.calendar_event_id)) {
      resolved.set(booking.id, byId.get(booking.calendar_event_id));
      continue;
    }
    // Not in the window (or no list): confirm directly before concluding it is gone.
    try {
      resolved.set(booking.id, await fetchEvent(calendar, calendarId, booking.calendar_event_id));
    } catch (error) {
      // Leave this booking unresolved so it is skipped this run and retried on
      // the next, rather than failing the whole sync or being read as deleted.
      console.error(`[calendar-sync] failed to fetch event for booking ${booking.id}:`, error.message);
    }
  }
  return resolved;
}

// Reconcile all confirmed bookings that have a linked calendar event against
// the current state of Google Calendar.
export async function runCalendarSync() {
  const calendar = getCalendar();
  if (!calendar) return { checked: 0, cancelled: 0, rescheduled: 0 };

  const { bookingCalendar } = loadCalendarConfig();
  const calendarId = bookingCalendar || 'primary';

  // Only confirmed bookings in the future are worth reconciling.
  const bookings = dbService
    .getUpcomingConfirmed(new Date().toISOString())
    .filter(b => b.calendar_event_id);

  let cancelled = 0;
  let rescheduled = 0;

  let resolved;
  try {
    resolved = await resolveBookingEvents(calendar, calendarId, bookings);
  } catch (error) {
    console.error('[calendar-sync] could not resolve calendar events:', error.message);
    return { checked: 0, cancelled: 0, rescheduled: 0 };
  }

  for (const booking of bookings) {
    if (!resolved.has(booking.id)) continue;
    const event = resolved.get(booking.id);

    const action = decideSyncAction(booking, event);
    if (action.type === 'cancel') {
      dbService.updateBookingStatus(booking.user_id, booking.id, 'cancelled');
      cancelled++;
      const updated = dbService.getBookingById(booking.user_id, booking.id);
      sendCancellation(updated);
      console.log(`[calendar-sync] booking ${booking.id} cancelled (event removed in Google Calendar)`);
    } else if (action.type === 'reschedule') {
      dbService.updateBookingSchedule(booking.user_id, booking.id, { date: action.date, time: action.time });
      rescheduled++;
      const updated = dbService.getBookingById(booking.user_id, booking.id);
      sendReschedule(updated);
      console.log(`[calendar-sync] booking ${booking.id} rescheduled to ${action.time} (changed in Google Calendar)`);
    }
  }

  return { checked: bookings.length, cancelled, rescheduled };
}

const POLL_MS = 5 * 60 * 1000;

export function startCalendarSyncJob() {
  console.log('✓ Two-way calendar sync job started (5-minute interval).');
  const tick = () => runCalendarSync().catch(err => console.error('[calendar-sync]', err.message));
  tick();
  setInterval(tick, POLL_MS);
}
