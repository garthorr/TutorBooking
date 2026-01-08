import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { google } from 'googleapis'
import path from 'path'
import { fileURLToPath } from 'url'

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
    console.log('⚠️  Google Calendar not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env')
    return null
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/oauth2callback'
    )

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    })

    return google.calendar({ version: 'v3', auth: oauth2Client })
  } catch (error) {
    console.error('Error initializing Google Calendar:', error.message)
    return null
  }
}

calendar = initializeGoogleCalendar()

// API Routes

// Get available time slots
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
    const { date, time, meetingType, location, name, email, phone, notes, sessionDuration } = req.body

    const booking = {
      id: Date.now().toString(),
      date,
      time,
      meetingType,
      location,
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
          timeZone: process.env.TIMEZONE || 'America/New_York'
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: process.env.TIMEZONE || 'America/New_York'
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

    console.log(`✓ New booking created: ${name} - ${new Date(time).toLocaleString()} (${sessionDuration || 60} min)`)

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    googleCalendarConnected: calendar !== null,
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
  console.log('\nTo configure Google Calendar:')
  console.log('1. Create a project in Google Cloud Console')
  console.log('2. Enable Google Calendar API')
  console.log('3. Create OAuth 2.0 credentials')
  console.log('4. Add credentials to .env file\n')
})
