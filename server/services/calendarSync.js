import dbService from './dbService.js';
import { getCalendar } from './googleClient.js';
import { loadCalendarConfig } from '../calendarStorage.js';
import { sendCancellation, sendReschedule } from './emailService.js';

const TIMEZONE = process.env.TIMEZONE || 'America/Chicago';

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
async function fetchEvent(calendar, calendarId, eventId) {
  try {
    const res = await calendar.events.get({ calendarId, eventId });
    return res.data;
  } catch (error) {
    const code = error?.code || error?.response?.status;
    if (code === 404 || code === 410) return null;
    throw error;
  }
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

  for (const booking of bookings) {
    let event;
    try {
      event = await fetchEvent(calendar, calendarId, booking.calendar_event_id);
    } catch (error) {
      console.error(`[calendar-sync] failed to fetch event for booking ${booking.id}:`, error.message);
      continue;
    }

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
