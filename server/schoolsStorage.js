import dbService from './services/dbService.js';

const ADMIN_ID = 1;

export function loadSchools() {
  const schools = dbService.getSchools(ADMIN_ID);
  return schools.map(s => ({
    ...s,
    availability: JSON.parse(s.availability)
  }));
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

export function getDriveTimeFromStorage(fromSchoolId, toSchoolId) {
  if (!fromSchoolId || !toSchoolId || fromSchoolId === toSchoolId) return 0;
  const driveTimes = dbService.getDriveTimes(ADMIN_ID);
  const minutes = driveTimes[fromSchoolId]?.[toSchoolId];
  if (minutes === undefined) {
    return Math.round((30 + 5) / 5) * 5;
  }
  return Math.round((minutes + 5) / 5) * 5;
}
