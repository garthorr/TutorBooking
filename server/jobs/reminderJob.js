import dbService from '../services/dbService.js';
import { isEmailEnabled, sendReminder } from '../services/emailService.js';
import { isSmsEnabled, sendSms, smsReminderBody, normalizeUsPhone } from '../services/smsService.js';
import { loadReminderConfig, leadLabel } from '../services/reminderConfig.js';
import { decideSyncAction, fetchEvent } from '../services/calendarSync.js';
import { getCalendar } from '../services/googleClient.js';
import { loadCalendarConfig } from '../calendarStorage.js';

const MINUTE_MS = 60 * 1000;
const POLL_MS = 5 * 60 * 1000;
const ADMIN_ID = 1;

/*
 * Pure decision: which reminder email, if any, is due for this booking right now.
 * Returns null, or { which: 'first' | 'second', label }.
 *
 * `config.firstMinutes` is the earlier of the two lead times (normalizeLeads
 * guarantees it), so the first reminder is only sent while the session is still
 * further away than the second lead time. Without that upper bound, a booking
 * made — or a server started — inside the second window would send both
 * reminders minutes apart.
 */
export function decideReminder(booking, config, now) {
  if (!config.enabled) return null;

  const until = new Date(booking.time).getTime() - now;
  if (!Number.isFinite(until) || until <= 0) return null;

  const firstMs = config.firstMinutes * MINUTE_MS;
  const secondMs = config.secondMinutes * MINUTE_MS;

  if (config.firstMinutes > 0 && !booking.reminder_first_sent && until <= firstMs && until > secondMs) {
    return { which: 'first', label: leadLabel(config.firstMinutes) };
  }
  if (config.secondMinutes > 0 && !booking.reminder_second_sent && until <= secondMs) {
    return { which: 'second', label: leadLabel(config.secondMinutes) };
  }
  return null;
}

/*
 * Pure decision: is a reminder text due for this booking right now?
 * Returns null, or { label, to } with the number already normalized.
 *
 * The text rides the second reminder's lead time, so changing "Second reminder"
 * in /admin moves the text with it and setting it to Off switches the text off
 * too. This is deliberately a separate decision from decideReminder rather than
 * a branch inside it: the two channels are independent, so a booking can get
 * the second email and a text, either one alone, or neither.
 *
 * Normalizing here rather than at send time keeps the whole "should this
 * booking be texted" question in one testable place — there is no point
 * deciding to text a number we cannot dial.
 */
export function decideSmsReminder(booking, config, now) {
  if (!config.enabled || !config.smsEnabled) return null;
  // 0 means the second reminder is switched off, which takes the text with it.
  if (!config.secondMinutes) return null;
  // No tick, no text. A failed text is retried apart from the email because
  // sms_second_sent is its own flag.
  if (!booking.sms_consent || booking.sms_second_sent) return null;

  const until = new Date(booking.time).getTime() - now;
  if (!Number.isFinite(until) || until <= 0) return null;
  if (until > config.secondMinutes * MINUTE_MS) return null;

  const to = normalizeUsPhone(booking.phone);
  if (!to) return null;

  return { label: leadLabel(config.secondMinutes), to };
}

/*
 * Is this session still on, right now?
 *
 * getUpcomingConfirmed already filters status = 'confirmed', which is necessary
 * but not sufficient. The booking list is read once at the top of a tick and the
 * loop then awaits its way through sends, so a booking cancelled mid-tick is a
 * stale row. And calendarSync runs on its own independent 5-minute timer, so a
 * session deleted straight from Google Calendar can stay 'confirmed' in SQLite
 * for up to five minutes. A text cannot be recalled, so check both.
 */
async function isStillOn(booking, config, now) {
  // Cheap, local, and closes the mid-tick window.
  const fresh = dbService.getBookingById(booking.user_id, booking.id);
  if (!fresh || fresh.status !== 'confirmed' || fresh.sms_second_sent) return false;

  // The start time can have moved since the list was queried.
  const until = new Date(fresh.time).getTime() - now;
  if (!Number.isFinite(until) || until <= 0) return false;
  if (until > config.secondMinutes * MINUTE_MS) return false;

  const calendar = getCalendar();
  if (!calendar || !fresh.calendar_event_id) return true;

  try {
    const { bookingCalendar } = loadCalendarConfig();
    const event = await fetchEvent(calendar, bookingCalendar || 'primary', fresh.calendar_event_id);
    // Reuse the sync job's own definition of "still happening" rather than
    // writing a second one that can drift. A reschedule skips too: the sync job
    // will shortly rewrite the booking's time, and because updateBookingSchedule
    // clears sms_second_sent the text then goes out against the new slot
    // instead of announcing the old one.
    return decideSyncAction(fresh, event).type === 'none';
  } catch (error) {
    // Send anyway. The local row still says confirmed, and suppressing every
    // reminder during a Google outage is worse than the narrow risk of texting
    // about a session cancelled in Google within the last five minutes.
    console.error(`[reminders] could not confirm booking ${fresh.id} against Google:`, error.message);
    return true;
  }
}

// Send whichever reminders are due for upcoming confirmed bookings. Each
// reminder is flagged in the DB so it is sent at most once per booking.
export async function runReminderCheck() {
  // Read the schedule each pass rather than at startup, so changing it in the
  // admin panel takes effect without restarting the server.
  const config = loadReminderConfig();
  if (!config.enabled) return;

  const emailLive = isEmailEnabled();
  const businessName = dbService.getSettings(ADMIN_ID)?.business_name || '';

  const now = Date.now();
  for (const booking of dbService.getUpcomingConfirmed(new Date(now).toISOString())) {
    if (emailLive) {
      const due = decideReminder(booking, config, now);
      if (due) {
        dbService.markReminderSent(booking.id, due.which);
        await sendReminder(booking, due.label);
      }
    }

    const sms = decideSmsReminder(booking, config, now);
    // Freshness checks first, then the flag, then the send. Setting the flag
    // before the checks burns the one attempt on a booking that turned out to
    // be cancelled; sending before setting it risks a duplicate.
    if (sms && await isStillOn(booking, config, now)) {
      dbService.markReminderSent(booking.id, 'sms');
      // Twilio failures — unreachable number, no balance — are logged once by
      // sendSms and dropped rather than retried every five minutes until the
      // session starts. A missed reminder beats a duplicate arriving at 6am,
      // and a retry loop on a permanently invalid number is pure cost.
      await sendSms(sms.to, smsReminderBody(booking, sms.label, businessName));
    }
  }
}

export function startReminderJob() {
  const email = isEmailEnabled();
  const sms = isSmsEnabled();
  // Either channel on its own is reason enough to run. Gating this on email
  // alone would mean no text ever fires on an install with SMTP unset.
  if (!email && !sms) {
    console.log('ℹ Neither email nor SMS is configured — appointment reminders disabled.');
    return;
  }
  const channels = email && sms ? 'email + SMS' : email ? 'email only' : 'SMS only';
  console.log(`✓ Appointment reminder job started (5-minute interval, ${channels}).`);
  const tick = () => runReminderCheck().catch(err => console.error('[reminders]', err.message));
  tick();
  setInterval(tick, POLL_MS);
}
