import React, { useState, useEffect, useMemo } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import './App.css'
import { format, addDays, isBefore, startOfDay, getDay } from 'date-fns'
import config from './config'
import { applyTheme, applyFont } from './theme'

const CUSTOM_LOCATION_VALUE = '__CUSTOM__'

// Fallback meeting types used while /api/meeting-types loads (mirrors config.js values)
const DEFAULT_MEETING_TYPES = [
  {
    id: 'phone-call',
    label: config.meetingTypes.phoneCall.label,
    description: config.meetingTypes.phoneCall.description,
    icon: config.meetingTypes.phoneCall.icon,
    enabled: config.meetingTypes.phoneCall.enabled,
    order: 0,
    sessionDuration: config.phoneCall.sessionDuration,
    availability: config.phoneCall.availability,
    isBuiltin: true,
    requiresSchool: false
  },
  {
    id: 'google-meet',
    label: config.meetingTypes.googleMeet.label,
    description: config.meetingTypes.googleMeet.description,
    icon: config.meetingTypes.googleMeet.icon,
    enabled: config.meetingTypes.googleMeet.enabled,
    order: 1,
    sessionDuration: config.googleMeet.sessionDuration,
    availability: config.googleMeet.availability,
    isBuiltin: true,
    requiresSchool: false
  },
  {
    id: 'physical',
    label: config.meetingTypes.physical.label,
    description: config.meetingTypes.physical.description,
    icon: config.meetingTypes.physical.icon,
    enabled: config.meetingTypes.physical.enabled,
    order: 2,
    sessionDuration: null,
    availability: null,
    isBuiltin: true,
    requiresSchool: true
  }
]

