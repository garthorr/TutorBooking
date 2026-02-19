import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { google } from 'googleapis'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { rateLimit } from 'express-rate-limit'
import { getDriveTime } from './schoolConfig.js'
import { saveTokens, loadTokens, deleteTokens, hasTokens, getTokenInfo } from './tokenStorage.js'
import { loadSchools, saveSchools, loadDriveTimes, saveDriveTimes, getDriveTimeFromStorage } from './schoolsStorage.js'
import { loadCalendarConfig, saveCalendarConfig } from './calendarStorage.js'
import { loadMeetingTypes, saveMeetingTypes } from './meetingTypesStorage.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 5000

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('⚠️  JWT_SECRET not set — using insecure default. Set JWT_SECRET in .env for production!')
  return 'dev-secret-change-in-production'
})()

// ── Admin auth middleware ─────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    jwt.verify(auth.slice(7), JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token — please log in again' })
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts, please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
})

// Middleware
app.use(cors())
app.use(express.json())

// Store bookings in memory (replace with database in production)
const bookings = []

// Google Calendar API setup (to be configured)
let calendar = null

// Initialize Google Calendar API
function initializeGoogleCalendar() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.log('⚠️  Google Calendar not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env')
    return null
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/auth/google/callback'
    )

    // Persist refreshed tokens automatically so the stored expiry stays current
    oauth2Client.on('tokens', (tokens) => {
      const current = loadTokens() || {}
      saveTokens({ ...current, ...tokens })
    })

    // Try to load tokens from file first (web OAuth flow)
    const savedTokens = loadTokens()
    if (savedTokens) {
      oauth2Client.setCredentials(savedTokens)
      console.log('✓ Loaded tokens from secure storage')
      return google.calendar({ version: 'v3', auth: oauth2Client })
    }

    // Fall back to environment variable (manual setup)
    if (process.env.GOOGLE_REFRESH_TOKEN) {
      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
      })
      console.log('✓ Using refresh token from environment variable')
      return google.calendar({ version: 'v3', auth: oauth2Client })
    }

    console.log('⚠️  No tokens found. Use web interface to connect Google Calendar at /admin')
    return null
  } catch (error) {
    console.error('Error initializing Google Calendar:', error.message)
    return null
  }
}

// Create OAuth client for authentication
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/auth/google/callback'
  )
}

calendar = initializeGoogleCalendar()

// Configured timezone — used to generate slot timestamps so they match the user's local time
const TIMEZONE = process.env.TIMEZONE || 'America/Chicago'

