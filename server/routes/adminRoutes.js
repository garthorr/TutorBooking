import express from 'express';
import {
  getConfig,
  getSettings,
  updateSettings,
  getSchools,
  updateSchools,
  getDriveTimes,
  updateDriveTimes,
  calculateDriveTimes,
  getMeetingTypes,
  getMeetingTypeById,
  getAllMeetingTypes,
  updateMeetingTypes,
  getCalendarConfig,
  updateCalendarConfig,
  getLogo,
  updateLogo,
  deleteLogo
} from '../controllers/adminController.js';
import { changePassword, listCalendars } from '../controllers/authController.js';
import { adminAuth } from './authRoutes.js';

const router = express.Router();

// Public routes
router.get('/config', getConfig);
router.get('/schools', getSchools);
router.get('/meeting-types', getMeetingTypes);
router.get('/logo', getLogo);

// Admin routes
router.get('/settings', adminAuth, getSettings);
router.put('/settings', adminAuth, updateSettings);
router.put('/schools', adminAuth, updateSchools);
router.get('/drivetimes', adminAuth, getDriveTimes);
router.put('/drivetimes', adminAuth, updateDriveTimes);
router.post('/drivetimes/calculate', adminAuth, calculateDriveTimes);
router.get('/meeting-types/all', adminAuth, getAllMeetingTypes);
// Public single-type lookup; registered after /meeting-types/all so the
// literal segment wins over the :id parameter.
router.get('/meeting-types/:id', getMeetingTypeById);
router.put('/meeting-types', adminAuth, updateMeetingTypes);
router.get('/calendars', adminAuth, listCalendars);
router.get('/config/calendars', adminAuth, getCalendarConfig);
router.put('/config/calendars', adminAuth, updateCalendarConfig);
router.put('/logo', adminAuth, updateLogo);
router.delete('/logo', adminAuth, deleteLogo);

// Compatibility route for change-password
router.post('/admin/change-password', adminAuth, changePassword);

export default router;
