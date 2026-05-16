import dbService from './services/dbService.js';

const ADMIN_ID = 1;

const DEFAULT_CONFIG = {
  checkCalendars: ['primary'],
  bookingCalendar: 'primary'
};

export function loadCalendarConfig() {
  const config = dbService.getCalendarConfig(ADMIN_ID);
  return config || { ...DEFAULT_CONFIG };
}

export function saveCalendarConfig(config) {
  return dbService.saveCalendarConfig(ADMIN_ID, config);
}