// Create a Date representing a specific clock time (hours, minutes) on the same calendar
// date as baseDate, but expressed in the configured TIMEZONE.
// Without this, Docker's UTC system timezone causes setHours() to produce UTC timestamps
// (e.g. 09:00 UTC) that don't match browser-local timestamps (e.g. 09:00 Chicago = 15:00 UTC).
function tzDate(baseDate, hours, minutes) {
  const dateStr = baseDate.toLocaleDateString('en-CA', { timeZone: TIMEZONE }) // "YYYY-MM-DD"
  const naive = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`)
  const naiveInTZ = new Date(naive.toLocaleString('en-US', { timeZone: TIMEZONE }))
  return new Date(naive.getTime() + (naive.getTime() - naiveInTZ.getTime()))
}

// Helper function to get drive time buffer — prefers GUI-stored data, falls back to schoolConfig.js
function getDriveTimeBuffer(fromSchoolId, toSchoolId) {
  const stored = loadDriveTimes()
  const hasStoredData = Object.keys(stored).length > 0
  return hasStoredData
    ? getDriveTimeFromStorage(fromSchoolId, toSchoolId)
    : getDriveTime(fromSchoolId, toSchoolId)
}

// Fetch events from all configured check-calendars in parallel and merge
async function fetchEventsForPeriod(timeMin, timeMax) {
  if (!calendar) return []
  const { checkCalendars } = loadCalendarConfig()
  const ids = checkCalendars.length > 0 ? checkCalendars : ['primary']
  const results = await Promise.all(
    ids.map(calId =>
      calendar.events.list({
        calendarId: calId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      }).then(r => r.data.items || []).catch(err => {
        console.warn(`⚠️  Could not fetch events from calendar "${calId}": ${err.message}`)
        return []
      })
    )
  )
  return results.flat()
}

// API Routes

// Shared helper: generate available slots for a single day against a set of calendar events
// availabilityBlocks: [{ start: 'HH:MM', end: 'HH:MM' }]
//
// Buffer rules:
//   - Same schoolId on both sides  → 0 min buffer (back-to-back OK at same location)
//   - No schoolId on either side   → 0 min buffer (Google Meet / online sessions)
//   - One side has no schoolId     → 0 min buffer (online ↔ physical needs no travel)
//   - Different schoolIds          → drive time + 5 min walking, rounded to nearest 5
function getAvailableSlotsForDay(date, availabilityBlocks, sessionDuration, events, schoolId) {
  const slots = []
  const duration = sessionDuration || 60

  for (const block of availabilityBlocks) {
    const [startH, startM] = block.start.split(':').map(Number)
    const [endH, endM] = block.end.split(':').map(Number)

    let slotStart = tzDate(date, startH, startM)
    const blockEnd = tzDate(date, endH, endM)

    while (slotStart < blockEnd) {
      const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000)
      if (slotEnd > blockEnd) break // Not enough room for a full session

      let isBlocked = false
      for (const event of events) {
        const eventStart = new Date(event.start.dateTime || event.start.date)
        const eventEnd   = new Date(event.end.dateTime   || event.end.date)
        const eventSchoolId = event.extendedProperties?.private?.schoolId

        if (slotStart < eventEnd && slotEnd > eventStart) { isBlocked = true; break }

        const driveTimeBefore = getDriveTimeBuffer(eventSchoolId, schoolId)
        if (driveTimeBefore > 0) {
          const bufferEnd = new Date(eventEnd.getTime() + driveTimeBefore * 60 * 1000)
          if (slotStart < bufferEnd) { isBlocked = true; break }
        }

        const driveTimeAfter = getDriveTimeBuffer(schoolId, eventSchoolId)
        if (driveTimeAfter > 0) {
          const bufferStart = new Date(eventStart.getTime() - driveTimeAfter * 60 * 1000)
          if (slotEnd > bufferStart) { isBlocked = true; break }
        }
      }

      if (!isBlocked) slots.push({ time: slotStart.toISOString(), available: true, blockName: block.name || null })
      slotStart = new Date(slotStart.getTime() + duration * 60 * 1000)
    }
  }
  return slots
}

// Get available time slots for a specific date (with drive time consideration)
app.post('/api/availability', async (req, res) => {
  try {
    const { date, schoolId, sessionDuration, availabilityBlocks } = req.body
    const selectedDate = new Date(date)
    const dayOfWeek = selectedDate.getDay()

    // Resolve availability blocks: use request body (sent by client) or server-stored school
    let blocks = availabilityBlocks
    if (!blocks) {
      const schools = loadSchools()
      const school = schools.find(s => s.id === schoolId)
      blocks = school?.availability?.[dayOfWeek] || []
    }

    if (calendar) {
      const timeMin = new Date(selectedDate); timeMin.setHours(0, 0, 0, 0)
      const timeMax = new Date(selectedDate); timeMax.setHours(23, 59, 59, 999)

      const events = await fetchEventsForPeriod(timeMin, timeMax)
      const slots = getAvailableSlotsForDay(selectedDate, blocks, sessionDuration, events, schoolId)
      res.json({ slots })
    } else {
      // No calendar — return all potential slots within blocks
      const slots = getAvailableSlotsForDay(selectedDate, blocks, sessionDuration, [], schoolId)
      res.json({ slots })
    }
  } catch (error) {
    console.error('Error fetching availability:', error)
    res.status(500).json({ error: 'Failed to fetch availability' })
  }
})

// Get which days in a month have at least one available slot
app.post('/api/availability/days', async (req, res) => {
  try {
    const { year, month, schoolId, sessionDuration, availabilityBlocks } = req.body // month: 0-indexed (JS convention)

    // Resolve availability: client-provided blocks take priority (supports config fallbacks),
    // otherwise look up the school from storage
    let availability = {}
    if (availabilityBlocks && typeof availabilityBlocks === 'object' && !Array.isArray(availabilityBlocks)) {
      availability = availabilityBlocks
    } else {
      const schools = loadSchools()
      const school = schools.find(s => s.id === schoolId)
      availability = school?.availability || {}
    }

    const firstDay = new Date(year, month, 1)
    const lastDay  = new Date(year, month + 1, 0)
    const today    = new Date(); today.setHours(0, 0, 0, 0)

    const availableDates = []

    if (calendar) {
      // Fetch all events for the month from all configured check-calendars
      const timeMin = firstDay
      const timeMax = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59, 999)
      const allEvents = await fetchEventsForPeriod(timeMin, timeMax)

      for (let d = 1; d <= lastDay.getDate(); d++) {
        const date = new Date(year, month, d)
        if (date < today) continue // Skip past dates

        const dayOfWeek = date.getDay()
        const blocks = availability[dayOfWeek] || []
        if (blocks.length === 0) continue // No availability configured

        // Filter events to just this day
        const dayEvents = allEvents.filter(e => {
          const start = new Date(e.start.dateTime || e.start.date)
          return start.getFullYear() === year && start.getMonth() === month && start.getDate() === d
        })

        const slots = getAvailableSlotsForDay(date, blocks, sessionDuration, dayEvents, schoolId)
        if (slots.length > 0) {
          availableDates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
        }
      }
    } else {
      // No calendar — return all days that have blocks configured and aren't in the past
      for (let d = 1; d <= lastDay.getDate(); d++) {
        const date = new Date(year, month, d)
        if (date < today) continue
        const blocks = availability[date.getDay()] || []
        if (blocks.length > 0) {
          availableDates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
        }
      }
    }

    res.json({ availableDates })
  } catch (error) {
    console.error('Error fetching available days:', error)
    res.status(500).json({ error: 'Failed to fetch available days' })
  }
})

// Legacy GET endpoint for backward compatibility
app.get('/api/availability/:date', async (req, res) => {
  try {
    const { date } = req.params
    const selectedDate = new Date(date)

    // If Google Calendar is configured, check actual availability
    if (calendar) {
      const timeMin = new Date(selectedDate)
      timeMin.setHours(0, 0, 0, 0)

      const timeMax = new Date(selectedDate)
      timeMax.setHours(23, 59, 59, 999)

      const response = await calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      })

      const events = response.data.items || []

      // Generate available slots (9 AM - 5 PM)
      const slots = []
      for (let hour = 9; hour < 17; hour++) {
        const slotTime = new Date(selectedDate)
        slotTime.setHours(hour, 0, 0, 0)

        // Check if slot is available
        const isBooked = events.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date)
          const eventEnd = new Date(event.end.dateTime || event.end.date)
          return slotTime >= eventStart && slotTime < eventEnd
        })

        slots.push({
          time: slotTime.toISOString(),
          available: !isBooked
        })
      }

      res.json({ slots })
    } else {
      // Return default slots if Google Calendar is not configured
      const slots = []
      for (let hour = 9; hour < 17; hour++) {
        const slotTime = new Date(selectedDate)
        slotTime.setHours(hour, 0, 0, 0)
        slots.push({
          time: slotTime.toISOString(),
          available: true
        })
      }
      res.json({ slots })
    }
  } catch (error) {
    console.error('Error fetching availability:', error)
    res.status(500).json({ error: 'Failed to fetch availability' })
  }
})

// Create a booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { date, time, meetingType, location, schoolId, name, email, phone, notes, sessionDuration } = req.body

    const booking = {
      id: Date.now().toString(),
      date,
      time,
      meetingType,
      location,
      schoolId,
      name,
      email,
      phone,
      notes,
      sessionDuration: sessionDuration || 60, // Default to 60 minutes if not provided
      createdAt: new Date().toISOString()
    }

    // Look up schools for event title
    const schools = loadSchools()

    // If Google Calendar is configured, create calendar event
    if (calendar) {
      const startDateTime = new Date(time)
      const durationMs = (sessionDuration || 60) * 60 * 1000 // Convert minutes to milliseconds
      const endDateTime = new Date(startDateTime.getTime() + durationMs)

      const settings = loadSettings()
      const allMeetingTypes = loadMeetingTypes(settings.googleMeetDuration)
      const meetingTypeObj = allMeetingTypes.find(t => t.id === meetingType)
      const eventSummary = meetingType === 'google-meet'
        ? `${name} — Online Tutoring`
        : meetingTypeObj?.requiresSchool
          ? `${name} — Tutoring at ${schools.find(s => s.id === schoolId)?.name || location || 'School'}`
          : `${name} — ${meetingTypeObj?.label || 'Tutoring'} Session`

      const event = {
        summary: eventSummary,
        description: `
Client: ${name}
Email: ${email}
${phone ? `Phone: ${phone}` : ''}
${location ? `Location: ${location}` : ''}
Session Duration: ${sessionDuration || 60} minutes
${notes ? `Notes: ${notes}` : ''}
        `.trim(),
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: process.env.TIMEZONE || 'America/Chicago'
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: process.env.TIMEZONE || 'America/Chicago'
        },
        attendees: [
          { email: email }
        ],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 30 }
          ]
        },
        // Store schoolId in extended properties for drive time calculations
        extendedProperties: {
          private: {
            schoolId: schoolId || '',
            meetingType: meetingType
          }
        }
      }

      // Add Google Meet link if selected
      if (meetingType === 'google-meet') {
        event.conferenceData = {
          createRequest: {
            requestId: booking.id,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        }
      } else {
        // Add physical location
        event.location = location
      }

      const { bookingCalendar } = loadCalendarConfig()
      let calendarWarning = null
      try {
        const calendarEvent = await calendar.events.insert({
          calendarId: bookingCalendar || 'primary',
          resource: event,
          conferenceDataVersion: meetingType === 'google-meet' ? 1 : 0,
          sendUpdates: 'all' // Send email to attendees
        })

        booking.calendarEventId = calendarEvent.data.id
        booking.meetLink = calendarEvent.data.hangoutLink || null

        console.log('✓ Calendar event created:', calendarEvent.data.id)
        if (meetingType === 'google-meet') {
          console.log('✓ Google Meet link:', calendarEvent.data.hangoutLink)
        }
      } catch (calError) {
        console.error('Error creating calendar event:', calError.message)
        calendarWarning = `Calendar event could not be created: ${calError.message}`
      }

      if (calendarWarning) {
        booking.calendarWarning = calendarWarning
      }
    }

    bookings.push(booking)

    console.log(`✓ New booking created: ${name} - ${new Date(time).toLocaleString()} (${sessionDuration || 60} min)${schoolId ? ` at school: ${schoolId}` : ''}`)

    res.status(201).json({
      success: true,
      booking: {
        id: booking.id,
        meetLink: booking.meetLink,
        calendarWarning: booking.calendarWarning || null
      }
    })
  } catch (error) {
    console.error('Error creating booking:', error)
    res.status(500).json({ error: 'Failed to create booking' })
  }
})

// Get all bookings (admin only)
app.get('/api/bookings', adminAuth, (req, res) => {
  res.json({ bookings })
})

// ── Logo storage helpers ──────────────────────────────────────────────────────
function logoFile() { return path.join(process.env.DATA_DIR || __dirname, 'logo.json') }

function loadLogo() {
  try {
    if (!existsSync(logoFile())) return null
    return JSON.parse(readFileSync(logoFile(), 'utf8'))
  } catch { return null }
}

// ── Settings storage helpers ──────────────────────────────────────────────────
function settingsFile() { return path.join(process.env.DATA_DIR || __dirname, 'settings.json') }

const DEFAULT_SETTINGS = {
  googleMeetDuration: 60,
  customLocationDuration: 60,
  themeColor: '#4f46e5',
  businessName: '',
  businessDescription: ''
}

function loadSettings() {
  try {
    if (!existsSync(settingsFile())) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) }
  } catch { return { ...DEFAULT_SETTINGS } }
}

function saveSettings(settings) {
  try { writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); return true }
  catch (err) { console.error('Error saving settings:', err.message); return false }
}

// Public config (safe values the frontend needs at runtime)
app.get('/api/config', (req, res) => {
  const settings = loadSettings()
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    googleMeetDuration: settings.googleMeetDuration,
    customLocationDuration: settings.customLocationDuration,
    themeColor: settings.themeColor,
    businessName: settings.businessName,
    businessDescription: settings.businessDescription
  })
})

// Meeting types — GET is public (booking page), admin endpoints for management
app.get('/api/meeting-types', (req, res) => {
  const settings = loadSettings()
  const types = loadMeetingTypes(settings.googleMeetDuration)
  const enabled = types.filter(t => t.enabled).sort((a, b) => a.order - b.order)
  res.json(enabled)
})

app.get('/api/meeting-types/all', adminAuth, (req, res) => {
  const settings = loadSettings()
  res.json(loadMeetingTypes(settings.googleMeetDuration))
})

app.put('/api/meeting-types', adminAuth, (req, res) => {
  const types = req.body
  if (!Array.isArray(types)) {
    return res.status(400).json({ error: 'Expected an array of meeting types' })
  }
  for (const t of types) {
    if (!t.id || typeof t.label !== 'string' || !t.label.trim()) {
      return res.status(400).json({ error: 'Each type must have an id and a non-empty label' })
    }
  }
  const ok = saveMeetingTypes(types)
  if (ok) res.json({ success: true })
  else res.status(500).json({ error: 'Failed to save meeting types' })
})

// Logo
app.get('/api/logo', (req, res) => {
  const logo = loadLogo()
  if (!logo) return res.status(404).json({ error: 'No logo uploaded' })
  res.json(logo)
})

app.put('/api/logo', adminAuth, express.json({ limit: '4mb' }), (req, res) => {
  const { dataUrl } = req.body
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'dataUrl must be a valid image data URL' })
  }
  try {
    writeFileSync(logoFile(), JSON.stringify({ dataUrl }, null, 2))
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save logo' })
  }
})

app.delete('/api/logo', adminAuth, (req, res) => {
  try {
    if (existsSync(logoFile())) unlinkSync(logoFile())
    res.json({ success: true })
  } catch { res.status(500).json({ error: 'Failed to remove logo' }) }
})

// General settings (Google Meet duration, etc.) — admin only
app.get('/api/settings', adminAuth, (req, res) => {
  res.json(loadSettings())
})

app.put('/api/settings', adminAuth, (req, res) => {
  const current = loadSettings()
  const updated = { ...current }
  if (typeof req.body.googleMeetDuration === 'number' && req.body.googleMeetDuration > 0)
    updated.googleMeetDuration = req.body.googleMeetDuration
  if (typeof req.body.customLocationDuration === 'number' && req.body.customLocationDuration > 0)
    updated.customLocationDuration = req.body.customLocationDuration
  if (typeof req.body.themeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.themeColor))
    updated.themeColor = req.body.themeColor
  if (typeof req.body.businessName === 'string')
    updated.businessName = req.body.businessName.trim()
  if (typeof req.body.businessDescription === 'string')
    updated.businessDescription = req.body.businessDescription.trim()
  const ok = saveSettings(updated)
  if (ok) res.json({ success: true, settings: updated })
  else res.status(500).json({ error: 'Failed to save settings' })
})

// List all Google Calendars accessible to the connected account — admin only
app.get('/api/calendars', adminAuth, async (req, res) => {
  if (!calendar) {
    return res.status(503).json({ error: 'Google Calendar not connected' })
  }
  try {
    const result = await calendar.calendarList.list({ maxResults: 250 })
    const items = (result.data.items || []).map(c => ({
      id: c.id,
      summary: c.summary,
      description: c.description || '',
      primary: !!c.primary,
      backgroundColor: c.backgroundColor || null
    }))
    res.json(items)
  } catch (err) {
    console.error('Error listing calendars:', err.message)
    res.status(500).json({ error: 'Failed to list calendars', detail: err.message })
  }
})

// Calendar selection config — admin only
app.get('/api/config/calendars', adminAuth, (req, res) => {
  res.json(loadCalendarConfig())
})

app.put('/api/config/calendars', adminAuth, (req, res) => {
  const { checkCalendars, bookingCalendar } = req.body
  if (!Array.isArray(checkCalendars) || checkCalendars.length === 0) {
    return res.status(400).json({ error: 'checkCalendars must be a non-empty array' })
  }
  if (typeof bookingCalendar !== 'string' || !bookingCalendar) {
    return res.status(400).json({ error: 'bookingCalendar must be a non-empty string' })
  }
  const ok = saveCalendarConfig({ checkCalendars, bookingCalendar })
  if (ok) res.json({ success: true })
  else res.status(500).json({ error: 'Failed to save calendar config' })
})

// Schools — GET is public (booking page needs the list), PUT is admin only
app.get('/api/schools', (req, res) => {
  res.json(loadSchools())
})

app.put('/api/schools', adminAuth, (req, res) => {
  const schools = req.body
  if (!Array.isArray(schools)) {
    return res.status(400).json({ error: 'Expected an array of schools' })
  }
  const ok = saveSchools(schools)
  if (ok) res.json({ success: true })
  else res.status(500).json({ error: 'Failed to save schools' })
})

// Drive times — admin only
app.get('/api/drivetimes', adminAuth, (req, res) => {
  res.json(loadDriveTimes())
})

app.put('/api/drivetimes', adminAuth, (req, res) => {
  const driveTimes = req.body
  if (typeof driveTimes !== 'object' || Array.isArray(driveTimes)) {
    return res.status(400).json({ error: 'Expected an object' })
  }
  const ok = saveDriveTimes(driveTimes)
  if (ok) res.json({ success: true })
  else res.status(500).json({ error: 'Failed to save drive times' })
})

// Auto-calculate drive times using Google Maps Distance Matrix API — admin only
// Uses a midday weekday departure for a representative traffic estimate.
// Enforces symmetry (A→B = B→A) by averaging both directions.
app.post('/api/drivetimes/calculate', adminAuth, async (req, res) => {
  const schools = req.body
  if (!Array.isArray(schools) || schools.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 schools' })
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY not configured in .env' })
  }

  // Next weekday (Mon–Fri) at noon in the configured timezone
  let date = new Date()
  do { date = new Date(date.getTime() + 24 * 60 * 60 * 1000) }
  while ([0, 6].includes(date.getDay()))
  const departureTime = Math.floor(tzDate(date, 12, 0).getTime() / 1000)

  const addresses = schools.map(s => encodeURIComponent(s.address)).join('|')
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${addresses}&destinations=${addresses}&mode=driving&departure_time=${departureTime}&key=${process.env.GOOGLE_MAPS_API_KEY}`

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (data.status !== 'OK') {
      return res.status(500).json({ error: `Maps API error: ${data.status}`, detail: data.error_message })
    }

    // Extract minutes for each pair (prefer duration_in_traffic when available)
    const driveTimes = {}
    schools.forEach((from, i) => {
      driveTimes[from.id] = {}
      schools.forEach((to, j) => {
        if (i === j) return
        const el = data.rows[i]?.elements[j]
        if (el?.status === 'OK') {
          driveTimes[from.id][to.id] = Math.round((el.duration_in_traffic?.value ?? el.duration.value) / 60)
        }
      })
    })

    // Enforce symmetry: for each pair use the average of both directions
    for (let i = 0; i < schools.length; i++) {
      for (let j = i + 1; j < schools.length; j++) {
        const a = schools[i], b = schools[j]
        const ab = driveTimes[a.id]?.[b.id]
        const ba = driveTimes[b.id]?.[a.id]
        const symmetric = (ab !== undefined && ba !== undefined)
          ? Math.round((ab + ba) / 2)
          : (ab ?? ba)
        if (symmetric !== undefined) {
          driveTimes[a.id][b.id] = symmetric
          driveTimes[b.id][a.id] = symmetric
        }
      }
    }

    res.json({ driveTimes })
  } catch (err) {
    console.error('Drive time calculation error:', err.message)
    res.status(500).json({ error: 'Failed to calculate drive times', detail: err.message })
  }
})

