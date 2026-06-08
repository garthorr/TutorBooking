import dbService from '../services/dbService.js';
import { isEmailEnabled, sendReminder } from '../services/emailService.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const POLL_MS = 5 * 60 * 1000;

// Send 24-hour and 1-hour reminders for upcoming confirmed bookings. Each
// reminder is flagged in the DB so it is sent at most once per booking.
export async function runReminderCheck() {
  const now = Date.now();
  const bookings = dbService.getUpcomingConfirmed(new Date(now).toISOString());
  for (const b of bookings) {
    const until = new Date(b.time).getTime() - now;
    if (until <= 0) continue;
    if (!b.reminder_24h_sent && until <= DAY_MS && until > HOUR_MS) {
      dbService.markReminderSent(b.id, '24h');
      await sendReminder(b, 'coming up');
    } else if (!b.reminder_1h_sent && until <= HOUR_MS) {
      dbService.markReminderSent(b.id, '1h');
      await sendReminder(b, 'starting soon');
    }
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
