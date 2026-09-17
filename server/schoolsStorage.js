import dbService from './services/dbService.js';

const ADMIN_ID = 1;

export function loadSchools() {
  const schools = dbService.getSchools(ADMIN_ID);
  return schools.map(s => {
    const raw = JSON.parse(s.availability) || {};
    const availability = Object.fromEntries(
      Object.entries(raw).filter(([, blocks]) => Array.isArray(blocks) && blocks.length > 0)
    );
    return { ...s, availability, sessionDuration: s.session_duration, logoUrl: s.logo_url };
  });
}

export function saveSchools(schools) {
  return dbService.saveSchools(ADMIN_ID, schools);
}

export function loadDriveTimes() {
  return dbService.getDriveTimes(ADMIN_ID);
}

export function saveDriveTimes(driveTimes) {
  return dbService.saveDriveTimes(ADMIN_ID, driveTimes);
}

// Resolve a travel buffer from an already-loaded drive-time matrix.
function resolveDriveTime(driveTimes, fromSchoolId, toSchoolId, walkTime = 5) {
  if (!fromSchoolId || !toSchoolId || fromSchoolId === toSchoolId) return 0;
  const minutes = driveTimes[fromSchoolId]?.[toSchoolId];
  if (minutes === undefined) {
    return Math.round((30 + walkTime) / 5) * 5;
  }
  return Math.round((minutes + walkTime) / 5) * 5;
}

/*
 * Build a drive-time lookup backed by a single database read.
 *
 * Availability generation asks for travel buffers once per event per candidate
 * slot, so resolving each one straight from SQLite meant thousands of queries
 * for a single month view. The matrix is small and changes only when an admin
 * edits it, so it is read once per request and closed over.
 */
export function createDriveTimeResolver() {
  const driveTimes = dbService.getDriveTimes(ADMIN_ID);
  return (fromSchoolId, toSchoolId, walkTime = 5) =>
    resolveDriveTime(driveTimes, fromSchoolId, toSchoolId, walkTime);
}

// Single-lookup form, kept for callers outside a request loop. Prefer
// createDriveTimeResolver() anywhere a lookup happens more than once.
export function getDriveTimeFromStorage(fromSchoolId, toSchoolId, walkTime = 5) {
  return resolveDriveTime(dbService.getDriveTimes(ADMIN_ID), fromSchoolId, toSchoolId, walkTime);
}
