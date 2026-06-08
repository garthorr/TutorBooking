import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Scheduler from './components/Scheduler'
import { applyTheme } from './theme'
import './App.css'

function detectTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined }
  catch { return undefined }
}

function fmt(b) {
  if (!b?.time) return b?.date || ''
  const dt = new Date(b.time)
  if (isNaN(dt.getTime())) return b.date || ''
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: b.timezone || detectTimezone()
  }).format(dt)
}

export default function Manage() {
  const { token } = useParams()
  const [booking, setBooking] = useState(null)
  const [params, setParams] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [mode, setMode] = useState('view') // view | reschedule
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/manage/${token}`)
      if (res.ok) {
        const data = await res.json()
        setBooking(data.booking)
        setParams(data.reschedule)
      } else {
        setNotFound(true)
      }
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch('/api/config').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.themeColor) applyTheme(d.themeColor)
    }).catch(() => {})
    load()
  }, [token])

  const handleCancel = async () => {
    if (!confirm('Cancel this session? This cannot be undone.')) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/manage/${token}/cancel`, { method: 'POST' })
      if (res.ok) load()
      else setError('Could not cancel the booking. Please try again.')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleReschedulePick = async (isoTime) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/manage/${token}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: isoTime })
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setBooking(data.booking)
        setMode('view')
      } else {
        setError(data.error || 'Could not reschedule. Please pick another time.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="booking-page">
      <div className="booking-card-wrap" style={{ marginTop: '3rem' }}>
        <div className="booking-card">
          {loading ? (
            <p>Loading…</p>
          ) : notFound ? (
            <div className="form-section">
              <h2>Booking not found</h2>
              <p>This management link is invalid or has expired. If you need help, reply to your confirmation email.</p>
            </div>
          ) : (
            <div className="form-section">
              {error && <div className="message error">{error}</div>}

              {booking.status === 'cancelled' ? (
                <>
                  <h2>This session is cancelled</h2>
                  <p>Your session for {fmt(booking)} has been cancelled. To book again, visit the booking page.</p>
                  <a className="btn btn-primary" href="/">Book a new session</a>
                </>
              ) : mode === 'reschedule' ? (
                <>
                  <h2>Pick a new time</h2>
                  <p className="field-hint">Currently scheduled for {fmt(booking)}.</p>
                  <Scheduler params={params} onPick={handleReschedulePick} busy={busy} timezone={booking.timezone} />
                  <div className="button-group">
                    <button className="btn btn-ghost" onClick={() => setMode('view')} disabled={busy}>Back</button>
                  </div>
                </>
              ) : (
                <>
                  <h2>Your session</h2>
                  <div className="booking-summary">
                    <div className="summary-item"><span className="summary-label">When</span><span className="summary-value">{fmt(booking)}</span></div>
                    <div className="summary-item"><span className="summary-label">Length</span><span className="summary-value">{booking.sessionDuration} minutes</span></div>
                    <div className="summary-item"><span className="summary-label">Type</span><span className="summary-value">{booking.meetingType}</span></div>
                    {booking.location && <div className="summary-item"><span className="summary-label">Location</span><span className="summary-value">{booking.location}</span></div>}
                    {booking.meetLink && <div className="summary-item"><span className="summary-label">Meet link</span><span className="summary-value"><a href={booking.meetLink} target="_blank" rel="noopener noreferrer">Join</a></span></div>}
                  </div>
                  <div className="button-group">
                    <button className="btn btn-primary" onClick={() => setMode('reschedule')} disabled={busy}>Reschedule</button>
                    <button className="btn btn-danger" onClick={handleCancel} disabled={busy}>Cancel session</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
