import React, { useState, useEffect } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import './App.css'
import { format, addDays, isBefore, startOfDay, getDay } from 'date-fns'
import config from './config'

const CUSTOM_LOCATION_VALUE = '__CUSTOM__'

function App() {
  const [step, setStep] = useState(1)
  const [schools, setSchools] = useState([])

  // Fetch schools, logo, and public config on mount
  useEffect(() => {
    fetch('/api/schools')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) setSchools(data)
        else setSchools(config.schools)
      })
      .catch(() => setSchools(config.schools))

    fetch('/api/logo')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.dataUrl) setLogoUrl(data.dataUrl) })
      .catch(() => {})

    fetch('/api/config')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.googleMeetDuration) setGoogleMeetDuration(data.googleMeetDuration) })
      .catch(() => {})
  }, [])

  const [bookingData, setBookingData] = useState({
    date: null,
    time: null,
    meetingType: null, // 'google-meet' or 'physical'
    schoolId: '', // ID of selected school
    customLocation: '',
    sessionDuration: null, // Will be set based on school/location
    name: '',
    email: '',
    phone: '',
    notes: ''
  })
  const [availableSlots, setAvailableSlots] = useState([])
  const [availableDates, setAvailableDates] = useState(new Set()) // 'YYYY-MM-DD' strings
  const [loadingDays, setLoadingDays] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isBooked, setIsBooked] = useState(false)
  const [isCustomLocation, setIsCustomLocation] = useState(false)
  const [selectedSchool, setSelectedSchool] = useState(null)
  const [logoUrl, setLogoUrl] = useState(null)
  const [googleMeetDuration, setGoogleMeetDuration] = useState(config.googleMeet.sessionDuration)

  // Fetch available days whenever school/meetingType changes or user navigates months
  const fetchAvailableDays = async (month, year, school, meetingType, isCustom) => {
    let schoolId = ''
    let sessionDuration = 60
    let availabilityBlocks = null

    if (meetingType === 'google-meet') {
      schoolId = ''
      sessionDuration = googleMeetDuration
      availabilityBlocks = config.googleMeet.availability
    } else if (isCustom) {
      schoolId = 'custom'
      sessionDuration = config.locationOptions.customLocationSessionDuration
      availabilityBlocks = config.locationOptions.customLocationAvailability
    } else if (school) {
      schoolId = school.id
      sessionDuration = school.sessionDuration
      availabilityBlocks = school.availability
    } else {
      setAvailableDates(new Set())
      return
    }

    setLoadingDays(true)
    try {
      const res = await fetch('/api/availability/days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, schoolId, sessionDuration, availabilityBlocks })
      })
      if (res.ok) {
        const data = await res.json()
        setAvailableDates(new Set(data.availableDates))
      }
    } catch (err) {
      console.error('Error fetching available days:', err)
    } finally {
      setLoadingDays(false)
    }
  }

  // Refresh available days when location selection changes
  useEffect(() => {
    if (bookingData.meetingType === 'google-meet' || selectedSchool || isCustomLocation) {
      const now = new Date()
      fetchAvailableDays(now.getMonth(), now.getFullYear(), selectedSchool, bookingData.meetingType, isCustomLocation)
    } else {
      setAvailableDates(new Set())
    }
  }, [selectedSchool, isCustomLocation, bookingData.meetingType])

  // Regenerate time slots when date or location changes
  useEffect(() => {
    if (bookingData.date && (bookingData.meetingType === 'google-meet' || selectedSchool || isCustomLocation)) {
      generateTimeSlots(bookingData.date)
    }
  }, [bookingData.date, selectedSchool, isCustomLocation, bookingData.meetingType])

  // Generate time slots — delegates entirely to the backend
  const generateTimeSlots = async (date) => {
    const dayOfWeek = getDay(date) // 0 = Sunday, 1 = Monday, etc.

    let availability = []
    let sessionDuration = 60 // default
    let schoolId = ''

    // Determine which availability schedule to use
    if (bookingData.meetingType === 'google-meet') {
      availability = config.googleMeet.availability[dayOfWeek] || []
      sessionDuration = googleMeetDuration
      schoolId = '' // No schoolId for Google Meet
    } else if (isCustomLocation) {
      availability = config.locationOptions.customLocationAvailability[dayOfWeek] || []
      sessionDuration = config.locationOptions.customLocationSessionDuration
      schoolId = 'custom' // Use 'custom' as schoolId
    } else if (selectedSchool) {
      availability = selectedSchool.availability[dayOfWeek] || []
      sessionDuration = selectedSchool.sessionDuration
      schoolId = selectedSchool.id
    }

    // If no availability for this day, return empty
    if (availability.length === 0) {
      setAvailableSlots([])
      return
    }

    // Ask the server for available slots — it handles calendar conflicts, drive time
    // buffers, and generates timestamps in the configured timezone (America/Chicago).
    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: date.toISOString(),
          schoolId,
          sessionDuration,
          availabilityBlocks: availability
        })
      })

      if (response.ok) {
        const data = await response.json()
        setAvailableSlots(data.slots.map(slot => ({ time: new Date(slot.time), available: true, blockName: slot.blockName || null })))
      } else {
        setAvailableSlots([])
      }
    } catch (error) {
      console.error('Error fetching availability:', error)
      setAvailableSlots([])
    }
  }

  // Check if a date should be disabled in the calendar
  const isDateDisabled = (date) => {
    if (isBefore(startOfDay(date), startOfDay(new Date()))) return true

    // If we have server-verified available dates, use those
    if (availableDates.size > 0) {
      const key = format(date, 'yyyy-MM-dd')
      return !availableDates.has(key)
    }

    // Fallback: use local availability blocks while server data loads
    const dayOfWeek = getDay(date)
    let blocks = []
    if (bookingData.meetingType === 'google-meet') {
      blocks = config.googleMeet.availability[dayOfWeek] || []
    } else if (isCustomLocation) {
      blocks = config.locationOptions.customLocationAvailability[dayOfWeek] || []
    } else if (selectedSchool) {
      blocks = selectedSchool.availability[dayOfWeek] || []
    }
    return blocks.length === 0
  }

  // Called by DatePicker when user navigates to a different month
  const handleMonthChange = (date) => {
    fetchAvailableDays(date.getMonth(), date.getFullYear(), selectedSchool, bookingData.meetingType, isCustomLocation)
  }

  const handleNext = () => {
    setStep(step + 1)
  }

  const handleBack = () => {
    setStep(step - 1)
  }

  const handleDateSelect = (date) => {
    setBookingData({ ...bookingData, date, time: null })
  }

  const handleTimeSelect = (time) => {
    setBookingData({ ...bookingData, time })
  }

  const handleMeetingTypeSelect = (type) => {
    setBookingData({
      ...bookingData,
      meetingType: type,
      schoolId: '',
      customLocation: '',
      date: null,
      time: null,
      sessionDuration: type === 'google-meet' ? googleMeetDuration : null
    })
    setSelectedSchool(null)
    setIsCustomLocation(false)
    // Google Meet needs no school selection — go straight to date/time
    if (type === 'google-meet') setStep(s => s + 1)
  }

  const handleLocationSelect = (schoolId) => {
    if (schoolId === CUSTOM_LOCATION_VALUE) {
      setIsCustomLocation(true)
      setSelectedSchool(null)
      setBookingData({
        ...bookingData,
        schoolId: CUSTOM_LOCATION_VALUE,
        customLocation: '',
        date: null,
        time: null,
        sessionDuration: config.locationOptions.customLocationSessionDuration
      })
      // Stay on step 1 so the user can type their custom location
    } else {
      const school = schools.find(s => s.id === schoolId)
      setIsCustomLocation(false)
      setSelectedSchool(school)
      setBookingData({
        ...bookingData,
        schoolId,
        customLocation: '',
        date: null,
        time: null,
        sessionDuration: school?.sessionDuration || 60
      })
      // School chosen — go straight to date/time
      setStep(s => s + 1)
    }
  }

  const handleCustomLocationChange = (e) => {
    setBookingData({ ...bookingData, customLocation: e.target.value })
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setBookingData({ ...bookingData, [name]: value })
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)

    try {
      // Prepare booking data with final location
      const finalBookingData = {
        ...bookingData,
        location: isCustomLocation
          ? bookingData.customLocation
          : selectedSchool
            ? `${selectedSchool.name} - ${selectedSchool.address}`
            : 'Google Meet'
      }

      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(finalBookingData)
      })

      if (response.ok) {
        setIsBooked(true)
      } else {
        alert('Failed to book appointment. Please try again.')
      }
    } catch (error) {
      console.error('Booking error:', error)
      alert('An error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const canProceedFromStep1 = bookingData.date && bookingData.time
  const canProceedFromStep2 = bookingData.meetingType &&
    (bookingData.meetingType === 'google-meet' ||
     (bookingData.schoolId && (bookingData.schoolId !== CUSTOM_LOCATION_VALUE || bookingData.customLocation.trim())))
  const canSubmit = bookingData.name && bookingData.email

  // Get the final location for display
  const getFinalLocation = () => {
    if (bookingData.meetingType === 'google-meet') {
      return 'Google Meet (link will be sent)'
    }
    if (isCustomLocation) {
      return bookingData.customLocation
    }
    if (selectedSchool) {
      return `${selectedSchool.name} - ${selectedSchool.address}`
    }
    return ''
  }

  // Get session duration display
  const getSessionDurationDisplay = () => {
    if (!bookingData.sessionDuration) return ''
    return `${bookingData.sessionDuration} minutes`
  }

  if (isBooked) {
    return (
      <div className="container">
        <div className="booking-card">
          <div className="success-message">
            <div className="success-icon">✓</div>
            <h2>Booking Confirmed!</h2>
            <p>Your appointment has been successfully scheduled.</p>

            <div className="booking-summary">
              <div className="summary-item">
                <span className="summary-label">Date & Time:</span>
                <span className="summary-value">
                  {format(bookingData.date, 'MMMM d, yyyy')} at {format(bookingData.time, 'h:mm a')}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Session Length:</span>
                <span className="summary-value">{getSessionDurationDisplay()}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Meeting Type:</span>
                <span className="summary-value">
                  {bookingData.meetingType === 'google-meet' ? 'Google Meet' : 'Physical Location'}
                </span>
              </div>
              {bookingData.meetingType === 'physical' && (
                <div className="summary-item">
                  <span className="summary-label">Location:</span>
                  <span className="summary-value">{getFinalLocation()}</span>
                </div>
              )}
              <div className="summary-item">
                <span className="summary-label">Name:</span>
                <span className="summary-value">{bookingData.name}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Email:</span>
                <span className="summary-value">{bookingData.email}</span>
              </div>
            </div>

            <p style={{ marginTop: '1.5rem', color: 'var(--text-secondary)' }}>
              A confirmation email has been sent to {bookingData.email}
              {bookingData.meetingType === 'google-meet' && ' with the Google Meet link'}.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="header">
        {logoUrl && <img src={logoUrl} alt={config.businessName} className="business-logo" />}
        <h1>{config.businessName}</h1>
        <p>{config.businessDescription}</p>
      </div>

      <div className="booking-card">
        <div className="step-indicator">
          <div className={`step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}></div>
          <div className={`step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}></div>
          <div className={`step ${step >= 3 ? 'active' : ''} ${step > 3 ? 'completed' : ''}`}></div>
        </div>

        {step === 1 && (
          <div className="form-section">
            <h2>Choose Meeting Type</h2>

            <div className="meeting-options">
              {config.meetingTypes.googleMeet.enabled && (
                <div
                  className={`meeting-option ${bookingData.meetingType === 'google-meet' ? 'selected' : ''}`}
                  onClick={() => handleMeetingTypeSelect('google-meet')}
                >
                  <div className="meeting-option-icon">{config.meetingTypes.googleMeet.icon}</div>
                  <div className="meeting-option-content">
                    <h3>{config.meetingTypes.googleMeet.label}</h3>
                    <p>{config.meetingTypes.googleMeet.description}</p>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                      Session length: {googleMeetDuration} minutes
                    </p>
                  </div>
                </div>
              )}

              {config.meetingTypes.physical.enabled && (
                <div
                  className={`meeting-option ${bookingData.meetingType === 'physical' ? 'selected' : ''}`}
                  onClick={() => handleMeetingTypeSelect('physical')}
                >
                  <div className="meeting-option-icon">{config.meetingTypes.physical.icon}</div>
                  <div className="meeting-option-content">
                    <h3>{config.meetingTypes.physical.label}</h3>
                    <p>{config.meetingTypes.physical.description}</p>
                  </div>
                </div>
              )}
            </div>

            {bookingData.meetingType === 'physical' && (
              <div className="form-group location-select">
                <label>Select School</label>
                <div className="school-tiles">
                  {schools.map(school => (
                    <div
                      key={school.id}
                      className={`school-tile ${bookingData.schoolId === school.id ? 'selected' : ''}`}
                      onClick={() => handleLocationSelect(school.id)}
                    >
                      <div className="school-tile-logo">
                        {school.logoUrl
                          ? <img src={school.logoUrl} alt={school.name} />
                          : (
                            <svg className="school-tile-logo-placeholder" width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <circle cx="24" cy="24" r="24" fill="#e5e7eb"/>
                              <text x="24" y="32" textAnchor="middle" fontSize="22" fontWeight="700" fill="#6b7280" fontFamily="system-ui, -apple-system, sans-serif">
                                {school.name.charAt(0).toUpperCase()}
                              </text>
                            </svg>
                          )
                        }
                      </div>
                      <div className="school-tile-name">{school.name}</div>
                      <div className="school-tile-duration">{school.sessionDuration} min</div>
                    </div>
                  ))}
                  {config.locationOptions.allowCustomLocation && (
                    <div
                      className={`school-tile school-tile-custom ${isCustomLocation ? 'selected' : ''}`}
                      onClick={() => handleLocationSelect(CUSTOM_LOCATION_VALUE)}
                    >
                      <div className="school-tile-logo">
                        <div className="school-tile-logo-placeholder">✏️</div>
                      </div>
                      <div className="school-tile-name">Other Location</div>
                      <div className="school-tile-duration">{config.locationOptions.customLocationSessionDuration} min</div>
                    </div>
                  )}
                </div>

                {isCustomLocation && (
                  <div style={{ marginTop: '1rem' }}>
                    <input
                      type="text"
                      value={bookingData.customLocation}
                      onChange={handleCustomLocationChange}
                      placeholder={config.locationOptions.customLocationPlaceholder}
                      style={{ width: '100%' }}
                    />
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                      {config.locationOptions.customLocationHelp}
                    </p>
                  </div>
                )}
              </div>
            )}

            {isCustomLocation && (
              <div className="button-group">
                <button
                  className="btn btn-primary"
                  onClick={handleNext}
                  disabled={!canProceedFromStep2}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="form-section">
            <h2>Select Date & Time</h2>

            {selectedSchool && (
              <div style={{
                background: 'var(--bg-light)',
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1.5rem'
              }}>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>
                  <strong>{selectedSchool.name}</strong>
                  <br />
                  Session length: {selectedSchool.sessionDuration} minutes
                </p>
              </div>
            )}

            <div className="date-time-layout">
              <div className="form-group date-time-calendar">
                <label>Choose a Date</label>
                {loadingDays && (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    Checking availability…
                  </p>
                )}
                <DatePicker
                  selected={bookingData.date}
                  onChange={handleDateSelect}
                  onMonthChange={handleMonthChange}
                  filterDate={(date) => !isDateDisabled(date)}
                  minDate={new Date()}
                  maxDate={addDays(new Date(), config.booking.advanceBookingDays)}
                  inline
                  calendarClassName="booking-calendar"
                />
              </div>

              <div className="form-group date-time-slots">
                <label>Available Time Slots</label>
                {!bookingData.date ? (
                  <p style={{ color: 'var(--text-secondary)' }}>
                    Select a date to see available times.
                  </p>
                ) : availableSlots.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)' }}>
                    No available time slots on this date. Please select another date.
                  </p>
                ) : (
                  <div className="time-slots">
                    {availableSlots.map((slot, index) => (
                      <button
                        key={index}
                        className={`time-slot ${bookingData.time && bookingData.time.getTime() === slot.time.getTime() ? 'selected' : ''} ${!slot.available ? 'disabled' : ''}`}
                        onClick={() => slot.available && handleTimeSelect(slot.time)}
                        disabled={!slot.available}
                      >
                        <span className="slot-time">{format(slot.time, 'h:mm a')}</span>
                        {slot.blockName && <span className="slot-block-name">{slot.blockName}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="button-group">
              <button className="btn btn-secondary" onClick={handleBack}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleNext}
                disabled={!canProceedFromStep1}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="form-section">
            <h2>Your Information</h2>

            <div className="booking-summary">
              <div className="summary-item">
                <span className="summary-label">Date & Time:</span>
                <span className="summary-value">
                  {format(bookingData.date, 'MMMM d, yyyy')} at {format(bookingData.time, 'h:mm a')}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Session Length:</span>
                <span className="summary-value">{getSessionDurationDisplay()}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Location:</span>
                <span className="summary-value">
                  {getFinalLocation()}
                </span>
              </div>
            </div>

            <div className="form-group">
              <label>Full Name *</label>
              <input
                type="text"
                name="name"
                value={bookingData.name}
                onChange={handleInputChange}
                placeholder="John Doe"
                required
              />
            </div>

            <div className="form-group">
              <label>Email Address *</label>
              <input
                type="email"
                name="email"
                value={bookingData.email}
                onChange={handleInputChange}
                placeholder="john@example.com"
                required
              />
            </div>

            <div className="form-group">
              <label>Phone Number (Optional)</label>
              <input
                type="tel"
                name="phone"
                value={bookingData.phone}
                onChange={handleInputChange}
                placeholder="+1 (555) 123-4567"
              />
            </div>

            <div className="form-group">
              <label>Additional Notes (Optional)</label>
              <textarea
                name="notes"
                value={bookingData.notes}
                onChange={handleInputChange}
                rows="4"
                placeholder="Any specific topics you'd like to cover or questions you have..."
              />
            </div>

            <div className="button-group">
              <button className="btn btn-secondary" onClick={handleBack}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting ? 'Booking...' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
