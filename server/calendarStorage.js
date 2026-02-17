import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const DEFAULT_CONFIG = {
  // Calendar IDs to check when determining availability (can be multiple)
  checkCalendars: ['primary'],
  // Calendar ID where new booking events are created
  bookingCalendar: 'primary'
}

function getDataDir() {
  return process.env.DATA_DIR || process.cwd()
}

function configFile() {
  return join(getDataDir(), 'calendar-config.json')
}

export function loadCalendarConfig() {
  try {
    if (!existsSync(configFile())) return { ...DEFAULT_CONFIG }
    const raw = readFileSync(configFile(), 'utf8').trim()
    if (!raw) return { ...DEFAULT_CONFIG }
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch (err) {
    console.error('Error loading calendar config:', err.message)
    return { ...DEFAULT_CONFIG }
  }
}

export function saveCalendarConfig(config) {
  try {
    writeFileSync(configFile(), JSON.stringify(config, null, 2))
    return true
  } catch (err) {
    console.error('Error saving calendar config:', err.message)
    return false
  }
}
