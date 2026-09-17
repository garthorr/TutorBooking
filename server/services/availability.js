/*
 * Pure availability/scheduling helpers.
 *
 * This module deliberately has no database or network side effects so it can be
 * unit-tested in isolation. Anything that needs stored data (drive times) is
 * passed in by the caller as a `getDriveTime(fromId, toId, walkTime)` callback.
 */

// Read at call time so the timezone can be configured via env (and overridden
// in tests) without caring about module-load order.
const tz = () => process.env.TIMEZONE || 'America/Chicago';

// Build a Date for the given wall-clock hours/minutes on the calendar day of
// `baseDate`, interpreted in TIMEZONE.
export function tzDate(baseDate, hours, minutes) {
  const dateStr = baseDate.toLocaleDateString('en-CA', { timeZone: tz() });
  const naive = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
  const naiveInTZ = new Date(naive.toLocaleString('en-US', { timeZone: tz() }));
  return new Date(naive.getTime() + (naive.getTime() - naiveInTZ.getTime()));
}

// Normalizes a time string to canonical 24-hour "HH:MM" (e.g. "9:00" → "09:00").
// Returns null if the value is not a valid 24-hour time.
export function normalizeTime(value) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// Validates and normalizes a weekly availability object ({ dayNum: [{start, end, …}] }).
// Returns { value } with times normalized and empty days dropped, or { error }.
export function normalizeAvailability(availability, label = 'availability') {
  if (availability == null) return { value: availability };
  if (typeof availability !== 'object' || Array.isArray(availability)) {
    return { error: `${label}: must be an object keyed by day of week` };
  }
  const out = {};
  for (const [day, blocks] of Object.entries(availability)) {
    if (!/^[0-6]$/.test(String(day))) {
      return { error: `${label}: invalid day "${day}" (expected 0-6)` };
    }
    if (!Array.isArray(blocks)) {
      return { error: `${label}: day ${day} must be an array of time blocks` };
    }
    const normalized = [];
    for (const block of blocks) {
      const start = normalizeTime(block?.start);
      const end = normalizeTime(block?.end);
      if (!start || !end) {
        return { error: `${label}: day ${day} has an invalid time (expected 24-hour HH:MM, got "${block?.start}"–"${block?.end}")` };
      }
      // Inverted/empty ranges (end <= start) are tolerated: legacy data may
      // contain them, they harmlessly produce no slots, and rejecting them
      // here would block saving every school over one stale block. The admin
      // UI flags them visually instead.
      normalized.push({ ...block, start, end });
    }
    if (normalized.length > 0) out[day] = normalized;
  }
  return { value: out };
}

// Returns YYYY-MM-DD string for a given year/month(0-indexed)/day.
export function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Returns 0-6 day-of-week from a YYYY-MM-DD string (Sunday=0).
export function dayOfWeekFromStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function isDateInOverrides(date, overrides) {
  if (!overrides || !Array.isArray(overrides)) return false;
  // date is either a Date object or a YYYY-MM-DD string.
  let target;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    target = date;
  } else {
    target = new Date(date).toLocaleDateString('en-CA', { timeZone: tz() });
  }

  return overrides.some(override => {
    if (typeof override === 'string') {
      return override === target;
    } else if (override.start && override.end) {
      return target >= override.start && target <= override.end;
    }
    return false;
  });
}

// A no-op drive-time resolver, used when callers don't supply one (e.g. tests
// for meeting types that never incur travel buffers).
const NO_DRIVE_TIME = () => 0;

/*
 * Conflict checking runs once per candidate slot, and a day has dozens of
 * candidate slots. Anything that depends only on the event — parsing its
 * timestamps, resolving an all-day event's boundaries through Intl, looking up
 * its travel buffers — is therefore resolved once here, up front, leaving the
 * per-slot check as plain number comparisons.
 */
function prepareEvents(events, schoolId, walkTime, getDriveTime) {
  const prepared = [];
  for (const event of events) {
    let startMs, endMs;
    if (event.start.date) {
      // All-day event: start.date and end.date are YYYY-MM-DD. Noon UTC makes
      // tzDate resolve the right calendar day in TIMEZONE.
      startMs = tzDate(new Date(event.start.date + 'T12:00:00.000Z'), 0, 0).getTime();
      endMs = tzDate(new Date(event.end.date + 'T12:00:00.000Z'), 0, 0).getTime();
    } else {
      startMs = new Date(event.start.dateTime).getTime();
      endMs = new Date(event.end.dateTime).getTime();
    }
    const eventSchoolId = event.extendedProperties?.private?.schoolId;
    // Both buffers depend only on the event's location and the slot's, and the
    // slot's is fixed for the whole day. A zero buffer collapses the window to
    // nothing, which is why the original `> 0` guards are not needed.
    prepared.push({
      startMs,
      endMs,
      bufferEndMs: endMs + getDriveTime(eventSchoolId, schoolId, walkTime) * 60000,
      bufferStartMs: startMs - getDriveTime(schoolId, eventSchoolId, walkTime) * 60000
    });
  }
  return prepared;
}

// Numeric conflict check against events already through prepareEvents().
function conflictsWith(slotStartMs, slotEndMs, prepared) {
  for (const e of prepared) {
    if (slotStartMs < e.endMs && slotEndMs > e.startMs) return true;
    if (slotStartMs >= e.endMs && slotStartMs < e.bufferEndMs) return true;
    if (slotEndMs <= e.startMs && slotEndMs > e.bufferStartMs) return true;
  }
  return false;
}

export function hasSchedulingConflict(slotStart, slotEnd, events, schoolId, walkTime, getDriveTime = NO_DRIVE_TIME) {
  return conflictsWith(
    slotStart.getTime(),
    slotEnd.getTime(),
    prepareEvents(events, schoolId, walkTime, getDriveTime)
  );
}

// `minStart` and `maxStart` bound which slots are offered: the first drops
// times that have already passed or fall inside the minimum-notice window, the
// second drops times further ahead than bookings are accepted. Both are
// optional and off by default, so the function stays a pure, fixed-date-
// testable helper.
export function getAvailableSlotsForDay(date, availabilityBlocks, sessionDuration, events, schoolId, walkTime, getDriveTime = NO_DRIVE_TIME, minStart = null, maxStart = null) {
  const slots = [];
  const duration = sessionDuration || 60;
  const floor = minStart ? minStart.getTime() : null;
  const ceiling = maxStart ? maxStart.getTime() : null;
  // Resolved once for the whole day rather than once per candidate slot.
  const prepared = prepareEvents(events, schoolId, walkTime, getDriveTime);
  const durationMs = duration * 60 * 1000;
  const STEP_MS = 5 * 60 * 1000;
  for (const block of availabilityBlocks) {
    const [startH, startM] = block.start.split(':').map(Number);
    const [endH, endM] = block.end.split(':').map(Number);
    const blockEndMs = tzDate(date, endH, endM).getTime();
    const blockName = block.name || null;
    for (let slotStartMs = tzDate(date, startH, startM).getTime(); slotStartMs < blockEndMs; slotStartMs += STEP_MS) {
      const slotEndMs = slotStartMs + durationMs;
      if (slotEndMs > blockEndMs) break;
      if (floor !== null && slotStartMs < floor) continue;
      if (ceiling !== null && slotStartMs > ceiling) break;
      if (conflictsWith(slotStartMs, slotEndMs, prepared)) continue;
      slots.push({ time: new Date(slotStartMs).toISOString(), available: true, blockName });
    }
  }
  return slots;
}