function App() {
  const isEmbed = useMemo(() => new URLSearchParams(window.location.search).get('embed') === '1', [])
  useEffect(() => {
    if (isEmbed) document.body.classList.add('embed-mode')
    return () => document.body.classList.remove('embed-mode')
  }, [isEmbed])

  const [step, setStep] = useState(1)
  const [schools, setSchools] = useState([])
  const [meetingTypes, setMeetingTypes] = useState(DEFAULT_MEETING_TYPES)
  const [siteConfig, setSiteConfig] = useState({
    businessName: config.businessName,
    businessDescription: config.businessDescription,
    customLocationDuration: config.locationOptions.customLocationSessionDuration,
    googleMeetSlotInterval: 0
  })

  // Fetch schools, logo, meeting types, and public config on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/schools').then(r => r.json()).catch(() => null),
      fetch('/api/logo').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/meeting-types').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/config').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([schools, logo, types, cfg]) => {
      if (Array.isArray(schools) && schools.length > 0) setSchools(schools)
      else setSchools(config.schools)

      if (logo?.dataUrl) setLogoUrl(logo.dataUrl)

      if (Array.isArray(types) && types.length > 0) setMeetingTypes(types)

      if (cfg) {
        if (cfg.themeColor) applyTheme(cfg.themeColor)
        applyFont(cfg.fontFamily || '')
        setSiteConfig({
          businessName: cfg.businessName || config.businessName,
          businessDescription: cfg.businessDescription || config.businessDescription,
          customLocationDuration: cfg.customLocationDuration || config.locationOptions.customLocationSessionDuration,
          googleMeetSlotInterval: cfg.googleMeetSlotInterval || 0
        })
      }
    })
  }, [])

  const [bookingData, setBookingData] = useState({
    date: null,
    time: null,
    meetingType: null,
    schoolId: '',
    customLocation: '',
    sessionDuration: null,
    name: '',
    email: '',
    phone: '',
    notes: ''
  })
  const [availableSlots, setAvailableSlots] = useState([])
  const [availableDates, setAvailableDates] = useState(new Set())
  const [loadingDays, setLoadingDays] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [isBooked, setIsBooked] = useState(false)
  const [bookingResult, setBookingResult] = useState(null)
  const [isCustomLocation, setIsCustomLocation] = useState(false)
  const [selectedSchool, setSelectedSchool] = useState(null)
  const [logoUrl, setLogoUrl] = useState(null)

  // Look up a meeting type by id
  const getMeetingType = (id) => meetingTypes.find(t => t.id === id)

  // Fetch available days for a month
  const fetchAvailableDays = async (month, year, school, meetingType, isCustom) => {
    let schoolId = ''
    let sessionDuration = 60
    let availabilityBlocks = null

    const mt = getMeetingType(meetingType)
    let slotInterval = 0
    if (mt && !mt.requiresSchool) {
      schoolId = ''
      sessionDuration = mt.sessionDuration
      availabilityBlocks = mt.availability
      slotInterval = siteConfig.googleMeetSlotInterval || 0
    } else if (isCustom) {
      schoolId = 'custom'
      sessionDuration = siteConfig.customLocationDuration
      availabilityBlocks = config.locationOptions.customLocationAvailability
    } else if (school) {
      schoolId = school.id
      sessionDuration = school.sessionDuration
      availabilityBlocks = school.availability
      slotInterval = school.slotInterval || 0
    } else {
      setAvailableDates(new Set())
      return
    }

    setLoadingDays(true)
    try {
      const res = await fetch('/api/availability/days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, schoolId, sessionDuration, availabilityBlocks, slotInterval })
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

  // Refresh available days when location/type selection changes
  useEffect(() => {
    const mt = getMeetingType(bookingData.meetingType)
    if ((mt && !mt.requiresSchool) || selectedSchool || isCustomLocation) {
      const now = new Date()
      fetchAvailableDays(now.getMonth(), now.getFullYear(), selectedSchool, bookingData.meetingType, isCustomLocation)
    } else {
      setAvailableDates(new Set())
    }
  }, [selectedSchool, isCustomLocation, bookingData.meetingType])

  // Regenerate time slots when date or location changes
  useEffect(() => {
    const mt = getMeetingType(bookingData.meetingType)
    if (bookingData.date && ((mt && !mt.requiresSchool) || selectedSchool || isCustomLocation)) {
      generateTimeSlots(bookingData.date)
    }
  }, [bookingData.date, selectedSchool, isCustomLocation, bookingData.meetingType])

  // Generate time slots — delegates to the backend
  const generateTimeSlots = async (date) => {
    const dayOfWeek = getDay(date)

    let availability = []
    let sessionDuration = 60
    let schoolId = ''

    const mt = getMeetingType(bookingData.meetingType)
    let slotInterval = 0
    if (mt && !mt.requiresSchool) {
      availability = (mt.availability || {})[dayOfWeek] || []
      sessionDuration = mt.sessionDuration
      schoolId = ''
      slotInterval = siteConfig.googleMeetSlotInterval || 0
    } else if (isCustomLocation) {
      availability = config.locationOptions.customLocationAvailability[dayOfWeek] || []
      sessionDuration = siteConfig.customLocationDuration
      schoolId = 'custom'
    } else if (selectedSchool) {
      availability = selectedSchool.availability[dayOfWeek] || []
      sessionDuration = selectedSchool.sessionDuration
      schoolId = selectedSchool.id
      slotInterval = selectedSchool.slotInterval || 0
    }

    if (availability.length === 0) {
      setAvailableSlots([])
      return
    }

    setLoadingSlots(true)
    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: date.toISOString(), schoolId, sessionDuration, availabilityBlocks: availability, slotInterval })
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
    } finally {
      setLoadingSlots(false)
    }
  }

  // Check if a calendar date should be disabled
  const isDateDisabled = (date) => {
    if (isBefore(startOfDay(date), startOfDay(new Date()))) return true

    if (availableDates.size > 0) {
      return !availableDates.has(format(date, 'yyyy-MM-dd'))
    }

    // Fallback while server data loads
    const dayOfWeek = getDay(date)
    const mt = getMeetingType(bookingData.meetingType)
    let blocks = []
    if (mt && !mt.requiresSchool) {
      blocks = (mt.availability || {})[dayOfWeek] || []
    } else if (isCustomLocation) {
      blocks = (config.locationOptions.customLocationAvailability || {})[dayOfWeek] || []
    } else if (selectedSchool) {
      blocks = selectedSchool.availability[dayOfWeek] || []
    }
    return blocks.length === 0
  }

  const handleMonthChange = (date) => {
    fetchAvailableDays(date.getMonth(), date.getFullYear(), selectedSchool, bookingData.meetingType, isCustomLocation)
  }

  const handleNext = () => setStep(step + 1)
  const handleBack = () => setStep(step - 1)
  const handleDateSelect = (date) => setBookingData({ ...bookingData, date, time: null })
  const handleTimeSelect = (time) => setBookingData({ ...bookingData, time })

  const handleMeetingTypeSelect = (type) => {
    const mt = getMeetingType(type)
    setBookingData({
      ...bookingData,
      meetingType: type,
      schoolId: '',
      customLocation: '',
      date: null,
      time: null,
      sessionDuration: mt?.sessionDuration || null
    })
    setSelectedSchool(null)
    setIsCustomLocation(false)
    // Types that don't require school selection advance straight to date/time
    if (!mt?.requiresSchool) setStep(s => s + 1)
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
        sessionDuration: siteConfig.customLocationDuration
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
      setStep(s => s + 1)
    }
  }

  const handleCustomLocationChange = (e) => setBookingData({ ...bookingData, customLocation: e.target.value })
  const handleInputChange = (e) => {
    const { name, value } = e.target
    setBookingData({ ...bookingData, [name]: value })
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setBookingError('')
    try {
      const mt = getMeetingType(bookingData.meetingType)
      const finalBookingData = {
        ...bookingData,
        location: isCustomLocation
          ? bookingData.customLocation
          : selectedSchool
            ? `${selectedSchool.name} - ${selectedSchool.address}`
            : mt?.label || bookingData.meetingType
      }
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalBookingData)
      })
      const data = await response.json()
      if (response.ok) {
        setBookingResult(data)
        setIsBooked(true)
      } else {
        setBookingError(data.error || 'Failed to book appointment. Please try again.')
      }
    } catch (error) {
      console.error('Booking error:', error)
      setBookingError('A network error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const canProceedFromStep1 = bookingData.date && bookingData.time
  const selectedMeetingType = getMeetingType(bookingData.meetingType)
  const canProceedFromStep2 = bookingData.meetingType && (
    !selectedMeetingType?.requiresSchool ||
    (bookingData.schoolId && (bookingData.schoolId !== CUSTOM_LOCATION_VALUE || bookingData.customLocation.trim()))
  )
  const canSubmit = bookingData.name && bookingData.email

  const getFinalLocation = () => {
    const mt = getMeetingType(bookingData.meetingType)
    if (mt && !mt.requiresSchool) {
      return mt.id === 'google-meet'
        ? `${mt.label} (link will be sent)`
        : mt.label
    }
    if (isCustomLocation) return bookingData.customLocation
    if (selectedSchool) return `${selectedSchool.name} - ${selectedSchool.address}`
    return ''
  }

  const getSessionDurationDisplay = () => {
    if (!bookingData.sessionDuration) return ''
    return `${bookingData.sessionDuration} minutes`
  }

  if (isBooked) {
    const meetLink = bookingResult?.meetLink
    const calendarWarning = bookingResult?.calendarWarning

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
                  {getMeetingType(bookingData.meetingType)?.label || bookingData.meetingType}
                </span>
              </div>
              {selectedMeetingType?.requiresSchool && (
                <div className="summary-item">
                  <span className="summary-label">Location:</span>
                  <span className="summary-value">{getFinalLocation()}</span>
                </div>
              )}
              {meetLink && (
                <div className="summary-item">
                  <span className="summary-label">Meet Link:</span>
                  <span className="summary-value">
                    <a href={meetLink} target="_blank" rel="noopener noreferrer">{meetLink}</a>
                  </span>
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

            {calendarWarning && (
              <p style={{ marginTop: '1rem', color: '#b45309', fontSize: '0.875rem' }}>
                Note: your booking was saved but could not be added to Google Calendar. Please contact us to confirm.
              </p>
            )}

            <p style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              A confirmation has been sent to {bookingData.email}.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="header">
        {logoUrl && <img src={logoUrl} alt={siteConfig.businessName} className="business-logo" />}
        <h1>{siteConfig.businessName}</h1>
        <p>{siteConfig.businessDescription}</p>
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
              {meetingTypes.map(mt => (
                <div
                  key={mt.id}
                  className={`meeting-option ${bookingData.meetingType === mt.id ? 'selected' : ''}`}
                  onClick={() => handleMeetingTypeSelect(mt.id)}
                >
                  <div className="meeting-option-icon">{mt.icon}</div>
                  <div className="meeting-option-content">
                    <h3>{mt.label}</h3>
                    <p>{mt.description}</p>
                    {mt.sessionDuration && (
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                        Session length: {mt.sessionDuration} minutes
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selectedMeetingType?.requiresSchool && (
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
                      <div className="school-tile-duration">{siteConfig.customLocationDuration} min</div>
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
                <button className="btn btn-primary" onClick={handleNext} disabled={!canProceedFromStep2}>
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
              <div style={{ background: 'var(--bg-light)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
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
                ) : loadingSlots ? (
                  <p style={{ color: 'var(--text-secondary)' }}>Loading available times…</p>
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
              <button className="btn btn-secondary" onClick={handleBack}>Back</button>
              <button className="btn btn-primary" onClick={handleNext} disabled={!canProceedFromStep1}>
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
                <span className="summary-value">{getFinalLocation()}</span>
              </div>
            </div>

            <div className="form-group">
              <label>Full Name *</label>
              <input type="text" name="name" value={bookingData.name} onChange={handleInputChange} placeholder="John Doe" required />
            </div>

            <div className="form-group">
              <label>Email Address *</label>
              <input type="email" name="email" value={bookingData.email} onChange={handleInputChange} placeholder="john@example.com" required />
            </div>

            <div className="form-group">
              <label>Phone Number (Optional)</label>
              <input type="tel" name="phone" value={bookingData.phone} onChange={handleInputChange} placeholder="+1 (555) 123-4567" />
            </div>

            <div className="form-group">
              <label>Additional Notes (Optional)</label>
              <textarea name="notes" value={bookingData.notes} onChange={handleInputChange} rows="4"
                placeholder="Any specific topics you'd like to cover or questions you have..." />
            </div>

            {bookingError && (
              <div className="booking-error-message">{bookingError}</div>
            )}

            <div className="button-group">
              <button className="btn btn-secondary" onClick={handleBack}>Back</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
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
