import React, { useState, useEffect, useRef } from 'react'
import { format, addDays, isBefore, startOfDay, getDay } from 'date-fns'
import './App.css'
import config from './config'
import { applyTheme } from './theme'

/* ── Lucide-style outline icons ─────────────────────────────────────────── */
const Icon = {
  Calendar: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  ),
  Video: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
    </svg>
  ),
  Phone: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
    </svg>
  ),
  School: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="M6 10.5V16c2 1.5 4 2.5 6 2.5s4-1 6-2.5v-5.5"/><path d="M2 8v6"/>
    </svg>
  ),
  MapPin: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  Check: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  ArrowR: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  ArrowL: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  ),
  ChevL: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  ChevR: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
}

function MeetingIcon({ id, style }) {
  const map = { 'phone-call': Icon.Phone, 'google-meet': Icon.Video, 'physical': Icon.School }
  const C = map[id] || Icon.Calendar
  return <C style={{ width: 22, height: 22, ...style }} />
}

/* ── Step indicator ─────────────────────────────────────────────────────── */
function StepIndicator({ step }) {
  const STEPS = ['Meeting', 'Date & time', 'Your info']
  return (
    <div className="step-indicator" aria-label="Booking progress">
      {STEPS.map((s, i) => {
        const idx = i + 1
        const state = idx < step ? 'done' : idx === step ? 'current' : 'todo'
        return (
          <React.Fragment key={s}>
            <div className={`step-pill ${state}`}>
              <div className="step-num">
                {state === 'done' ? <Icon.Check style={{ width: 14, height: 14 }} /> : idx}
              </div>
              <div className="step-name">{s}</div>
            </div>
            {idx < STEPS.length && <div className={`step-line ${state === 'done' ? 'done' : ''}`} />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/* ── Mini calendar ──────────────────────────────────────────────────────── */
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function MiniCalendar({ value, onChange, isDateDisabled, onMonthChange, today = new Date(), maxAdvanceDays = 90, loading = false }) {
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }))
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    onMonthChange?.(new Date(view.year, view.month, 1))
  }, [view.year, view.month])

  const firstOfMonth = new Date(view.year, view.month, 1)
  const startPad = firstOfMonth.getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const maxDate = new Date(today)
  maxDate.setDate(today.getDate() + maxAdvanceDays)

  const canGoPrev = (view.year > today.getFullYear()) || (view.year === today.getFullYear() && view.month > today.getMonth())
  const lastAllowed = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)
  const canGoNext = (view.year < lastAllowed.getFullYear()) || (view.year === lastAllowed.getFullYear() && view.month < lastAllowed.getMonth())

  const prev = () => canGoPrev && setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 })
  const next = () => canGoNext && setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 })

  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(<div className="cal-blank" key={'b' + i} />)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(view.year, view.month, d)
    const disabled = isDateDisabled ? isDateDisabled(date) : false
    const isToday = date.toDateString() === today.toDateString()
    const isSelected = value && date.toDateString() === value.toDateString()
    cells.push(
      <button
        key={d}
        type="button"
        className={'cal-day' + (!disabled ? ' avail' : '') + (isSelected ? ' selected' : '') + (isToday ? ' today' : '')}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(date)}
      >
        {d}
      </button>
    )
  }

  return (
    <div className="mini-cal">
      {loading && <div className="cal-loading">Checking availability…</div>}
      <div className="mini-cal-head">
        <button type="button" className="cal-nav" aria-label="Previous month" disabled={!canGoPrev} onClick={prev}>
          <Icon.ChevL style={{ width: 16, height: 16 }} />
        </button>
        <div className="cal-month">{MONTH_NAMES[view.month]} {view.year}</div>
        <button type="button" className="cal-nav" aria-label="Next month" disabled={!canGoNext} onClick={next}>
          <Icon.ChevR style={{ width: 16, height: 16 }} />
        </button>
      </div>
      <div className="mini-cal-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div className="dow" key={i}>{d}</div>)}
        {cells}
      </div>
    </div>
  )
}

