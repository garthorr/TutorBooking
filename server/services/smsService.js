import { manageUrl, formatTime } from './emailService.js';

/*
 * Optional SMS reminders via Twilio.
 *
 * Entirely no-op unless all three env vars below are set, so local development
 * and the existing deploy keep working without a Twilio account. Deliberately
 * independent of email: texts go out on an install with SMTP_HOST unset and no
 * mail server configured at all.
 *
 * US numbers only. normalizeUsPhone rejects anything it cannot turn into a
 * North American E.164 number rather than guessing at it — the stored phone is
 * free text typed by a student, and a guess texts a stranger.
 *
 *   TWILIO_ACCOUNT_SID   account SID, also part of the send URL
 *   TWILIO_AUTH_TOKEN    auth token, used as the HTTP Basic password
 *   TWILIO_FROM_NUMBER   sending number in E.164, e.g. +15551234567
 */

const API_BASE = 'https://api.twilio.com/2010-04-01/Accounts';

// Configured only when all three are present — without any one of them a send
// cannot even be attempted, so there is no half-enabled state.
export function isSmsEnabled() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  );
}

/*
 * A US number in E.164, or null when the value is not one we can text.
 *
 * Forgiving about separators — "(555) 123-4567", "555.123.4567" and
 * "+1 555 123 4567" all normalize — and strict about everything else.
 * Returning null is a normal outcome, not an error: the caller skips that
 * booking.
 */
export function normalizeUsPhone(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A leading + means the student told us the country code. If it isn't 1 this
  // is an international number, and coercing it to +1 would text someone else.
  const explicitCountry = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (explicitCountry && !digits.startsWith('1')) return null;

  let e164;
  if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`;
  // Any other length is a typo or an extension — "555-123-4567 ext 2" arrives
  // here as 12 digits. Rejecting it looks harsh, but an extension is not
  // something we could text anyway.
  else return null;

  // In the North American plan neither the area code nor the exchange code may
  // begin with 0 or 1, so this rejects a large class of junk before it costs a
  // Twilio request.
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e164) ? e164 : null;
}

/*
 * The reminder text.
 *
 * Kept short on purpose: past 160 characters Twilio bills two segments. The
 * manage link alone is roughly 55, so two segments is accepted here — but the
 * rest of the copy should not sprawl. `label` is reminderConfig's leadLabel
 * ("in 1 hour"), so the wording matches the reminder email.
 */
export function smsReminderBody(booking, label, businessName) {
  const who = businessName ? `${businessName} ` : '';
  const when = formatTime(booking.time, booking.client_timezone);
  // manageUrl is null without PUBLIC_BASE_URL. Omit the link rather than
  // texting somebody the word "null".
  const url = manageUrl(booking.manage_token);
  return `Reminder: your ${who}session is ${label}, at ${when}.${url ? ` ${url}` : ''}`;
}

/*
 * Send one message. Resolves true on success and false on anything else, and
 * never throws: one unreachable number must not kill the reminder tick for
 * every other booking.
 */
export async function sendSms(to, body) {
  if (!isSmsEnabled() || !to) return false;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: body })
    });
    if (res.ok) return true;

    // Twilio's numeric codes are how this gets diagnosed later — 21606 for a
    // From number the account does not own, 21610 for a recipient who replied
    // STOP — so log the code, not just the text.
    const data = await res.json().catch(() => ({}));
    console.error('[sms] send failed:', data.code ?? res.status, data.message || res.statusText);
    return false;
  } catch (error) {
    console.error('[sms] send request failed:', error.message);
    return false;
  }
}
