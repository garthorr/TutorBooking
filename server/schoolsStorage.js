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

export function getDriveTimeFromStorage(fromSchoolId, toSchoolId, walkTime = 5) {
  if (!fromSchoolId || !toSchoolId || fromSchoolId === toSchoolId) return 0;
  const driveTimes = dbService.getDriveTimes(ADMIN_ID);
  const minutes = driveTimes[fromSchoolId]?.[toSchoolId];
  if (minutes === undefined) {
    return Math.round((30 + walkTime) / 5) * 5;
  }
  return Math.round((minutes + walkTime) / 5) * 5;
}
