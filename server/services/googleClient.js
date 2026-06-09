import { google } from 'googleapis';
import { loadTokens, saveTokens } from '../tokenStorage.js';

/*
 * Shared, lazily-initialized Google Calendar client. Returns null until OAuth
 * tokens have been stored (i.e. the admin has connected a Google account), so
 * callers must tolerate a null client and treat calendar features as optional.
 */

let calendar = null;

function build() {
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
    if (!savedTokens) return null;
    oauth2Client.setCredentials(savedTokens);
    return google.calendar({ version: 'v3', auth: oauth2Client });
  } catch {
    return null;
  }
}

// Returns the cached client, (re)initializing it if needed. May return null.
export function getCalendar() {
  if (!calendar) calendar = build();
  return calendar;
}

// Force a fresh client on next getCalendar() — e.g. after connect/disconnect.
export function resetCalendar() {
  calendar = null;
}
