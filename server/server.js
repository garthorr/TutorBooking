import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { google } from 'googleapis'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDriveTime } from './schoolConfig.js'
import { saveTokens, loadTokens, deleteTokens, hasTokens } from './tokenStorage.js'
import { loadSchools, saveSchools, loadDriveTimes, saveDriveTimes, getDriveTimeFromStorage } from './schoolsStorage.js'

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

// API Routes

// Get available time slots with drive time consideration
app.post('/api/availability', async (req, res) => {
  try {
    const { date, schoolId, sessionDuration } = req.body
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

      // Generate available slots
      const slots = []
      const duration = sessionDuration || 60

      // Start from midnight and check every potential slot
      for (let minutes = 0; minutes < 24 * 60; minutes += duration) {
        const slotStart = new Date(selectedDate)
        slotStart.setHours(0, minutes, 0, 0)
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000)

        // Check if slot overlaps with any existing event
        let isBlocked = false

        for (const event of events) {
          const eventStart = new Date(event.start.dateTime || event.start.date)
          const eventEnd = new Date(event.end.dateTime || event.end.date)
          const eventSchoolId = event.extendedProperties?.private?.schoolId

          // Check for direct overlap
          if (slotStart < eventEnd && slotEnd > eventStart) {
            isBlocked = true
            break
          }

          // Check if drive time buffer is needed BEFORE this slot
          const driveTimeBeforeSlot = getDriveTimeBuffer(eventSchoolId, schoolId)
          if (driveTimeBeforeSlot > 0) {
            // Add buffer after the previous event
            const bufferEnd = new Date(eventEnd.getTime() + driveTimeBeforeSlot * 60 * 1000)
            if (slotStart < bufferEnd) {
              isBlocked = true
              break
            }
          }

          // Check if drive time buffer is needed AFTER this slot
          const driveTimeAfterSlot = getDriveTimeBuffer(schoolId, eventSchoolId)
          if (driveTimeAfterSlot > 0) {
            // Add buffer before the next event
            const bufferStart = new Date(eventStart.getTime() - driveTimeAfterSlot * 60 * 1000)
            if (slotEnd > bufferStart) {
              isBlocked = true
              break
            }
          }
        }

        // Only include slots that aren't blocked
        if (!isBlocked) {
          slots.push({
            time: slotStart.toISOString(),
            available: true
          })
        }
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

      try {
        const calendarEvent = await calendar.events.insert({
          calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
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
        // Continue without calendar event if it fails
      }
    }

    bookings.push(booking)

    console.log(`✓ New booking created: ${name} - ${new Date(time).toLocaleString()} (${sessionDuration || 60} min)${schoolId ? ` at school: ${schoolId}` : ''}`)

    res.status(201).json({
      success: true,
      booking: {
        id: booking.id,
        meetLink: booking.meetLink
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
  res.json({
    connected: calendar !== null,
    hasStoredTokens: hasTokens(),
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

  if (!calendar) {
    console.log('\n⚙️  Setup Google Calendar:')
    console.log(`   Visit: http://localhost:${PORT}/admin`)
    console.log('   Or configure manually in .env file\n')
  } else {
    console.log(`\n⚙️  Admin Panel: http://localhost:${PORT}/admin\n`)
  }
})
