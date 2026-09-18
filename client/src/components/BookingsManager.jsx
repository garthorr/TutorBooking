import { useState, useEffect } from 'react'
import { format, parseISO, isValid } from 'date-fns'
import { adminFetch } from '../auth'
import Scheduler from './Scheduler'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Keep in step with MAX_GUESTS in server/services/guests.js, which enforces it.
const MAX_GUESTS = 5

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

export default function BookingsManager({ smsEnabled = false }) {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('upcoming') // upcoming | past | all
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState(null)
  const [rescheduling, setRescheduling] = useState(null) // { booking, params }
  const [actionBusy, setActionBusy] = useState(false)
  // Admin-created booking. These skip the minimum-notice window: the rule
  // exists so the tutor is not ambushed, and this is the tutor booking.
  const [creating, setCreating] = useState(false)
  const [meetingTypes, setMeetingTypes] = useState([])
  const [schools, setSchools] = useState([])
  const [draft, setDraft] = useState({ meetingType: '', schoolId: '', customLocation: '', name: '', email: '', phone: '', smsConsent: false, notes: '', guests: [] })

  useEffect(() => {
    if (!creating || meetingTypes.length) return
    adminFetch('/api/meeting-types/all').then(r => r.ok ? r.json() : []).then(t => setMeetingTypes(Array.isArray(t) ? t.filter(x => x.enabled) : [])).catch(() => {})
    adminFetch('/api/schools').then(r => r.ok ? r.json() : []).then(s => setSchools(Array.isArray(s) ? s : [])).catch(() => {})
  }, [creating])

  const draftType = meetingTypes.find(t => t.id === draft.meetingType) || null
  const draftSchool = schools.find(s => s.id === draft.schoolId) || null
  const needsLocation = Boolean(draftType?.requiresSchool)
  const CUSTOM = '__CUSTOM__'

  // The same shape the Scheduler expects elsewhere.
  const draftParams = !draftType ? null
    : !needsLocation
      ? { schoolId: '', sessionDuration: draftType.sessionDuration || 60, availabilityBlocks: draftType.availability || {},
          availableDates: draftType.availableDates || null, unavailableDates: draftType.unavailableDates || null,
          meetingType: draftType.id }
    : draft.schoolId === CUSTOM
      ? { schoolId: 'custom', sessionDuration: 60, meetingType: draft.meetingType,
          availabilityBlocks: { 1: [{ start: '09:00', end: '17:00' }], 2: [{ start: '09:00', end: '17:00' }],
            3: [{ start: '09:00', end: '17:00' }], 4: [{ start: '09:00', end: '17:00' }], 5: [{ start: '09:00', end: '17:00' }] },
          availableDates: null, unavailableDates: null }
    : draftSchool
      ? { schoolId: draftSchool.id, sessionDuration: draftSchool.sessionDuration || 60,
          availabilityBlocks: draftSchool.availability || {}, availableDates: null, unavailableDates: null,
          meetingType: draft.meetingType }
      : null

  const guestsValid = draft.guests.every(g => !g.trim() || EMAIL_RE.test(g.trim()))
  const draftReady = Boolean(draftType && draft.name.trim() && EMAIL_RE.test(draft.email) && guestsValid
    && (!needsLocation || (draft.schoolId && (draft.schoolId !== CUSTOM || draft.customLocation.trim()))))

  const resetDraft = () => setDraft({ meetingType: '', schoolId: '', customLocation: '', name: '', email: '', phone: '', smsConsent: false, notes: '', guests: [] })

  const handleCreatePick = async (isoTime) => {
    setActionBusy(true)
    try {
      const location = !needsLocation
        ? (draftType?.label || draft.meetingType)
        : draft.schoolId === CUSTOM
          ? draft.customLocation
          : `${draftSchool?.name} - ${draftSchool?.address}`
      const res = await adminFetch('/api/bookings/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time: isoTime, meetingType: draft.meetingType,
          schoolId: needsLocation ? draft.schoolId : '', location,
          name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim(), notes: draft.notes.trim(),
          smsConsent: draft.smsConsent,
          guests: draft.guests.map(g => g.trim()).filter(Boolean)
        })
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        flash('Booking created. The student has been emailed and the event added to your calendar.')
        setCreating(false); resetDraft(); load()
      } else {
        flash(data.error || 'Failed to create the booking.', 'error')
      }
    } catch {
      flash('Error creating the booking.', 'error')
    } finally {
      setActionBusy(false)
    }
  }

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
      return [b.name, b.email, b.location, b.meeting_type, ...(b.guestEmails || [])]
        .some(v => (v || '').toLowerCase().includes(q))
    })
    .sort((a, b) => startOfBooking(a) - startOfBooking(b))

  return (
    <div className="bookings-manager">
      <div className="bookings-header">
        <div>
          <h2>Bookings</h2>
          <p className="field-hint">View, reschedule, or cancel scheduled sessions. Changes sync to Google Calendar and notify the client.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New booking</button>
      </div>

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
                {b.guestEmails?.length > 0 && (
                  <span className="booking-guests" title={b.guestEmails.join(', ')}>
                    + {b.guestEmails.length} guest{b.guestEmails.length > 1 ? 's' : ''}
                  </span>
                )}
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

      {creating && (
        <div className="modal-overlay" onClick={() => !actionBusy && setCreating(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>New booking</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); resetDraft() }} disabled={actionBusy}>✕</button>
            </div>
            <p className="field-hint">
              Bookings made here ignore the minimum-notice window, so you can slot someone
              in at short notice. The student gets the usual confirmation email and calendar invite.
            </p>

            <div className="settings-field">
              <label>Meeting type</label>
              <select value={draft.meetingType}
                onChange={e => setDraft(d => ({ ...d, meetingType: e.target.value, schoolId: '', customLocation: '' }))}>
                <option value="">Choose…</option>
                {meetingTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>

            {needsLocation && (
              <div className="settings-field">
                <label>Location</label>
                <select value={draft.schoolId} onChange={e => setDraft(d => ({ ...d, schoolId: e.target.value }))}>
                  <option value="">Choose…</option>
                  {schools.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                  <option value={CUSTOM}>Other location…</option>
                </select>
              </div>
            )}

            {needsLocation && draft.schoolId === CUSTOM && (
              <div className="settings-field">
                <label>Address</label>
                <input type="text" value={draft.customLocation}
                  onChange={e => setDraft(d => ({ ...d, customLocation: e.target.value }))}
                  placeholder="Where are you meeting?" />
              </div>
            )}

            <div className="settings-field">
              <label>Student name</label>
              <input type="text" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Avery Chen" />
            </div>
            <div className="settings-field">
              <label>Student email</label>
              <input type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} placeholder="you@email.com" />
            </div>
            <div className="settings-field">
              <label>Phone <span className="field-hint-inline">(optional)</span></label>
              <input type="tel" value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} />
            </div>
            {smsEnabled && (
              <div className="settings-field">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={draft.smsConsent}
                    onChange={e => setDraft(d => ({ ...d, smsConsent: e.target.checked }))}
                  />
                  <span>Student agreed to a text reminder</span>
                </label>
                <span className="field-hint-inline">Needs a US phone number above.</span>
              </div>
            )}
            <div className="settings-field">
              <label>Notes <span className="field-hint-inline">(optional)</span></label>
              <textarea rows="2" value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
            </div>
            <div className="settings-field">
              <label>Also invite <span className="field-hint-inline">(optional)</span></label>
              {draft.guests.map((guest, i) => {
                const invalid = Boolean(guest.trim()) && !EMAIL_RE.test(guest.trim())
                return (
                  <div className="guest-row" key={i}>
                    <input type="email" value={guest} placeholder="parent@email.com"
                      className={invalid ? 'invalid' : undefined}
                      aria-invalid={invalid || undefined}
                      aria-label={`Guest email ${i + 1}`}
                      onChange={e => setDraft(d => ({ ...d, guests: d.guests.map((g, gi) => (gi === i ? e.target.value : g)) }))} />
                    <button type="button" className="btn btn-ghost btn-sm"
                      aria-label={`Remove guest ${i + 1}`}
                      onClick={() => setDraft(d => ({ ...d, guests: d.guests.filter((_, gi) => gi !== i) }))}>
                      Remove
                    </button>
                  </div>
                )
              })}
              {draft.guests.length < MAX_GUESTS ? (
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => setDraft(d => ({ ...d, guests: [...d.guests, ''] }))}>
                  + Add {draft.guests.length === 0 ? 'a guest' : 'another'}
                </button>
              ) : (
                <p className="field-hint">You can invite up to {MAX_GUESTS} guests.</p>
              )}
              <p className="field-hint">
                Parents or guardians go on the calendar invite alongside the student, and can
                reschedule or cancel from it.
              </p>
            </div>

            {!draftReady ? (
              // Without this branch an unparseable guest address silently hides
              // the slot picker behind a message about the student's details.
              !guestsValid ? (
                <p className="field-hint">Check the highlighted guest email address.</p>
              ) : (
                <p className="field-hint">Choose a meeting type{needsLocation ? ', a location' : ''} and enter the student&rsquo;s name and email to pick a time.</p>
              )
            ) : (
              <Scheduler params={draftParams} onPick={handleCreatePick} busy={actionBusy} admin />
            )}
          </div>
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
