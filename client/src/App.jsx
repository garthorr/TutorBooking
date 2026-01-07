import React, { useState, useEffect } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { format, addDays, setHours, setMinutes, isWeekend, isBefore, startOfDay } from 'date-fns'

const PHYSICAL_LOCATIONS = [
  'Main Office - 123 Main St, Suite 100',
  'Downtown Branch - 456 Center Ave',
  'University Campus - Building A, Room 201',
  'Community Center - 789 Park Road'
]

function App() {
  const [step, setStep] = useState(1)
  const [bookingData, setBookingData] = useState({
    date: null,
    time: null,
    meetingType: null, // 'google-meet' or 'physical'
    location: '',
    name: '',
    email: '',
    phone: '',
    notes: ''
  })
  const [availableSlots, setAvailableSlots] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isBooked, setIsBooked] = useState(false)

  // Generate time slots when date is selected
  useEffect(() => {
    if (bookingData.date) {
      generateTimeSlots(bookingData.date)
    }
  }, [bookingData.date])

  const generateTimeSlots = (date) => {
    const slots = []
    const startHour = 9 // 9 AM
    const endHour = 17 // 5 PM
    const slotDuration = 60 // 60 minutes

    for (let hour = startHour; hour < endHour; hour++) {
      const slotTime = setMinutes(setHours(date, hour), 0)
      slots.push({
        time: slotTime,
        available: true // This will be checked against Google Calendar later
      })
    }

    setAvailableSlots(slots)
  }

  const isDateDisabled = (date) => {
    // Disable weekends and past dates
    return isWeekend(date) || isBefore(startOfDay(date), startOfDay(new Date()))
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
      location: type === 'google-meet' ? '' : bookingData.location
    })
  }

  const handleLocationSelect = (location) => {
    setBookingData({ ...bookingData, location })
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setBookingData({ ...bookingData, [name]: value })
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bookingData)
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
    (bookingData.meetingType === 'google-meet' || bookingData.location)
  const canSubmit = bookingData.name && bookingData.email

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
                <span className="summary-label">Meeting Type:</span>
                <span className="summary-value">
                  {bookingData.meetingType === 'google-meet' ? 'Google Meet' : 'Physical Location'}
                </span>
              </div>
              {bookingData.meetingType === 'physical' && (
                <div className="summary-item">
                  <span className="summary-label">Location:</span>
                  <span className="summary-value">{bookingData.location}</span>
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
        <h1>Book a Session</h1>
        <p>Schedule your tutoring session in just a few steps</p>
      </div>

      <div className="booking-card">
        <div className="step-indicator">
          <div className={`step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}></div>
          <div className={`step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}></div>
          <div className={`step ${step >= 3 ? 'active' : ''} ${step > 3 ? 'completed' : ''}`}></div>
        </div>

        {step === 1 && (
          <div className="form-section">
            <h2>Select Date & Time</h2>

            <div className="form-group">
              <label>Choose a Date</label>
              <DatePicker
                selected={bookingData.date}
                onChange={handleDateSelect}
                filterDate={(date) => !isDateDisabled(date)}
                minDate={new Date()}
                maxDate={addDays(new Date(), 90)}
                inline
                calendarClassName="booking-calendar"
              />
            </div>

            {bookingData.date && (
              <div className="form-group">
                <label>Available Time Slots</label>
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
              </div>
            )}

            <div className="button-group">
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

        {step === 2 && (
          <div className="form-section">
            <h2>Choose Meeting Type</h2>

            <div className="meeting-options">
              <div
                className={`meeting-option ${bookingData.meetingType === 'google-meet' ? 'selected' : ''}`}
                onClick={() => handleMeetingTypeSelect('google-meet')}
              >
                <div className="meeting-option-icon">📹</div>
                <div className="meeting-option-content">
                  <h3>Google Meet</h3>
                  <p>Join remotely via video call. A Google Meet link will be generated and sent to you.</p>
                </div>
              </div>

              <div
                className={`meeting-option ${bookingData.meetingType === 'physical' ? 'selected' : ''}`}
                onClick={() => handleMeetingTypeSelect('physical')}
              >
                <div className="meeting-option-icon">📍</div>
                <div className="meeting-option-content">
                  <h3>Physical Location</h3>
                  <p>Meet in person at one of our locations.</p>
                </div>
              </div>
            </div>

            {bookingData.meetingType === 'physical' && (
              <div className="form-group location-select">
                <label>Select Location</label>
                <select
                  value={bookingData.location}
                  onChange={(e) => handleLocationSelect(e.target.value)}
                >
                  <option value="">Choose a location...</option>
                  {PHYSICAL_LOCATIONS.map((location, index) => (
                    <option key={index} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="button-group">
              <button className="btn btn-secondary" onClick={handleBack}>
                Back
              </button>
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
                <span className="summary-label">Meeting Type:</span>
                <span className="summary-value">
                  {bookingData.meetingType === 'google-meet' ? 'Google Meet (link will be sent)' : bookingData.location}
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
