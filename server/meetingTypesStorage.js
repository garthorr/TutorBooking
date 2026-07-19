import dbService from './services/dbService.js';

const ADMIN_ID = 1;

const DEFAULT_WEEKDAY_AVAILABILITY = {
  1: [{ start: '09:00', end: '17:00' }],
  2: [{ start: '09:00', end: '17:00' }],
  3: [{ start: '09:00', end: '17:00' }],
  4: [{ start: '09:00', end: '17:00' }],
  5: [{ start: '09:00', end: '17:00' }],
}

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
      requiresSchool: false,
      secret: false
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
      requiresSchool: false,
      secret: false
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
      requiresSchool: true,
      secret: false
    }
  ]
}

export function loadMeetingTypes(googleMeetDuration = 60) {
  const types = dbService.getMeetingTypes(ADMIN_ID);
  if (types.length === 0) return getDefaultMeetingTypes(googleMeetDuration);
  return types;
}

export function saveMeetingTypes(types) {
  return dbService.saveMeetingTypes(ADMIN_ID, types);
}
