/*
 * Weekly availability for "Other location" bookings.
 *
 * Unlike schools and meeting types, a custom location has no stored schedule,
 * so both the booking page and the server fall back to this one. It is defined
 * here, and served to the client via GET /api/config, so the times the page
 * offers and the times the server will accept cannot drift apart — when they
 * did, the page showed slots that every booking attempt rejected with a 409.
 */
export const CUSTOM_LOCATION_AVAILABILITY = {
  1: [{ start: '09:00', end: '17:00' }],
  2: [{ start: '09:00', end: '17:00' }],
  3: [{ start: '09:00', end: '17:00' }],
  4: [{ start: '09:00', end: '17:00' }],
  5: [{ start: '09:00', end: '17:00' }]
};
