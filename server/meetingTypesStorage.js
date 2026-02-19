import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

function getDataDir() {
  return process.env.DATA_DIR || join(process.cwd())
}

function meetingTypesFile() {
  return join(getDataDir(), 'meeting-types.json')
}

const DEFAULT_WEEKDAY_AVAILABILITY = {
  0: [],
  1: [{ start: '09:00', end: '17:00' }],
  2: [{ start: '09:00', end: '17:00' }],
  3: [{ start: '09:00', end: '17:00' }],
  4: [{ start: '09:00', end: '17:00' }],
  5: [{ start: '09:00', end: '17:00' }],
  6: []
}

// Returns the baseline meeting types.
// googleMeetDuration lets legacy settings.googleMeetDuration seed the default.
export function getDefaultMeetingTypes(googleMeetDuration = 60) {
  return [
    {
      id: 'phone-call',
      label: 'Phone Call',
      description: 'Quick 15-minute call to discuss your needs.',
      icon: '📞',
      enabled: true,
      order: 0,
      sessionDuration: 15,
      availability: { ...DEFAULT_WEEKDAY_AVAILABILITY },
      isBuiltin: true,
      requiresSchool: false
    },
    {
      id: 'google-meet',
      label: 'Google Meet',
      description: 'Join remotely via video call. A Google Meet link will be generated and sent to you.',
      icon: '📹',
      enabled: true,
      order: 1,
      sessionDuration: googleMeetDuration,
      availability: { ...DEFAULT_WEEKDAY_AVAILABILITY },
      isBuiltin: true,
      requiresSchool: false
    },
    {
      id: 'physical',
      label: 'School Location',
      description: 'Meet in person at one of the schools.',
      icon: '🏫',
      enabled: true,
      order: 2,
      sessionDuration: null,
      availability: null,
      isBuiltin: true,
      requiresSchool: true
    }
  ]
}

export function loadMeetingTypes(googleMeetDuration = 60) {
  try {
    if (!existsSync(meetingTypesFile())) return getDefaultMeetingTypes(googleMeetDuration)
    const raw = readFileSync(meetingTypesFile(), 'utf8').trim()
    if (!raw) return getDefaultMeetingTypes(googleMeetDuration)
    return JSON.parse(raw)
  } catch (err) {
    console.error('Error loading meeting types:', err.message)
    return getDefaultMeetingTypes(googleMeetDuration)
  }
}

export function saveMeetingTypes(types) {
  try {
    writeFileSync(meetingTypesFile(), JSON.stringify(types, null, 2))
    return true
  } catch (err) {
    console.error('Error saving meeting types:', err.message)
    return false
  }
}
