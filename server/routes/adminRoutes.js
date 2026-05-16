import express from 'express';
import {
  getConfig,
  getSettings,
  updateSettings,
  getSchools,
  updateSchools,
  getDriveTimes,
  updateDriveTimes,
  getMeetingTypes,
  updateMeetingTypes,
  getCalendarConfig,
  updateCalendarConfig,
  getLogo,
  updateLogo,
  deleteLogo
} from '../controllers/adminController.js';
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
router.get('/meeting-types/all', adminAuth, getMeetingTypes);
router.put('/meeting-types', adminAuth, updateMeetingTypes);
router.get('/config/calendars', adminAuth, getCalendarConfig);
router.put('/config/calendars', adminAuth, updateCalendarConfig);
router.put('/logo', adminAuth, updateLogo);
router.delete('/logo', adminAuth, deleteLogo);

export default router;
