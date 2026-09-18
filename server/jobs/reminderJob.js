import dbService from '../services/dbService.js';
import { isEmailEnabled, sendReminder } from '../services/emailService.js';
import { loadReminderConfig, leadLabel } from '../services/reminderConfig.js';

const MINUTE_MS = 60 * 1000;
const POLL_MS = 5 * 60 * 1000;

/*
 * Pure decision: which reminder, if any, is due for this booking right now.
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

// Send whichever reminders are due for upcoming confirmed bookings. Each
// reminder is flagged in the DB so it is sent at most once per booking.
export async function runReminderCheck() {
  // Read the schedule each pass rather than at startup, so changing it in the
  // admin panel takes effect without restarting the server.
  const config = loadReminderConfig();
  if (!config.enabled) return;

  const now = Date.now();
  for (const booking of dbService.getUpcomingConfirmed(new Date(now).toISOString())) {
    const due = decideReminder(booking, config, now);
    if (!due) continue;
    dbService.markReminderSent(booking.id, due.which);
    await sendReminder(booking, due.label);
  }
}

export function startReminderJob() {
  if (!isEmailEnabled()) {
    console.log('ℹ Email not configured — appointment reminders disabled.');
    return;
  }
  console.log('✓ Appointment reminder job started (5-minute interval).');
  const tick = () => runReminderCheck().catch(err => console.error('[reminders]', err.message));
  tick();
  setInterval(tick, POLL_MS);
}
