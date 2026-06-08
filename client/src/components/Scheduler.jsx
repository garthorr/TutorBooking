import { useState, useEffect, useRef } from 'react'
import { format, getDay } from 'date-fns'
import './scheduler.css'

/*
 * Self-contained date + time-slot picker that talks to the public
 * /api/availability/days and /api/availability endpoints. Driven entirely by a
 * `params` object resolved server-side ({ schoolId, sessionDuration,
 * availabilityBlocks, availableDates, unavailableDates }), so the same component
 * powers both the admin reschedule modal and the public /manage page.
 */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const ChevL = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
)
const ChevR = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

function detectTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago' }
  catch { return 'America/Chicago' }
}
const fmtTime = (date, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(date)
const fmtTzAbbr = (date, tz) => {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: tz }).formatToParts(date).find(p => p.type === 'timeZoneName')
    return part?.value || tz
  } catch { return tz }
}

function isDateInOverrides(date, overrides) {
  if (!overrides || !Array.isArray(overrides)) return false
  const target = format(date, 'yyyy-MM-dd')
  return overrides.some(o => {
    if (typeof o === 'string') return o === target
    if (o.start && o.end) return target >= o.start && target <= o.end
    return false
  })
}

export default function Scheduler({ params, onPick, maxAdvanceDays = 90, busy = false, timezone }) {
  const tz = timezone || detectTimezone()
  const today = new Date()
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [availableDates, setAvailableDates] = useState(null)
  const [loadingDays, setLoadingDays] = useState(false)
  const [selectedDate, setSelectedDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [selectedTime, setSelectedTime] = useState(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const reqRef = useRef(0)

  const fetchDays = async (year, month) => {
    if (!params) return
    setLoadingDays(true)
    try {
      const res = await fetch('/api/availability/days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, month,
          schoolId: params.schoolId,
          sessionDuration: params.sessionDuration,
          availabilityBlocks: params.availabilityBlocks,
          availableDates: params.availableDates,
          unavailableDates: params.unavailableDates
        })
      })
      if (res.ok) {
        const data = await res.json()
        setAvailableDates(new Set(data.availableDates))
      }
    } catch {
      /* leave previous state */
    } finally {
      setLoadingDays(false)
    }
  }

  useEffect(() => { fetchDays(view.year, view.month) }, [view.year, view.month, params])

  const fetchSlots = async (date) => {
    const dayOfWeek = getDay(date)
    const dayBlocks = (params.availabilityBlocks || {})[dayOfWeek] || []
    const reqId = ++reqRef.current
    if (dayBlocks.length === 0) { setSlots([]); return }
    setLoadingSlots(true)
    try {
      const res = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: format(date, 'yyyy-MM-dd'),
          schoolId: params.schoolId,
          sessionDuration: params.sessionDuration,
          availabilityBlocks: dayBlocks,
          availableDates: params.availableDates,
          unavailableDates: params.unavailableDates
        })
      })
      if (reqId !== reqRef.current) return
      if (res.ok) {
        const data = await res.json()
        setSlots(data.slots.map(s => new Date(s.time)))
      } else {
        setSlots([])
      }
    } catch {
      if (reqId === reqRef.current) setSlots([])
    } finally {
      if (reqId === reqRef.current) setLoadingSlots(false)
    }
  }

  const handleDateSelect = (date) => {
    setSelectedDate(date)
    setSelectedTime(null)
    fetchSlots(date)
  }

  const maxDate = new Date(today)
  maxDate.setDate(today.getDate() + maxAdvanceDays)

  const isDateDisabled = (date) => {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    if (d < t) return true
    if (d > maxDate) return true
    if (params) {
      if (isDateInOverrides(date, params.unavailableDates)) return true
      if (params.availableDates && params.availableDates.length > 0 && !isDateInOverrides(date, params.availableDates)) return true
    }
    if (availableDates !== null) return !availableDates.has(format(date, 'yyyy-MM-dd'))
    return false
  }

  const firstOfMonth = new Date(view.year, view.month, 1)
  const startPad = firstOfMonth.getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()

  const canGoPrev = (view.year > today.getFullYear()) || (view.year === today.getFullYear() && view.month > today.getMonth())
  const lastAllowed = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)
  const canGoNext = (view.year < lastAllowed.getFullYear()) || (view.year === lastAllowed.getFullYear() && view.month < lastAllowed.getMonth())

  const prev = () => canGoPrev && setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 })
  const next = () => canGoNext && setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 })

  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(<div className="cal-blank" key={'b' + i} />)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(view.year, view.month, d)
    const disabled = isDateDisabled(date)
    const isToday = date.toDateString() === today.toDateString()
    const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString()
    cells.push(
      <button
        key={d}
        type="button"
        className={'cal-day' + (!disabled ? ' avail' : '') + (isSelected ? ' selected' : '') + (isToday ? ' today' : '')}
        disabled={disabled}
        onClick={() => !disabled && handleDateSelect(date)}
      >
        {d}
      </button>
    )
  }

  return (
    <div className="date-time-layout">
      <div className="form-group" style={{ margin: 0 }}>
        <label>Choose a new date</label>
        <div className="mini-cal">
          {loadingDays && <div className="cal-loading">Checking availability…</div>}
          <div className="mini-cal-head">
            <button type="button" className="cal-nav" aria-label="Previous month" disabled={!canGoPrev} onClick={prev}><ChevL /></button>
            <div className="cal-month">{MONTH_NAMES[view.month]} {view.year}</div>
            <button type="button" className="cal-nav" aria-label="Next month" disabled={!canGoNext} onClick={next}><ChevR /></button>
          </div>
          <div className="mini-cal-grid">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div className="dow" key={i}>{d}</div>)}
            {cells}
          </div>
        </div>
        <div className="cal-legend">
          <span className="cal-legend-dot" /> Dot indicates a day with open times
        </div>
      </div>

      <div className="form-group time-slots-wrap" style={{ margin: 0 }}>
        <label>New time</label>
        {!selectedDate ? (
          <div className="time-slots-empty">Select a date to see available times.</div>
        ) : loadingSlots ? (
          <div className="time-slots-empty">Loading times…</div>
        ) : slots.length === 0 ? (
          <div className="time-slots-empty">No open times on this date. Please pick another.</div>
        ) : (
          <>
            <div className="time-slots-head">{format(selectedDate, 'EEE, MMM d')} · {fmtTzAbbr(selectedDate, tz)}</div>
            <div className="time-slots">
              {slots.map((time, i) => (
                <button
                  key={i}
                  type="button"
                  className={'time-slot' + (selectedTime && selectedTime.getTime() === time.getTime() ? ' selected' : '')}
                  onClick={() => setSelectedTime(time)}
                >
                  <span className="slot-time">{fmtTime(time, tz)}</span>
                </button>
              ))}
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              disabled={!selectedTime || busy}
              onClick={() => selectedTime && onPick(selectedTime.toISOString())}
            >
              {busy ? 'Saving…' : 'Confirm new time'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