// ── Admin authentication ──────────────────────────────────────────────────────

app.post('/auth/admin/login', loginLimiter, async (req, res) => {
  const { password } = req.body
  const hash = process.env.ADMIN_PASSWORD_HASH
  if (!hash) {
    return res.status(503).json({ error: 'Admin auth not configured. Set ADMIN_PASSWORD_HASH in server/.env' })
  }
  try {
    const match = await bcrypt.compare(password || '', hash)
    if (!match) return res.status(401).json({ error: 'Invalid password' })
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' })
    res.json({ token })
  } catch {
    res.status(500).json({ error: 'Login error' })
  }
})

app.get('/auth/admin/verify', adminAuth, (req, res) => {
  res.json({ ok: true })
})

// OAuth Routes

// Initiate OAuth flow
app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({
      error: 'OAuth not configured',
      message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env'
    })
  }

  const oauth2Client = getOAuthClient()
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    prompt: 'consent' // Force consent screen to ensure we get refresh token
  })

  res.redirect(authUrl)
})

// OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query

  if (error) {
    console.error('OAuth error:', error)
    return res.redirect('/admin?error=auth_failed')
  }

  if (!code) {
    return res.redirect('/admin?error=no_code')
  }

  try {
    const oauth2Client = getOAuthClient()
    const { tokens } = await oauth2Client.getToken(code)

    // Save tokens to encrypted file
    const saved = saveTokens(tokens)

    if (saved) {
      // Reinitialize calendar with new tokens
      calendar = initializeGoogleCalendar()

      console.log('✓ OAuth successful - Google Calendar connected')
      res.redirect('/admin?success=true')
    } else {
      res.redirect('/admin?error=save_failed')
    }
  } catch (error) {
    console.error('Error exchanging code for tokens:', error)
    res.redirect('/admin?error=token_exchange_failed')
  }
})

