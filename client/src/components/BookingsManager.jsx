import { useState, useEffect } from 'react'
import { format, parseISO, isValid } from 'date-fns'
import { adminFetch } from '../auth'
import Scheduler from './Scheduler'

function fmtDateTime(b) {
  // Prefer the precise ISO start time; fall back to the date string.
  const dt = b.time ? parseISO(b.time) : null
  if (dt && isValid(dt)) return format(dt, 'EEE, MMM d, yyyy · h:mm a')
  return b.date || '—'
}

function startOfBooking(b) {
  const dt = b.time ? parseISO(b.time) : null
  if (dt && isValid(dt)) return dt.getTime()
  return b.date ? new Date(b.date).getTime() : 0
}

export default function BookingsManager() {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('upcoming') // upcoming | past | all
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState(null)
  const [rescheduling, setRescheduling] = useState(null) // { booking, params }
  const [actionBusy, setActionBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminFetch('/api/bookings')
      if (res.ok) {
        const data = await res.json()
        setBookings(Array.isArray(data.bookings) ? data.bookings : [])
      }
    } catch {
      /* keep current */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const flash = (text, type = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 4000)
  }

  const handleCancel = async (b) => {
    if (!confirm(`Cancel the booking for ${b.name} on ${fmtDateTime(b)}? The client and calendar event will be updated.`)) return
    setActionBusy(true)
    try {
      const res = await adminFetch(`/api/bookings/${b.id}`, { method: 'DELETE' })
      if (res.ok) { flash('Booking cancelled.'); load() }
      else flash('Failed to cancel booking.', 'error')
    } catch {
      flash('Error cancelling booking.', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const openReschedule = async (b) => {
    setActionBusy(true)
    try {
      const res = await adminFetch(`/api/bookings/${b.id}`)
      if (res.ok) {
        const data = await res.json()
        setRescheduling({ booking: b, params: data.reschedule })
      } else {
        flash('Could not load reschedule options.', 'error')
      }
    } catch {
      flash('Error loading reschedule options.', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const handleReschedulePick = async (isoTime) => {
    if (!rescheduling) return
    setActionBusy(true)
    try {
      const res = await adminFetch(`/api/bookings/${rescheduling.booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: isoTime })
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        flash('Booking rescheduled.')
        setRescheduling(null)
        load()
      } else {
        flash(data.error || 'Failed to reschedule.', 'error')
      }
    } catch {
      flash('Error rescheduling booking.', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const copyManageLink = (b) => {
    if (!b.manage_token) { flash('No manage link for this booking.', 'error'); return }
    const url = `${window.location.origin}/manage/${b.manage_token}`
    navigator.clipboard?.writeText(url).then(
      () => flash('Manage link copied to clipboard.'),
      () => flash(url, 'success')
    )
  }

  const now = Date.now()
  const visible = bookings
    .filter(b => {
      if (filter === 'upcoming') return b.status !== 'cancelled' && startOfBooking(b) >= now
      if (filter === 'past') return startOfBooking(b) < now || b.status === 'cancelled'
      return true
    })
    .filter(b => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return [b.name, b.email, b.location, b.meeting_type].some(v => (v || '').toLowerCase().includes(q))
    })
    .sort((a, b) => startOfBooking(a) - startOfBooking(b))

  return (
    <div className="bookings-manager">
      <h2>Bookings</h2>
      <p className="field-hint">View, reschedule, or cancel scheduled sessions. Changes sync to Google Calendar and notify the client.</p>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      <div className="bookings-toolbar">
        <div className="bookings-filters">
          {['upcoming', 'past', 'all'].map(f => (
            <button
              key={f}
              className={`admin-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="bookings-search"
          placeholder="Search name, email, location…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {loading ? (
        <p>Loading bookings…</p>
      ) : visible.length === 0 ? (
        <p className="time-slots-empty">No bookings to show.</p>
      ) : (
        <div className="bookings-table">
          <div className="bookings-row bookings-row-head">
            <span>When</span>
            <span>Client</span>
            <span>Type</span>
            <span>Location</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {visible.map(b => (
            <div key={b.id} className={`bookings-row ${b.status === 'cancelled' ? 'cancelled' : ''}`}>
              <span data-label="When">{fmtDateTime(b)}</span>
              <span data-label="Client">
                <span className="booking-name">{b.name}</span>
                <span className="booking-email">{b.email}</span>
              </span>
              <span data-label="Type">{b.meeting_type}</span>
              <span data-label="Location">{b.location || '—'}</span>
              <span data-label="Status">
                <span className={`booking-status status-${b.status || 'confirmed'}`}>{b.status || 'confirmed'}</span>
              </span>
              <span data-label="Actions" className="bookings-actions">
                {b.status !== 'cancelled' && (
                  <>
                    <button className="btn btn-secondary btn-sm" disabled={actionBusy} onClick={() => openReschedule(b)}>Reschedule</button>
                    <button className="btn btn-danger btn-sm" disabled={actionBusy} onClick={() => handleCancel(b)}>Cancel</button>
                  </>
                )}
                {b.manage_token && (
                  <button className="btn btn-ghost btn-sm" onClick={() => copyManageLink(b)}>Copy link</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {rescheduling && (
        <div className="modal-overlay" onClick={() => !actionBusy && setRescheduling(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Reschedule — {rescheduling.booking.name}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setRescheduling(null)} disabled={actionBusy}>✕</button>
            </div>
            <p className="field-hint">Currently {fmtDateTime(rescheduling.booking)}</p>
            <Scheduler params={rescheduling.params} onPick={handleReschedulePick} busy={actionBusy} />
          </div>
        </div>
      )}
    </div>
  )
}