/* ── Booking summary item ───────────────────────────────────────────────── */
function SummaryItem({ label, value }) {
  return (
    <div className="summary-item">
      <span className="summary-label">{label}</span>
      <span className="summary-value">{value}</span>
    </div>
  )
}

/* ── Hero header ────────────────────────────────────────────────────────── */
function Header({ logoUrl, businessName, tagline }) {
  return (
    <div className="booking-hero">
      <div className="booking-hero-inner">
        <div className="hero-brandmark">
          {logoUrl
            ? <img src={logoUrl} alt={businessName} />
            : <Icon.School style={{ width: 28, height: 28, color: 'var(--navy-700)' }} />
          }
        </div>
        <div className="eyebrow">Schedule a session</div>
        <h1>Educat<em>Orr</em></h1>
        <p>{tagline}</p>
        <div className="hero-credentials">
          <span className="cred"><Icon.Check style={{ width: 14, height: 14 }} /> 15-min intro call is free</span>
          <span className="cred"><Icon.Check style={{ width: 14, height: 14 }} /> One-on-one, never a group</span>
          <span className="cred"><Icon.Check style={{ width: 14, height: 14 }} /> Easy to cancel — just reply</span>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   Main App
   ══════════════════════════════════════════════════════════════════════════ */

const CUSTOM_LOCATION_VALUE = '__CUSTOM__'

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
  const [step, setStep] = useState(1)
  const [schools, setSchools] = useState([])
  const [meetingTypes, setMeetingTypes] = useState(DEFAULT_MEETING_TYPES)
  const [siteConfig, setSiteConfig] = useState({
    businessName: config.businessName,
    businessDescription: config.businessDescription,
    customLocationDuration: config.locationOptions.customLocationSessionDuration
  })

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

    fetch('/api/meeting-types')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (Array.isArray(data) && data.length > 0) setMeetingTypes(data) })
      .catch(() => {})

    fetch('/api/config')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        if (data.themeColor) applyTheme(data.themeColor)
        setSiteConfig({
          businessName: data.businessName || config.businessName,
          businessDescription: data.businessDescription || config.businessDescription,
          customLocationDuration: data.customLocationDuration || config.locationOptions.customLocationSessionDuration
        })
      })
      .catch(() => {})
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
  const [availableDates, setAvailableDates] = useState(null)
  const [loadingDays, setLoadingDays] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isBooked, setIsBooked] = useState(false)
  const [isCustomLocation, setIsCustomLocation] = useState(false)
  const [selectedSchool, setSelectedSchool] = useState(null)
  const [logoUrl, setLogoUrl] = useState(null)

  const getMeetingType = (id) => meetingTypes.find(t => t.id === id)

  const isDateInOverrides = (date, overrides) => {
    if (!overrides || !Array.isArray(overrides)) return false
    const target = format(date, 'yyyy-MM-dd')
    return overrides.some(override => {
      if (typeof override === 'string') return override === target
      else if (override.start && override.end) return target >= override.start && target <= override.end
      return false
    })
  }

  const fetchAvailableDays = async (month, year, school, meetingType, isCustom) => {
    let schoolId = ''
    let sessionDuration = 60
    let availabilityBlocks = null

    const mt = getMeetingType(meetingType)
    const mtAvailableDates = mt?.availableDates || null
    const mtUnavailableDates = mt?.unavailableDates || null

    if (mt && !mt.requiresSchool) {
      schoolId = ''
      sessionDuration = mt.sessionDuration
      availabilityBlocks = mt.availability
    } else if (isCustom) {
      schoolId = 'custom'
      sessionDuration = siteConfig.customLocationDuration
      availabilityBlocks = config.locationOptions.customLocationAvailability
    } else if (school) {
      schoolId = school.id
      sessionDuration = school.sessionDuration
      availabilityBlocks = school.availability
    } else {
      setAvailableDates(null)
      return
    }

    setLoadingDays(true)
    try {
      const res = await fetch('/api/availability/days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, month, schoolId, sessionDuration, availabilityBlocks,
          availableDates: mtAvailableDates,
          unavailableDates: mtUnavailableDates
        })
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

  useEffect(() => {
    const mt = getMeetingType(bookingData.meetingType)
    if ((mt && !mt.requiresSchool) || selectedSchool || isCustomLocation) {
      const now = new Date()
      fetchAvailableDays(now.getMonth(), now.getFullYear(), selectedSchool, bookingData.meetingType, isCustomLocation)
    } else {
      setAvailableDates(null)
    }
  }, [selectedSchool, isCustomLocation, bookingData.meetingType, meetingTypes])

  useEffect(() => {
    const mt = getMeetingType(bookingData.meetingType)
    if (bookingData.date && ((mt && !mt.requiresSchool) || selectedSchool || isCustomLocation)) {
      generateTimeSlots(bookingData.date)
    }
  }, [bookingData.date, selectedSchool, isCustomLocation, bookingData.meetingType])

  const generateTimeSlots = async (date) => {
    const dayOfWeek = getDay(date)
    let availability = []
    let sessionDuration = 60
    let schoolId = ''

    const mt = getMeetingType(bookingData.meetingType)
    const mtAvailableDates = mt?.availableDates || null
    const mtUnavailableDates = mt?.unavailableDates || null

    if (mt && !mt.requiresSchool) {
      availability = (mt.availability || {})[dayOfWeek] || []
      sessionDuration = mt.sessionDuration
      schoolId = ''
    } else if (isCustomLocation) {
      availability = config.locationOptions.customLocationAvailability[dayOfWeek] || []
      sessionDuration = siteConfig.customLocationDuration
      schoolId = 'custom'
    } else if (selectedSchool) {
      availability = selectedSchool.availability[dayOfWeek] || []
      sessionDuration = selectedSchool.sessionDuration
      schoolId = selectedSchool.id
    }

    if (availability.length === 0) { setAvailableSlots([]); return }

    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: format(date, 'yyyy-MM-dd'), schoolId, sessionDuration, availabilityBlocks: availability,
          availableDates: mtAvailableDates,
          unavailableDates: mtUnavailableDates
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

  const isDateDisabled = (date) => {
    if (isBefore(startOfDay(date), startOfDay(new Date()))) return true

    const mt = getMeetingType(bookingData.meetingType)
    if (mt) {
      if (isDateInOverrides(date, mt.unavailableDates)) return true
      if (mt.availableDates && mt.availableDates.length > 0) {
        if (!isDateInOverrides(date, mt.availableDates)) return true
      }
    }

    if (availableDates !== null) return !availableDates.has(format(date, 'yyyy-MM-dd'))

    const dayOfWeek = getDay(date)
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
    try {
      const mt = getMeetingType(bookingData.meetingType)
      const finalBookingData = {
        ...bookingData,
        date: format(bookingData.date, 'yyyy-MM-dd'),
        time: bookingData.time.toISOString(),
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
  const selectedMeetingType = getMeetingType(bookingData.meetingType)
  const canProceedFromStep2 = bookingData.meetingType && (
    !selectedMeetingType?.requiresSchool ||
    (bookingData.schoolId && (bookingData.schoolId !== CUSTOM_LOCATION_VALUE || bookingData.customLocation.trim()))
  )
  const canSubmit = bookingData.name && bookingData.email

  const getFinalLocation = () => {
    const mt = getMeetingType(bookingData.meetingType)
    if (mt && !mt.requiresSchool) {
      return mt.id === 'google-meet' ? `${mt.label} (link will be sent)` : mt.label
    }
    if (isCustomLocation) return bookingData.customLocation
    if (selectedSchool) return `${selectedSchool.name} — ${selectedSchool.address}`
    return ''
  }

  const getSessionDurationDisplay = () => bookingData.sessionDuration ? `${bookingData.sessionDuration} minutes` : ''

  /* ── Success screen ───────────────────────────────────────────────────── */
  if (isBooked) {
    return (
      <div className="booking-page">
        <Header logoUrl={logoUrl} businessName={siteConfig.businessName} tagline={siteConfig.businessDescription} />
        <div className="booking-card-wrap">
          <div className="booking-card">
            <div className="success-message">
              <div className="success-icon">
                <Icon.Check style={{ width: 32, height: 32 }} />
              </div>
              <h2>You're booked.</h2>
              <p className="success-lead">
                Your session has been scheduled. A Google Calendar invite has been sent
                to <strong>{bookingData.email}</strong> — reply to that email anytime, it's
                the fastest way to reach me.
              </p>
              <div className="booking-summary">
                <SummaryItem label="Date & time"
                  value={`${format(bookingData.date, 'MMMM d, yyyy')} at ${format(bookingData.time, 'h:mm a')}`} />
                <SummaryItem label="Session length" value={getSessionDurationDisplay()} />
                <SummaryItem label="Meeting type" value={selectedMeetingType?.label || bookingData.meetingType} />
                {selectedMeetingType?.requiresSchool && (
                  <SummaryItem label="Location" value={getFinalLocation()} />
                )}
                <SummaryItem label="Student" value={bookingData.name} />
                <SummaryItem label="Email" value={bookingData.email} />
              </div>
              <p className="confirmation-note">
                A confirmation email has been sent to {bookingData.email}
                {bookingData.meetingType === 'google-meet' && ' with the Google Meet link'}.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ── Wizard ───────────────────────────────────────────────────────────── */
  return (
    <div className="booking-page">
      <Header logoUrl={logoUrl} businessName={siteConfig.businessName} tagline={siteConfig.businessDescription} />
      <div className="booking-card-wrap">
        <div className="booking-card">
          <StepIndicator step={step} />

          {step === 1 && (
            <Step1
              meetingTypes={meetingTypes}
              schools={schools}
              bookingData={bookingData}
              selectedMeetingType={selectedMeetingType}
              isCustomLocation={isCustomLocation}
              siteConfig={siteConfig}
              handleMeetingTypeSelect={handleMeetingTypeSelect}
              handleLocationSelect={handleLocationSelect}
              handleCustomLocationChange={handleCustomLocationChange}
              handleNext={handleNext}
              canProceedFromStep2={canProceedFromStep2}
            />
          )}

          {step === 2 && (
            <Step2
              bookingData={bookingData}
              selectedSchool={selectedSchool}
              isCustomLocation={isCustomLocation}
              selectedMeetingType={selectedMeetingType}
              availableSlots={availableSlots}
              loadingDays={loadingDays}
              handleDateSelect={handleDateSelect}
              handleTimeSelect={handleTimeSelect}
              isDateDisabled={isDateDisabled}
              handleMonthChange={handleMonthChange}
              handleBack={handleBack}
              handleNext={handleNext}
              canProceedFromStep1={canProceedFromStep1}
              advanceBookingDays={config.booking.advanceBookingDays}
            />
          )}

          {step === 3 && (
            <Step3
              bookingData={bookingData}
              getFinalLocation={getFinalLocation}
              getSessionDurationDisplay={getSessionDurationDisplay}
              handleInputChange={handleInputChange}
              handleBack={handleBack}
              handleSubmit={handleSubmit}
              canSubmit={canSubmit}
              isSubmitting={isSubmitting}
            />
          )}
        </div>
        <div className="booking-foot">
          <span>EducatOrr Tutoring</span>
          <span className="dot" />
          <span>Questions? Reply to your confirmation email</span>
        </div>
      </div>
    </div>
  )
}

/* ── Step 1: Meeting type + location ────────────────────────────────────── */
function Step1({
  meetingTypes, schools, bookingData, selectedMeetingType, isCustomLocation, siteConfig,
  handleMeetingTypeSelect, handleLocationSelect, handleCustomLocationChange,
  handleNext, canProceedFromStep2
}) {
  return (
    <div className="form-section">
      <h2>How would you like to meet?</h2>

      <div className="meeting-options">
        {meetingTypes.map(mt => (
          <button
            key={mt.id}
            type="button"
            data-type={mt.id}
            className={'meeting-option' + (bookingData.meetingType === mt.id ? ' selected' : '')}
            onClick={() => handleMeetingTypeSelect(mt.id)}
          >
            <span className="meeting-option-icon">
              <MeetingIcon id={mt.id} />
            </span>
            <span className="meeting-option-content">
              <h3>{mt.label}</h3>
              <p>{mt.description}</p>
              {mt.sessionDuration && (
                <span className="duration-hint">Session length · {mt.sessionDuration} min</span>
              )}
            </span>
            <span className="check" />
          </button>
        ))}
      </div>

      {selectedMeetingType?.requiresSchool && (
        <div className="location-select">
          <label>Choose a location</label>
          <div className="school-tiles">
            {schools.map(school => (
              <button
                type="button"
                key={school.id}
                className={'school-tile' + (bookingData.schoolId === school.id ? ' selected' : '')}
                onClick={() => handleLocationSelect(school.id)}
              >
                <div className="school-tile-logo">
                  {school.logoUrl
                    ? <img src={school.logoUrl} alt={school.name} />
                    : <span className="placeholder-letter">{school.name.charAt(0).toUpperCase()}</span>
                  }
                </div>
                <div className="school-tile-name">{school.name}</div>
                <div className="school-tile-duration">{school.sessionDuration} min</div>
              </button>
            ))}
            {config.locationOptions.allowCustomLocation && (
              <button
                type="button"
                className={'school-tile' + (isCustomLocation ? ' selected' : '')}
                onClick={() => handleLocationSelect(CUSTOM_LOCATION_VALUE)}
              >
                <div className="school-tile-logo">
                  <Icon.MapPin style={{ width: 28, height: 28 }} />
                </div>
                <div className="school-tile-name">Other location</div>
                <div className="school-tile-duration">{siteConfig.customLocationDuration} min</div>
              </button>
            )}
          </div>

          {isCustomLocation && (
            <div className="custom-location-input">
              <input
                type="text"
                value={bookingData.customLocation}
                onChange={handleCustomLocationChange}
                placeholder={config.locationOptions.customLocationPlaceholder}
                autoFocus
              />
              <p>{config.locationOptions.customLocationHelp}</p>
            </div>
          )}
        </div>
      )}

      {isCustomLocation && (
        <div className="button-group" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={handleNext} disabled={!canProceedFromStep2}>
            Continue <Icon.ArrowR style={{ width: 16, height: 16 }} />
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Step 2: Date & time ────────────────────────────────────────────────── */
function Step2({
  bookingData, selectedSchool, isCustomLocation, selectedMeetingType,
  availableSlots, loadingDays, handleDateSelect, handleTimeSelect,
  isDateDisabled, handleMonthChange, handleBack, handleNext,
  canProceedFromStep1, advanceBookingDays
}) {
  return (
    <div className="form-section">
      <h2>When works for you?</h2>

      {selectedSchool && (
        <div className="selected-school-chip">
          <div className="ssc-icon"><Icon.School style={{ width: 18, height: 18 }} /></div>
          <div className="ssc-meta">
            <div className="ssc-name">{selectedSchool.name}</div>
            <div className="ssc-sub">{selectedSchool.address} · {selectedSchool.sessionDuration} min sessions</div>
          </div>
        </div>
      )}
      {isCustomLocation && bookingData.customLocation && (
        <div className="selected-school-chip">
          <div className="ssc-icon"><Icon.MapPin style={{ width: 18, height: 18 }} /></div>
          <div className="ssc-meta">
            <div className="ssc-name">{bookingData.customLocation}</div>
            <div className="ssc-sub">{bookingData.sessionDuration} min session</div>
          </div>
        </div>
      )}
      {selectedMeetingType && !selectedMeetingType.requiresSchool && (
        <div className="selected-school-chip">
          <div className="ssc-icon"><MeetingIcon id={selectedMeetingType.id} style={{ width: 18, height: 18 }} /></div>
          <div className="ssc-meta">
            <div className="ssc-name">{selectedMeetingType.label}</div>
            <div className="ssc-sub">{selectedMeetingType.sessionDuration} min session</div>
          </div>
        </div>
      )}

      <div className="date-time-layout">
        <div className="form-group" style={{ margin: 0 }}>
          <label>Choose a date</label>
          <MiniCalendar
            value={bookingData.date}
            onChange={handleDateSelect}
            isDateDisabled={isDateDisabled}
            onMonthChange={handleMonthChange}
            maxAdvanceDays={advanceBookingDays}
            loading={loadingDays}
          />
          <div className="cal-legend">
            <span className="cal-legend-dot" /> Dot indicates a day with open times
          </div>
        </div>

        <div className="form-group time-slots-wrap" style={{ margin: 0 }}>
          <label>Available time slots</label>
          {!bookingData.date ? (
            <div className="time-slots-empty">Select a date to see available times.</div>
          ) : availableSlots.length === 0 ? (
            <div className="time-slots-empty">No available time slots on this date. Please select another date.</div>
          ) : (
            <>
              <div className="time-slots-head">
                {format(bookingData.date, "EEE, MMM d")} · America/Chicago
              </div>
              <div className="time-slots">
                {availableSlots.map((slot, i) => (
                  <button
                    key={i}
                    type="button"
                    className={'time-slot' + (bookingData.time && bookingData.time.getTime() === slot.time.getTime() ? ' selected' : '') + (!slot.available ? ' disabled' : '')}
                    onClick={() => slot.available && handleTimeSelect(slot.time)}
                    disabled={!slot.available}
                  >
                    <span className="slot-time">{format(slot.time, 'h:mm a')}</span>
                    {slot.blockName && <span className="slot-block-name">{slot.blockName}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="button-group">
        <button className="btn btn-ghost" onClick={handleBack}>
          <Icon.ArrowL style={{ width: 16, height: 16 }} /> Back
        </button>
        <button className="btn btn-primary" onClick={handleNext} disabled={!canProceedFromStep1}>
          Continue <Icon.ArrowR style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  )
}

/* ── Step 3: Your info ──────────────────────────────────────────────────── */
function Step3({
  bookingData, getFinalLocation, getSessionDurationDisplay,
  handleInputChange, handleBack, handleSubmit, canSubmit, isSubmitting
}) {
  return (
    <div className="form-section">
      <h2>A little about your student.</h2>

      <div className="booking-summary">
        <SummaryItem label="Date & time"
          value={`${format(bookingData.date, 'MMMM d, yyyy')} at ${format(bookingData.time, 'h:mm a')}`} />
        <SummaryItem label="Session length" value={getSessionDurationDisplay()} />
        <SummaryItem label="Location" value={getFinalLocation()} />
      </div>

      <div className="form-group">
        <label>Full name <span style={{ color: 'var(--gray-500)', fontWeight: 400 }}>*</span></label>
        <input type="text" name="name" value={bookingData.name} onChange={handleInputChange} placeholder="Avery Chen" required />
      </div>

      <div className="form-group">
        <label>Email address <span style={{ color: 'var(--gray-500)', fontWeight: 400 }}>*</span></label>
        <input type="email" name="email" value={bookingData.email} onChange={handleInputChange} placeholder="you@email.com" required />
        <div className="field-hint">I'll send the Google Calendar invite here.</div>
      </div>

      <div className="form-group">
        <label>Phone number <span style={{ color: 'var(--gray-500)', fontWeight: 400 }}>(optional)</span></label>
        <input type="tel" name="phone" value={bookingData.phone} onChange={handleInputChange} placeholder="(555) 123-4567" />
      </div>

      <div className="form-group">
        <label>Anything I should know before our first session? <span style={{ color: 'var(--gray-500)', fontWeight: 400 }}>(optional)</span></label>
        <textarea name="notes" value={bookingData.notes} onChange={handleInputChange} rows="4"
          placeholder="Topics you're working on, recent test scores, accommodations…" />
      </div>

      <div className="button-group">
        <button className="btn btn-ghost" onClick={handleBack}>
          <Icon.ArrowL style={{ width: 16, height: 16 }} /> Back
        </button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? 'Booking…' : 'Confirm booking'} <Icon.ArrowR style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  )
}

export default App
