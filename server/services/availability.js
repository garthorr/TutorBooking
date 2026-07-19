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
      if (end <= start) {
        return { error: `${label}: day ${day} block ${start}–${end} ends before it starts` };
      }
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

export function hasSchedulingConflict(slotStart, slotEnd, events, schoolId, walkTime, getDriveTime = NO_DRIVE_TIME) {
  for (const event of events) {
    let eventStart, eventEnd;
    if (event.start.date) {
      // All-day event: start.date and end.date are YYYY-MM-DD
      // Use noon UTC to ensure tzDate correctly identifies the calendar day in TIMEZONE
      eventStart = tzDate(new Date(event.start.date + 'T12:00:00.000Z'), 0, 0);
      eventEnd = tzDate(new Date(event.end.date + 'T12:00:00.000Z'), 0, 0);
    } else {
      eventStart = new Date(event.start.dateTime);
      eventEnd = new Date(event.end.dateTime);
    }
    const eventSchoolId = event.extendedProperties?.private?.schoolId;

    if (slotStart < eventEnd && slotEnd > eventStart) return true;

    const driveTimeBefore = getDriveTime(eventSchoolId, schoolId, walkTime);
    if (driveTimeBefore > 0) {
      const bufferEnd = new Date(eventEnd.getTime() + driveTimeBefore * 60 * 1000);
      if (slotStart >= eventEnd && slotStart < bufferEnd) return true;
    }

    const driveTimeAfter = getDriveTime(schoolId, eventSchoolId, walkTime);
    if (driveTimeAfter > 0) {
      const bufferStart = new Date(eventStart.getTime() - driveTimeAfter * 60 * 1000);
      if (slotEnd <= eventStart && slotEnd > bufferStart) return true;
    }
  }
  return false;
}

export function getAvailableSlotsForDay(date, availabilityBlocks, sessionDuration, events, schoolId, walkTime, getDriveTime = NO_DRIVE_TIME) {
  const slots = [];
  const duration = sessionDuration || 60;
  for (const block of availabilityBlocks) {
    const [startH, startM] = block.start.split(':').map(Number);
    const [endH, endM] = block.end.split(':').map(Number);
    let slotStart = tzDate(date, startH, startM);
    const blockEnd = tzDate(date, endH, endM);
    while (slotStart < blockEnd) {
      const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);
      if (slotEnd > blockEnd) break;
      const isBlocked = hasSchedulingConflict(slotStart, slotEnd, events, schoolId, walkTime, getDriveTime);
      if (!isBlocked) slots.push({ time: slotStart.toISOString(), available: true, blockName: block.name || null });
      slotStart = new Date(slotStart.getTime() + 5 * 60 * 1000);
    }
  }
  return slots;
}
