import dbService from '../services/dbService.js';
import { loadSchools, saveSchools, loadDriveTimes, saveDriveTimes } from '../schoolsStorage.js';
import { loadMeetingTypes, saveMeetingTypes } from '../meetingTypesStorage.js';
import { loadCalendarConfig, saveCalendarConfig } from '../calendarStorage.js';
import { getCaptchaConfig } from '../services/captchaService.js';
import { normalizeAvailability } from '../services/availability.js';
import { CUSTOM_LOCATION_AVAILABILITY } from '../customLocationConfig.js';

const ADMIN_ID = 1;

export const getConfig = (req, res) => {
  const settings = dbService.getSettings(ADMIN_ID);
  res.json({
    googleMeetDuration: settings.google_meet_duration,
    customLocationDuration: settings.custom_location_duration,
    walkTime: settings.walk_time ?? 5,
    minimumNoticeMinutes: settings.minimum_notice_minutes ?? 120,
    maxAdvanceDays: settings.max_advance_days ?? 90,
    themeColor: settings.theme_color,
    businessName: settings.business_name,
    businessDescription: settings.business_description,
    // The booking page uses this for "Other location" slots. Serving it keeps
    // the times offered identical to the times the server will accept.
    customLocationAvailability: CUSTOM_LOCATION_AVAILABILITY,
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
    minimumNoticeMinutes: settings.minimum_notice_minutes ?? 120,
    maxAdvanceDays: settings.max_advance_days ?? 90,
    themeColor: settings.theme_color,
    businessName: settings.business_name,
    businessDescription: settings.business_description,
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  });
};

// Minutes of warning required before a session can start. 0 disables the rule;
// the upper bound is 30 days, past which no slot would ever be offered.
function clampNotice(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.round(n), 30 * 24 * 60);
}

// How far ahead a session may be booked. At least 1 day; 3650 is an upper
// bound that keeps the month-view loop and date maths sane.
function clampAdvance(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.round(n), 3650);
}

export const updateSettings = (req, res) => {
  const current = dbService.getSettings(ADMIN_ID);
  const updated = {
    googleMeetDuration: req.body.googleMeetDuration || current.google_meet_duration,
    customLocationDuration: req.body.customLocationDuration || current.custom_location_duration,
    walkTime: req.body.walkTime ?? current.walk_time ?? 5,
    minimumNoticeMinutes: clampNotice(req.body.minimumNoticeMinutes, current.minimum_notice_minutes ?? 120),
    maxAdvanceDays: clampAdvance(req.body.maxAdvanceDays, current.max_advance_days ?? 90),
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

// Expects { fromSchoolId: { toSchoolId: minutes } }. Anything else would be
// written straight to the drive_times table and then fed into slot generation.
export const updateDriveTimes = (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Expected an object of drive times keyed by school id' });
  }
  // drive_times has foreign keys onto schools, so an unknown id would surface
  // as a raw SqliteError rather than something the admin screen can show.
  const knownSchools = new Set(loadSchools().map(s => s.id));
  for (const [fromId, targets] of Object.entries(body)) {
    if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
      return res.status(400).json({ error: `Drive times for "${fromId}" must be an object keyed by destination school id` });
    }
    if (!knownSchools.has(fromId)) {
      return res.status(400).json({ error: `Unknown school "${fromId}"` });
    }
    for (const [toId, minutes] of Object.entries(targets)) {
      if (!knownSchools.has(toId)) {
        return res.status(400).json({ error: `Unknown school "${toId}"` });
      }
      if (!Number.isFinite(Number(minutes)) || Number(minutes) < 0 || Number(minutes) > 24 * 60) {
        return res.status(400).json({ error: `Drive time ${fromId} \u2192 ${toId} must be a number of minutes between 0 and 1440` });
      }
    }
  }
  try {
    saveDriveTimes(body);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save drive times:', err);
    res.status(500).json({ error: 'Failed to save drive times' });
  }
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
  // Secret types are bookable via their direct link only — they never appear
  // in the public listing that drives the main booking page.
  const listed = types.filter(t => t.enabled && !t.secret).sort((a, b) => a.order - b.order);
  res.json(listed);
};

// Public: resolve a single enabled meeting type by id, including secret ones,
// so direct /book/:typeId links work for types hidden from the main page.
export const getMeetingTypeById = (req, res) => {
  const type = loadMeetingTypes().find(t => t.id === req.params.id && t.enabled);
  if (!type) return res.status(404).json({ error: 'Meeting type not found' });
  res.json(type);
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

// A malformed body here used to be stored verbatim, so `check_calendars` could
// become the string "undefined" and every later JSON.parse would throw — taking
// down availability site-wide with no admin screen left to fix it from.
export const updateCalendarConfig = (req, res) => {
  const { checkCalendars, bookingCalendar } = req.body || {};
  if (!Array.isArray(checkCalendars) || !checkCalendars.every(id => typeof id === 'string' && id.trim())) {
    return res.status(400).json({ error: 'checkCalendars must be an array of calendar ids' });
  }
  if (typeof bookingCalendar !== 'string' || !bookingCalendar.trim()) {
    return res.status(400).json({ error: 'bookingCalendar must be a calendar id' });
  }
  try {
    saveCalendarConfig({ checkCalendars, bookingCalendar });
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save calendar config:', err);
    res.status(500).json({ error: 'Failed to save calendar config' });
  }
};

export const getLogo = (req, res) => {
  const logo = dbService.getLogo(ADMIN_ID);
  if (!logo) return res.status(404).json({ error: 'No logo' });
  res.json({ dataUrl: logo.data_url });
};

// The logo is echoed back to every public visitor via GET /api/logo and dropped
// straight into an <img src>, so only real image data URLs are accepted.
const LOGO_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export const updateLogo = (req, res) => {
  const { dataUrl } = req.body || {};
  if (typeof dataUrl !== 'string' || !LOGO_DATA_URL_RE.test(dataUrl)) {
    return res.status(400).json({ error: 'Logo must be a base64 image data URL (PNG, JPEG, GIF, WebP or SVG)' });
  }
  if (Buffer.byteLength(dataUrl, 'utf8') > MAX_LOGO_BYTES) {
    return res.status(413).json({ error: 'Logo is too large \u2014 please use an image under 2MB' });
  }
  try {
    dbService.saveLogo(ADMIN_ID, dataUrl);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save logo:', err);
    res.status(500).json({ error: 'Failed to save logo' });
  }
};

export const deleteLogo = (req, res) => {
  dbService.deleteLogo(ADMIN_ID);
  res.json({ success: true });
};
