import React, { useState, useEffect } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { format, addDays, isBefore, startOfDay, getDay } from 'date-fns'
import config from './config'

const CUSTOM_LOCATION_VALUE = '__CUSTOM__'

function App() {
  const [step, setStep] = useState(1)
  const [schools, setSchools] = useState([])

  // Fetch schools from API on mount
  useEffect(() => {
    fetch('/api/schools')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) setSchools(data)
        else setSchools(config.schools) // fall back to config.js
      })
      .catch(() => setSchools(config.schools))
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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isBooked, setIsBooked] = useState(false)
  const [isCustomLocation, setIsCustomLocation] = useState(false)
  const [selectedSchool, setSelectedSchool] = useState(null)

  // Regenerate time slots when date or location changes
  useEffect(() => {
    if (bookingData.date && (bookingData.meetingType === 'google-meet' || selectedSchool || isCustomLocation)) {
      generateTimeSlots(bookingData.date)
    }
  }, [bookingData.date, selectedSchool, isCustomLocation, bookingData.meetingType])

  // Parse time string (HH:MM) to hours and minutes
  const parseTime = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number)
    return { hours, minutes }
  }

  // Generate time slots with drive time consideration
  const generateTimeSlots = async (date) => {
    const dayOfWeek = getDay(date) // 0 = Sunday, 1 = Monday, etc.

    let availability = []
    let sessionDuration = 60 // default
    let schoolId = ''

    // Determine which availability schedule to use
    if (bookingData.meetingType === 'google-meet') {
      availability = config.googleMeet.availability[dayOfWeek] || []
      sessionDuration = config.googleMeet.sessionDuration
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

    // First generate potential slots based on availability blocks
    const potentialSlots = []
    availability.forEach(block => {
      const startTime = parseTime(block.start)
      const endTime = parseTime(block.end)

      // Create a date object for the start time
      let currentSlot = new Date(date)
      currentSlot.setHours(startTime.hours, startTime.minutes, 0, 0)

      const endDate = new Date(date)
      endDate.setHours(endTime.hours, endTime.minutes, 0, 0)

      // Generate slots within this block
      while (currentSlot < endDate) {
        // Check if there's enough time for a full session
        const sessionEnd = new Date(currentSlot.getTime() + sessionDuration * 60000)
        if (sessionEnd <= endDate) {
          potentialSlots.push(new Date(currentSlot))
        }

        // Move to next slot
        currentSlot = new Date(currentSlot.getTime() + sessionDuration * 60000)
      }
    })

    // Call backend API to check availability with drive time consideration
    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          date: date.toISOString(),
          schoolId,
          sessionDuration
        })
      })

      if (response.ok) {
        const data = await response.json()
        const availableSlotTimes = new Set(data.slots.map(slot => new Date(slot.time).getTime()))

        // Filter potential slots to only those that are available (considering drive time)
        const finalSlots = potentialSlots
          .filter(slot => availableSlotTimes.has(slot.getTime()))
          .map(slot => ({
            time: slot,
            available: true
          }))

        setAvailableSlots(finalSlots)
      } else {
        // Fallback to showing all potential slots if API fails
        setAvailableSlots(potentialSlots.map(slot => ({ time: slot, available: true })))
      }
    } catch (error) {
      console.error('Error fetching availability:', error)
      // Fallback to showing all potential slots if API fails
      setAvailableSlots(potentialSlots.map(slot => ({ time: slot, available: true })))
    }
  }

  // Check if a date should be disabled
  const isDateDisabled = (date) => {
    // Disable past dates
    const isPastDate = isBefore(startOfDay(date), startOfDay(new Date()))
    if (isPastDate) return true

    // Check if the selected location has availability on this day
    const dayOfWeek = getDay(date)

    let availability = []
    if (bookingData.meetingType === 'google-meet') {
      availability = config.googleMeet.availability[dayOfWeek] || []
    } else if (isCustomLocation) {
      availability = config.locationOptions.customLocationAvailability[dayOfWeek] || []
    } else if (selectedSchool) {
      availability = selectedSchool.availability[dayOfWeek] || []
    }

    // Disable if no availability on this day
    return availability.length === 0
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
      sessionDuration: type === 'google-meet' ? config.googleMeet.sessionDuration : null
    })
    setSelectedSchool(null)
    setIsCustomLocation(false)
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
                      Session length: {config.googleMeet.sessionDuration} minutes
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
                <select
                  value={bookingData.schoolId}
                  onChange={(e) => handleLocationSelect(e.target.value)}
                >
                  <option value="">Choose a school...</option>
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name} ({school.sessionDuration} min sessions)
                    </option>
                  ))}
                  {config.locationOptions.allowCustomLocation && (
                    <option value={CUSTOM_LOCATION_VALUE}>✏️ Enter Custom Location</option>
                  )}
                </select>

                {isCustomLocation && (
                  <div style={{ marginTop: '1rem' }}>
                    <input
                      type="text"
                      value={bookingData.customLocation}
                      onChange={handleCustomLocationChange}
                      placeholder={config.locationOptions.customLocationPlaceholder}
                      style={{ width: '100%' }}
                    />
                    <p style={{
                      fontSize: '0.875rem',
                      color: 'var(--text-secondary)',
                      marginTop: '0.5rem'
                    }}>
                      {config.locationOptions.customLocationHelp}
                      <br />
                      Session length: {config.locationOptions.customLocationSessionDuration} minutes
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="button-group">
              <button
                className="btn btn-primary"
                onClick={handleNext}
                disabled={!canProceedFromStep2}
              >
                Next
              </button>
            </div>
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

            <div className="form-group">
              <label>Choose a Date</label>
              <DatePicker
                selected={bookingData.date}
                onChange={handleDateSelect}
                filterDate={(date) => !isDateDisabled(date)}
                minDate={new Date()}
                maxDate={addDays(new Date(), config.booking.advanceBookingDays)}
                inline
                calendarClassName="booking-calendar"
              />
            </div>

            {bookingData.date && (
              <div className="form-group">
                <label>Available Time Slots</label>
                {availableSlots.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', padding: '1rem' }}>
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
                        {format(slot.time, 'h:mm a')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

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
