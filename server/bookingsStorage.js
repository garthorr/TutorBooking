import dbService from './services/dbService.js';

const ADMIN_ID = 1; // Single user for now

export function loadBookings() {
  return dbService.getBookings(ADMIN_ID);
}

export function addBooking(newBooking) {
  dbService.addBooking(ADMIN_ID, newBooking);
  return dbService.getBookings(ADMIN_ID);
}
