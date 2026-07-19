import dbService from '../services/dbService.js';
import { loadSchools, saveSchools, loadDriveTimes, saveDriveTimes } from '../schoolsStorage.js';
import { loadMeetingTypes, saveMeetingTypes } from '../meetingTypesStorage.js';
import { loadCalendarConfig, saveCalendarConfig } from '../calendarStorage.js';
import { getCaptchaConfig } from '../services/captchaService.js';
import { normalizeAvailability } from '../services/availability.js';

const ADMIN_ID = 1;

export const getConfig = (req, res) => {
  const settings = dbService.getSettings(ADMIN_ID);
  res.json({
    googleMeetDuration: settings.google_meet_duration,
    customLocationDuration: settings.custom_location_duration,
    walkTime: settings.walk_time ?? 5,
    themeColor: settings.theme_color,
    businessName: settings.business_name,
    businessDescription: settings.business_description,
    // Lets the public booking form know whether/how to render a CAPTCHA widget.
    captcha: getCaptchaConfig()
  });
};

export const getSettings = (req, res) => {
  const settings = dbService.getSettings(ADMIN_ID);
  res.json({
    ...settings,
    googleMeetDuration: settings.google_meet_duration,
    customLocationDuration: settings.custom_location_duration,
    walkTime: settings.walk_time ?? 5,
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
    walkTime: req.body.walkTime ?? current.walk_time ?? 5,
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
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected an array of schools' });
  }
  const schools = [];
  for (const school of req.body) {
    const result = normalizeAvailability(school?.availability, `school "${school?.name || school?.id || '?'}"`);
    if (result.error) return res.status(400).json({ error: result.error });
    schools.push({ ...school, availability: result.value });
  }
  try {
    saveSchools(schools);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save schools:', err);
    res.status(500).json({ error: 'Failed to save schools' });
  }
};

export const getDriveTimes = (req, res) => {
  res.json(loadDriveTimes());
};

export const updateDriveTimes = (req, res) => {
  saveDriveTimes(req.body);
  res.json({ success: true });
};

export const calculateDriveTimes = async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'GOOGLE_MAPS_API_KEY is not configured on the server' });
  }

  const schools = Array.isArray(req.body) ? req.body : [];
  const valid = schools.filter(s => s && s.id && typeof s.address === 'string' && s.address.trim());
  if (valid.length < 2) {
    return res.status(400).json({ error: 'At least two schools with addresses are required' });
  }

  const addresses = valid.map(s => s.address);
  const params = new URLSearchParams({
    origins: addresses.join('|'),
    destinations: addresses.join('|'),
    mode: 'driving',
    units: 'metric',
    key: apiKey
  });
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;

  let data;
  try {
    const response = await fetch(url);
    data = await response.json();
  } catch (err) {
    return res.status(502).json({ error: `Failed to reach Google Maps: ${err.message}` });
  }

  if (data.status !== 'OK') {
    return res.status(502).json({ error: `Google Maps error: ${data.error_message || data.status}` });
  }

  const driveTimes = {};
  valid.forEach((from, i) => {
    driveTimes[from.id] = {};
    const row = data.rows?.[i];
    valid.forEach((to, j) => {
      if (from.id === to.id) return;
      const element = row?.elements?.[j];
      if (element?.status === 'OK' && element.duration) {
        driveTimes[from.id][to.id] = Math.round(element.duration.value / 60);
      } else {
        driveTimes[from.id][to.id] = 0;
      }
    });
  });

  res.json({ driveTimes });
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
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected an array of meeting types' });
  }
  const types = [];
  for (const type of req.body) {
    const result = normalizeAvailability(type?.availability, `meeting type "${type?.label || type?.id || '?'}"`);
    if (result.error) return res.status(400).json({ error: result.error });
    types.push({ ...type, availability: result.value });
  }
  saveMeetingTypes(types);
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