// Check OAuth status
app.get('/auth/status', (req, res) => {
  const tokenInfo = getTokenInfo()
  res.json({
    connected: calendar !== null,
    hasStoredTokens: tokenInfo.hasTokens,
    hasRefreshToken: tokenInfo.hasRefreshToken,
    tokenExpiry: tokenInfo.tokenExpiry,
    configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  })
})

// Disconnect Google Calendar — admin only
app.post('/auth/disconnect', adminAuth, (req, res) => {
  const deleted = deleteTokens()
  calendar = null

  res.json({
    success: deleted,
    message: deleted ? 'Google Calendar disconnected' : 'Error disconnecting'
  })
})

// Test the calendar connection with a real API call — admin only
app.get('/auth/test', adminAuth, async (req, res) => {
  if (!calendar) {
    return res.json({
      success: false,
      error: 'Calendar not initialized — connect Google Calendar in the admin panel first.'
    })
  }
  try {
    const result = await calendar.calendarList.list({ maxResults: 1 })
    const items = result.data.items || []
    res.json({
      success: true,
      message: 'Google Calendar API is working correctly.',
      calendarsFound: items.length,
      primaryCalendar: items.find(c => c.primary)?.summary || items[0]?.summary || null
    })
  } catch (err) {
    res.json({
      success: false,
      error: err.message,
      code: err.code || err.status || null
    })
  }
})

