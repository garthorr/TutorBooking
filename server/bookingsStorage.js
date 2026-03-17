import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');

// Maximum bookings to keep in memory (older ones are archived)
const MAX_BOOKINGS_IN_MEMORY = 100;

/**
 * Load bookings from persistent storage
 * Automatically cleans up old bookings to prevent memory leaks
 */
export function loadBookings() {
  try {
    if (!existsSync(BOOKINGS_FILE)) {
      return [];
    }

    const data = JSON.parse(readFileSync(BOOKINGS_FILE, 'utf8'));

    // Clean up old bookings (keep only last MAX_BOOKINGS_IN_MEMORY)
    // This prevents unbounded memory growth on low-RAM instances
    if (Array.isArray(data) && data.length > MAX_BOOKINGS_IN_MEMORY) {
      console.log(`⚠️  Cleaning up old bookings: ${data.length} -> ${MAX_BOOKINGS_IN_MEMORY}`);
      const recentBookings = data.slice(-MAX_BOOKINGS_IN_MEMORY);
      saveBookings(recentBookings);
      return recentBookings;
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Error loading bookings:', error);
    return [];
  }
}

/**
 * Save bookings to persistent storage
 * Automatically limits array size to prevent memory leaks
 */
export function saveBookings(bookings) {
  try {
    // Ensure we never store more than MAX_BOOKINGS_IN_MEMORY
    const bookingsToSave = bookings.slice(-MAX_BOOKINGS_IN_MEMORY);

    writeFileSync(BOOKINGS_FILE, JSON.stringify(bookingsToSave, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving bookings:', error);
    return false;
  }
}

/**
 * Add a new booking and persist to disk
 * Returns the updated bookings array
 */
export function addBooking(bookings, newBooking) {
  bookings.push(newBooking);

  // Trim to MAX_BOOKINGS_IN_MEMORY before saving
  if (bookings.length > MAX_BOOKINGS_IN_MEMORY) {
    console.log(`⚠️  Trimming bookings array: ${bookings.length} -> ${MAX_BOOKINGS_IN_MEMORY}`);
    bookings = bookings.slice(-MAX_BOOKINGS_IN_MEMORY);
  }

  saveBookings(bookings);
  return bookings;
}

/**
 * Get booking file info for diagnostics
 */
export function getBookingsInfo() {
  return {
    bookingsFile: BOOKINGS_FILE,
    dataDir: DATA_DIR,
    fileExists: existsSync(BOOKINGS_FILE),
    maxBookingsInMemory: MAX_BOOKINGS_IN_MEMORY
  };
}
