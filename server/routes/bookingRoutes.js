import express from 'express';
import {
  getAvailability,
  getAvailableDays,
  createBooking,
  getBookings
} from '../controllers/bookingController.js';
import { adminAuth } from './authRoutes.js';
import { rateLimit } from 'express-rate-limit';

const router = express.Router();

const availabilityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  message: { error: 'Too many availability checks. Please wait a minute and try again.' },
  standardHeaders: true,
  legacyHeaders: false
});

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: { error: 'Too many booking attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/availability', availabilityLimiter, getAvailability);
router.post('/availability/days', availabilityLimiter, getAvailableDays);
router.post('/bookings', bookingLimiter, createBooking);
router.get('/bookings', adminAuth, getBookings);

export default router;
