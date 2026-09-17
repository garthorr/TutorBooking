/*
 * Guest handling for bookings.
 *
 * A booking can invite a few extra people — typically a parent or guardian —
 * who go onto the Google Calendar event as attendees alongside the student.
 *
 * Like availability.js, this module deliberately has no database or network
 * access so the rules below can be unit-tested directly.
 */

// Every guest is an invitation Google sends from the tutor's own account, and
// the booking endpoint is public, so the list is capped rather than unbounded.
// Keep MAX_GUESTS in step with the constant of the same name in client/src/App.jsx.
export const MAX_GUESTS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 200;
// Bounds the work a hostile request can cause before the cap below rejects it:
// without this, a list of 100k blank strings would all be walked first.
const MAX_RAW_ENTRIES = 50;

/*
 * Canonicalize the guest list from a request body.
 *
 * Blank entries are dropped, because the form sends a row per input including
 * one the visitor added and left empty. Duplicates and the student's own
 * address are dropped too, so nobody is invited twice. A malformed address is
 * rejected outright rather than skipped: a typo'd parent address should be
 * corrected, not silently swallowed, leaving the student believing the parent
 * was invited.
 *
 * Returns { emails } or { error } with a client-safe message.
 */
export function normalizeGuestEmails(raw, studentEmail = '') {
  if (raw === undefined || raw === null) return { emails: [] };
  if (!Array.isArray(raw)) return { error: 'Guest emails must be a list.' };
  if (raw.length > MAX_RAW_ENTRIES) return { error: `You can invite at most ${MAX_GUESTS} guests.` };

  const seen = new Set([String(studentEmail).trim().toLowerCase()]);
  const emails = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return { error: 'Guest emails must be text.' };
    const email = entry.trim();
    if (!email) continue;
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
      // Truncated: the value is echoed back to the client, and the length check
      // above still allows 200 characters of it.
      return { error: `"${email.slice(0, 60)}" is not a valid email address.` };
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  if (emails.length > MAX_GUESTS) return { error: `You can invite at most ${MAX_GUESTS} guests.` };
  return { emails };
}

// Read a stored guest list back. Tolerates NULL, rows written before the column
// existed, and anything that is not a JSON array of strings — a malformed value
// must not take the whole booking row down with it.
export function parseGuestEmails(stored) {
  if (Array.isArray(stored)) return stored.filter(e => typeof e === 'string');
  if (typeof stored !== 'string' || !stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(e => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

// The value stored in bookings.guest_emails: JSON for a non-empty list, NULL
// otherwise, so a guest-free booking looks exactly like every row written
// before this column existed.
export function serializeGuestEmails(emails) {
  return Array.isArray(emails) && emails.length > 0 ? JSON.stringify(emails) : null;
}