// Debug: token storage info (no secrets) — admin only
app.get('/auth/debug', adminAuth, (req, res) => {
  res.json(getTokenInfo())
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    googleCalendarConnected: calendar !== null,
    driveTimeCalculation: 'actual drive time + 5 min walking, rounded to nearest 5 min',
    timestamp: new Date().toISOString()
  })
})

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')))

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📅 Google Calendar: ${calendar ? '✓ Connected' : '✗ Not configured'}`)
  console.log(`🚗 Drive Time: Actual time + 5 min walking (rounded to nearest 5 min)`)

  // Startup diagnostics for token storage
  const tokenInfo = getTokenInfo()
  console.log(`🔑 Token file: ${tokenInfo.tokenFilePath}`)
  console.log(`   File exists: ${tokenInfo.fileExists}`)
  console.log(`   Has tokens: ${tokenInfo.hasTokens}`)
  if (tokenInfo.hasTokens) {
    console.log(`   Has refresh_token: ${tokenInfo.hasRefreshToken}`)
    console.log(`   Token expiry: ${tokenInfo.tokenExpiry || 'none'}`)
  }
  if (tokenInfo.readError) {
    console.log(`   ⚠️  Read error: ${tokenInfo.readError}`)
  }

  if (!calendar) {
    console.log('\n⚙️  Setup Google Calendar:')
    console.log(`   Visit: http://localhost:${PORT}/admin`)
    console.log('   Or configure manually in .env file\n')
  } else {
    console.log(`\n⚙️  Admin Panel: http://localhost:${PORT}/admin\n`)
  }
})
