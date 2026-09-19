import dbService from './dbService.js';
import { isSmsEnabled } from './smsService.js';

const ADMIN_ID = 1;
const DAY_MINUTES = 24 * 60;
// A reminder more than 30 days out would never fire for a booking made inside
// the booking window, so treat anything beyond that as a typo and clamp it.
const MAX_LEAD_MINUTES = 30 * DAY_MINUTES;

export const DEFAULT_REMINDERS = {
  enabled: true,
  firstMinutes: DAY_MINUTES, // 24 hours before
  secondMinutes: 60          // 1 hour before
};

/*
 * The reminder schedule: whether reminders go out at all, and how long before a
 * session each of the two reminders is sent. A lead time of 0 switches that one
 * reminder off, so a single reminder is just the other one set to 0.
 */

// Minutes of lead time. 0 is meaningful (off), so only a missing or nonsense
// value falls back — otherwise a stray empty field would silently disable a
// reminder the admin never touched.
export function clampLead(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.round(n), MAX_LEAD_MINUTES);
}

/*
 * Put the earlier reminder first, which is what the sending logic assumes.
 *
 * Without this, picking "1 hour" in the first box and "1 day" in the second
 * leaves the first reminder with an empty window — it may only fire between the
 * two lead times — so it would never be sent and the admin would see one
 * reminder instead of two. Two equal lead times have the same problem, and
 * would be the same email twice even if they didn't, so the duplicate is
 * dropped rather than reordered.
 */
export function normalizeLeads(firstMinutes, secondMinutes) {
  if (secondMinutes > firstMinutes) return { firstMinutes: secondMinutes, secondMinutes: firstMinutes };
  if (firstMinutes === secondMinutes) return { firstMinutes, secondMinutes: 0 };
  return { firstMinutes, secondMinutes };
}

export function loadReminderConfig() {
  const settings = dbService.getSettings(ADMIN_ID);
  if (!settings) return { ...DEFAULT_REMINDERS };
  return {
    // Null only shows up on a row written before the column existed; the
    // migration backfills it, so this is belt and braces.
    enabled: settings.reminders_enabled === null || settings.reminders_enabled === undefined
      ? DEFAULT_REMINDERS.enabled
      : Boolean(settings.reminders_enabled),
    // "Texts should go out": the tutor switched them on AND Twilio is actually
    // configured. One flag rather than two so the sending logic has a single
    // thing to check.
    smsEnabled: Boolean(settings.sms_reminders_enabled) && isSmsEnabled(),
    ...normalizeLeads(
      clampLead(settings.reminder_first_minutes, DEFAULT_REMINDERS.firstMinutes),
      clampLead(settings.reminder_second_minutes, DEFAULT_REMINDERS.secondMinutes)
    )
  };
}

/*
 * Which SMS channels are actually live right now: the tutor's toggle AND Twilio
 * being configured. Read per call rather than at startup, so switching one on
 * in /admin takes effect without restarting the server.
 *
 * The confirmation and the change notices are independent of the reminder
 * schedule entirely — they fire when a booking is made, moved or cancelled. The
 * reminder rides the second lead time, so it is only live while that one is.
 */
export function loadSmsChannels() {
  const settings = dbService.getSettings(ADMIN_ID);
  const config = loadReminderConfig();
  return {
    confirmation: isSmsEnabled() && Boolean(settings?.sms_confirmation_enabled),
    changes: isSmsEnabled() && Boolean(settings?.sms_changes_enabled),
    reminder: config.smsEnabled && config.enabled && config.secondMinutes > 0
  };
}

function plural(count, unit) {
  return `in ${count} ${count === 1 ? unit : `${unit}s`}`;
}

// How the lead time is described to the student: the reminder email reads
// "Your session is <label>". Whole days and hours get the tidy wording; the
// mixed case only comes up if a lead time is set through the API directly,
// since the admin panel offers round values.
export function leadLabel(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m >= DAY_MINUTES && m % DAY_MINUTES === 0) return plural(m / DAY_MINUTES, 'day');
  if (m >= 60 && m % 60 === 0) return plural(m / 60, 'hour');
  if (m >= 60) {
    const hours = Math.floor(m / 60);
    return `in ${hours} ${hours === 1 ? 'hour' : 'hours'} ${m % 60} minutes`;
  }
  return plural(m, 'minute');
}
