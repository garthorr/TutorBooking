import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// Default schools — mirrors client/src/config.js until the user configures via GUI
const DEFAULT_SCHOOLS = []

// Default drive times — mirrors server/schoolConfig.js until configured via GUI
const DEFAULT_DRIVE_TIMES = {}

function getDataDir() {
  return process.env.DATA_DIR || join(process.cwd())
}

function schoolsFile() {
  return join(getDataDir(), 'schools.json')
}

function driveTimesFile() {
  return join(getDataDir(), 'drivetimes.json')
}

export function loadSchools() {
  try {
    if (!existsSync(schoolsFile())) return DEFAULT_SCHOOLS
    const raw = readFileSync(schoolsFile(), 'utf8').trim()
    if (!raw) return DEFAULT_SCHOOLS
    return JSON.parse(raw)
  } catch (err) {
    console.error('Error loading schools:', err.message)
    return DEFAULT_SCHOOLS
  }
}

export function saveSchools(schools) {
  try {
    writeFileSync(schoolsFile(), JSON.stringify(schools, null, 2))
    return true
  } catch (err) {
    console.error('Error saving schools:', err.message)
    return false
  }
}

export function loadDriveTimes() {
  try {
    if (!existsSync(driveTimesFile())) return DEFAULT_DRIVE_TIMES
    const raw = readFileSync(driveTimesFile(), 'utf8').trim()
    if (!raw) return DEFAULT_DRIVE_TIMES
    return JSON.parse(raw)
  } catch (err) {
    console.error('Error loading drive times:', err.message)
    return DEFAULT_DRIVE_TIMES
  }
}

export function saveDriveTimes(driveTimes) {
  try {
    writeFileSync(driveTimesFile(), JSON.stringify(driveTimes, null, 2))
    return true
  } catch (err) {
    console.error('Error saving drive times:', err.message)
    return false
  }
}

// Compute buffer in minutes between two school IDs using stored drive times
export function getDriveTimeFromStorage(fromSchoolId, toSchoolId) {
  if (!fromSchoolId || !toSchoolId || fromSchoolId === toSchoolId) return 0
  const driveTimes = loadDriveTimes()
  const minutes = driveTimes[fromSchoolId]?.[toSchoolId]
  if (minutes === undefined) {
    console.warn(`⚠️  No drive time for ${fromSchoolId} → ${toSchoolId}, defaulting to 30 min drive`)
    return Math.round((30 + 5) / 5) * 5 // 35 min total (30 drive + 5 walking), consistent with known pairs
  }
  return Math.round((minutes + 5) / 5) * 5
}
