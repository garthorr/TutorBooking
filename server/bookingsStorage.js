import dbService from './services/dbService.js';

const ADMIN_ID = 1; // Single user for now

export function loadBookings() {
  return dbService.getBookings(ADMIN_ID);
}

export function saveBookings(bookings) {
  // Not needed with database, but kept for compatibility
  return true;
}

export function addBooking(bookings, newBooking) {
  dbService.addBooking(ADMIN_ID, newBooking);
  return dbService.getBookings(ADMIN_ID);
}

export function getBookingsInfo() {
  return {
    storage: 'sqlite',
    adminId: ADMIN_ID
  };
}
