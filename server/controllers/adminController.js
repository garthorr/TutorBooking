import dbService from '../services/dbService.js';
import { loadSchools, saveSchools, loadDriveTimes, saveDriveTimes } from '../schoolsStorage.js';
import { loadMeetingTypes, saveMeetingTypes } from '../meetingTypesStorage.js';
import { loadCalendarConfig, saveCalendarConfig } from '../calendarStorage.js';

const ADMIN_ID = 1;

export const getConfig = (req, res) => {
  const settings = dbService.getSettings(ADMIN_ID);
  res.json({
    googleMeetDuration: settings.google_meet_duration,
    customLocationDuration: settings.custom_location_duration,
    themeColor: settings.theme_color,
    businessName: settings.business_name,
    businessDescription: settings.business_description
  });
};

export const getSettings = (req, res) => {
  const settings = dbService.getSettings(ADMIN_ID);
  res.json({
    ...settings,
    googleMeetDuration: settings.google_meet_duration,
    customLocationDuration: settings.custom_location_duration,
    themeColor: settings.theme_color,
    businessName: settings.business_name,
    businessDescription: settings.business_description,
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  });
};

export const updateSettings = (req, res) => {
  const current = dbService.getSettings(ADMIN_ID);
  const updated = {
    googleMeetDuration: req.body.googleMeetDuration || current.google_meet_duration,
    customLocationDuration: req.body.customLocationDuration || current.custom_location_duration,
    themeColor: req.body.themeColor || current.theme_color,
    businessName: (req.body.businessName || current.business_name || '').trim(),
    businessDescription: (req.body.businessDescription || current.business_description || '').trim()
  };
  dbService.updateSettings(ADMIN_ID, updated);
  res.json({ success: true, settings: updated });
};

export const getSchools = (req, res) => {
  res.json(loadSchools());
};

export const updateSchools = (req, res) => {
  saveSchools(req.body);
  res.json({ success: true });
};

export const getDriveTimes = (req, res) => {
  res.json(loadDriveTimes());
};

export const updateDriveTimes = (req, res) => {
  saveDriveTimes(req.body);
  res.json({ success: true });
};

export const getMeetingTypes = (req, res) => {
  const types = loadMeetingTypes();
  const enabled = types.filter(t => t.enabled).sort((a, b) => a.order - b.order);
  res.json(enabled);
};

export const getAllMeetingTypes = (req, res) => {
  res.json(loadMeetingTypes());
};

export const updateMeetingTypes = (req, res) => {
  saveMeetingTypes(req.body);
  res.json({ success: true });
};

export const getCalendarConfig = (req, res) => {
  res.json(loadCalendarConfig());
};

export const updateCalendarConfig = (req, res) => {
  saveCalendarConfig(req.body);
  res.json({ success: true });
};

export const getLogo = (req, res) => {
  const logo = dbService.getLogo(ADMIN_ID);
  if (!logo) return res.status(404).json({ error: 'No logo' });
  res.json({ dataUrl: logo.data_url });
};

export const updateLogo = (req, res) => {
  dbService.saveLogo(ADMIN_ID, req.body.dataUrl);
  res.json({ success: true });
};

export const deleteLogo = (req, res) => {
  dbService.deleteLogo(ADMIN_ID);
  res.json({ success: true });
};
