import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { google } from 'googleapis'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDriveTime } from './schoolConfig.js'
import { saveTokens, loadTokens, deleteTokens, hasTokens, getTokenInfo } from './tokenStorage.js'
import { loadSchools, saveSchools, loadDriveTimes, saveDriveTimes, getDriveTimeFromStorage } from './schoolsStorage.js'
import { loadCalendarConfig, saveCalendarConfig } from './calendarStorage.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 5000

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
function getAvailableSlotsForDay(date, availabilityBlocks, sessionDuration, events, schoolId) {
  const slots = []
  const duration = sessionDuration || 60

  for (const block of availabilityBlocks) {
    const [startH, startM] = block.start.split(':').map(Number)
    const [endH, endM] = block.end.split(':').map(Number)

    let slotStart = new Date(date)
    slotStart.setHours(startH, startM, 0, 0)

    const blockEnd = new Date(date)
    blockEnd.setHours(endH, endM, 0, 0)

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

      if (!isBlocked) slots.push({ time: slotStart.toISOString(), available: true })
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
    const { year, month, schoolId, sessionDuration } = req.body // month: 0-indexed (JS convention)

    // Load school availability from storage
    const schools = loadSchools()
    const school = schools.find(s => s.id === schoolId)
    const availability = school?.availability || {}

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

    // If Google Calendar is configured, create calendar event
    if (calendar) {
      const startDateTime = new Date(time)
      const durationMs = (sessionDuration || 60) * 60 * 1000 // Convert minutes to milliseconds
      const endDateTime = new Date(startDateTime.getTime() + durationMs)

      const event = {
        summary: `Tutoring Session - ${name}`,
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

// Get all bookings (admin endpoint - add authentication in production)
app.get('/api/bookings', (req, res) => {
  res.json({ bookings })
})

// Public config (safe values the frontend needs at runtime)
app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  })
})

// List all Google Calendars accessible to the connected account
app.get('/api/calendars', async (req, res) => {
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

// Calendar selection config (which calendars to check / where to create bookings)
app.get('/api/config/calendars', (req, res) => {
  res.json(loadCalendarConfig())
})

app.put('/api/config/calendars', (req, res) => {
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

// Schools CRUD
app.get('/api/schools', (req, res) => {
  res.json(loadSchools())
})

app.put('/api/schools', (req, res) => {
  const schools = req.body
  if (!Array.isArray(schools)) {
    return res.status(400).json({ error: 'Expected an array of schools' })
  }
  const ok = saveSchools(schools)
  if (ok) res.json({ success: true })
  else res.status(500).json({ error: 'Failed to save schools' })
})

// Drive times CRUD
app.get('/api/drivetimes', (req, res) => {
  res.json(loadDriveTimes())
})

app.put('/api/drivetimes', (req, res) => {
  const driveTimes = req.body
  if (typeof driveTimes !== 'object' || Array.isArray(driveTimes)) {
    return res.status(400).json({ error: 'Expected an object' })
  }
  const ok = saveDriveTimes(driveTimes)
  if (ok) res.json({ success: true })
  else res.status(500).json({ error: 'Failed to save drive times' })
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

// Disconnect Google Calendar
app.post('/auth/disconnect', (req, res) => {
  const deleted = deleteTokens()
  calendar = null

  res.json({
    success: deleted,
    message: deleted ? 'Google Calendar disconnected' : 'Error disconnecting'
  })
})

// Test the calendar connection with a real API call
app.get('/auth/test', async (req, res) => {
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

// Debug: token storage info (no secrets)
app.get('/auth/debug', (req, res) => {
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
