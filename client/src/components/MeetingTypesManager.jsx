import { useState, useEffect } from 'react'
import { adminFetch } from '../auth'

const DAYS = [
  { num: 0, label: 'Sunday' },
  { num: 1, label: 'Monday' },
  { num: 2, label: 'Tuesday' },
  { num: 3, label: 'Wednesday' },
  { num: 4, label: 'Thursday' },
  { num: 5, label: 'Friday' },
  { num: 6, label: 'Saturday' },
]

const SESSION_DURATIONS = Array.from({ length: 36 }, (_, i) => (i + 1) * 5)

function durationLabel(d) {
  if (d < 60) return `${d} min`
  if (d === 60) return '1 hr'
  if (d % 60 === 0) return `${d / 60} hr`
  return `${Math.floor(d / 60)} hr ${d % 60} min`
}

function generateId(label) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `custom-${slug}-${Date.now().toString(36)}`
}

function emptyType() {
  return {
    id: '',
    label: '',
    description: '',
    icon: '📅',
    enabled: true,
    sessionDuration: 60,
    availability: {
      0: [],
      1: [{ start: '09:00', end: '17:00' }],
      2: [{ start: '09:00', end: '17:00' }],
      3: [{ start: '09:00', end: '17:00' }],
      4: [{ start: '09:00', end: '17:00' }],
      5: [{ start: '09:00', end: '17:00' }],
      6: []
    },
    isBuiltin: false,
    requiresSchool: false
  }
}

function ScheduleBuilder({ availability, onChange }) {
  const avail = availability || {}

  const toggleDay = (num) => {
    const updated = { ...avail }
    if (updated[num]) delete updated[num]
    else updated[num] = [{ start: '09:00', end: '17:00' }]
    onChange(updated)
  }

  const addBlock = (num) => {
    onChange({ ...avail, [num]: [...(avail[num] || []), { start: '09:00', end: '17:00' }] })
  }

  const updateBlock = (num, idx, block) => {
    const blocks = [...avail[num]]
    blocks[idx] = block
    onChange({ ...avail, [num]: blocks })
  }

  const removeBlock = (num, idx) => {
    const blocks = avail[num].filter((_, i) => i !== idx)
    const updated = { ...avail }
    if (blocks.length === 0) delete updated[num]
    else updated[num] = blocks
    onChange(updated)
  }

  return (
    <div className="schedule-builder">
      {DAYS.map(({ num, label }) => {
        const active = !!avail[num]
        const blocks = avail[num] || []
        return (
          <div key={num} className={`schedule-day ${active ? 'active' : ''}`}>
            <div className="schedule-day-header">
              <label className="day-toggle">
                <input type="checkbox" checked={active} onChange={() => toggleDay(num)} />
                <span>{label}</span>
              </label>
              {active && (
                <button type="button" className="add-block-btn" onClick={() => addBlock(num)}>
                  + Add Block
                </button>
              )}
            </div>
            {active && (
              <div className="time-blocks">
                {blocks.map((block, idx) => (
                  <div key={idx} className="time-block-row">
                    <input type="time" value={block.start}
                      onChange={e => updateBlock(num, idx, { ...block, start: e.target.value })} />
                    <span className="time-block-to">to</span>
                    <input type="time" value={block.end}
                      onChange={e => updateBlock(num, idx, { ...block, end: e.target.value })} />
                    <button type="button" className="remove-block-btn"
                      onClick={() => removeBlock(num, idx)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function MeetingTypesManager() {
  const [types, setTypes] = useState([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })
  const [expandedId, setExpandedId] = useState(null)
  const [addingNew, setAddingNew] = useState(false)
  const [newType, setNewType] = useState(emptyType())

  useEffect(() => { loadTypes() }, [])

  const loadTypes = async () => {
    try {
      const res = await adminFetch('/api/meeting-types/all')
      if (res.ok) setTypes(await res.json())
    } catch {
      showMessage('Failed to load meeting types', 'error')
    }
  }

  const showMessage = (text, type) => {
    setMessage({ text, type })
    setTimeout(() => setMessage({ text: '', type: '' }), 4000)
  }

  const persist = async (updated) => {
    setSaving(true)
    try {
      const res = await adminFetch('/api/meeting-types', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      })
      if (res.ok) { setTypes(updated); showMessage('Saved', 'success') }
      else showMessage('Failed to save', 'error')
    } catch {
      showMessage('Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (id, changes) =>
    setTypes(prev => prev.map(t => t.id === id ? { ...t, ...changes } : t))

  const moveUp = (idx) => {
    if (idx === 0) return
    const next = [...types]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    next.forEach((t, i) => { t.order = i })
    setTypes([...next])
  }

  const moveDown = (idx) => {
    if (idx === types.length - 1) return
    const next = [...types]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    next.forEach((t, i) => { t.order = i })
    setTypes([...next])
  }

  const deleteType = (id) => {
    if (!confirm('Delete this meeting type? This cannot be undone.')) return
    const updated = types.filter(t => t.id !== id).map((t, i) => ({ ...t, order: i }))
    persist(updated)
  }

  const handleAddNew = () => {
    if (!newType.label.trim()) { alert('Name is required'); return }
    const t = { ...newType, id: generateId(newType.label), order: types.length }
    const updated = [...types, t]
    persist(updated)
    setAddingNew(false)
    setNewType(emptyType())
  }

  return (
    <div className="meeting-types-manager">
      {message.text && <div className={`message ${message.type}`}>{message.text}</div>}

      <div className="section-header">
        <h3>Meeting Types</h3>
        <button className="btn btn-primary btn-sm" onClick={() => persist(types)} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
      <p className="field-hint" style={{ marginBottom: '1.25rem' }}>
        Changes take effect on the booking page after saving.
      </p>

      <div className="mt-list">
        {types.map((t, idx) => (
          <div key={t.id} className={`mt-row${t.enabled ? '' : ' mt-row-disabled'}`}>
            {/* ── Main row ── */}
            <div className="mt-row-main">
              <div className="mt-reorder">
                <button className="mt-arrow" onClick={() => moveUp(idx)} disabled={idx === 0} title="Move up">▲</button>
                <button className="mt-arrow" onClick={() => moveDown(idx)} disabled={idx === types.length - 1} title="Move down">▼</button>
              </div>

              <input className="mt-icon-input" value={t.icon}
                onChange={e => updateField(t.id, { icon: e.target.value })}
                title="Icon (emoji)" maxLength={4} />

              <input className="mt-name-input" value={t.label}
                onChange={e => updateField(t.id, { label: e.target.value })}
                placeholder="Name" />

              {!t.requiresSchool ? (
                <select className="mt-duration-select" value={t.sessionDuration}
                  onChange={e => updateField(t.id, { sessionDuration: Number(e.target.value) })}
                  title="Session duration">
                  {SESSION_DURATIONS.map(d => (
                    <option key={d} value={d}>{durationLabel(d)}</option>
                  ))}
                </select>
              ) : (
                <span className="mt-school-badge">from school</span>
              )}

              <label className="mt-toggle" title={t.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}>
                <input type="checkbox" checked={t.enabled}
                  onChange={e => updateField(t.id, { enabled: e.target.checked })} />
                <span className="mt-toggle-track" />
              </label>

              <div className="mt-actions">
                {!t.requiresSchool && (
                  <button className="btn btn-secondary btn-sm"
                    onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                    {expandedId === t.id ? 'Close' : 'Details'}
                  </button>
                )}
                {!t.isBuiltin && (
                  <button className="btn btn-danger btn-sm" onClick={() => deleteType(t.id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>

            {/* ── Expanded detail: description + availability ── */}
            {expandedId === t.id && (
              <div className="mt-detail">
                <div className="mt-detail-field">
                  <label>Description</label>
                  <input type="text" value={t.description}
                    onChange={e => updateField(t.id, { description: e.target.value })}
                    placeholder="Shown to students on the booking page" />
                </div>
                <div className="mt-detail-field">
                  <label>Availability</label>
                  <p className="field-hint">When this meeting type can be booked.</p>
                  <ScheduleBuilder availability={t.availability}
                    onChange={avail => updateField(t.id, { availability: avail })} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Add custom type ── */}
      {!addingNew ? (
        <button className="btn btn-secondary mt-add-btn" onClick={() => setAddingNew(true)}>
          + Add Custom Meeting Type
        </button>
      ) : (
        <div className="mt-new-form">
          <h4>New Meeting Type</h4>
          <div className="mt-new-row">
            <input className="mt-icon-input" value={newType.icon}
              onChange={e => setNewType(n => ({ ...n, icon: e.target.value }))}
              maxLength={4} title="Icon (emoji)" />
            <input className="mt-name-input" value={newType.label}
              onChange={e => setNewType(n => ({ ...n, label: e.target.value }))}
              placeholder="Name *" />
            <select className="mt-duration-select" value={newType.sessionDuration}
              onChange={e => setNewType(n => ({ ...n, sessionDuration: Number(e.target.value) }))}>
              {SESSION_DURATIONS.map(d => (
                <option key={d} value={d}>{durationLabel(d)}</option>
              ))}
            </select>
          </div>
          <div className="mt-detail-field" style={{ marginTop: '0.75rem' }}>
            <label>Description</label>
            <input type="text" value={newType.description}
              onChange={e => setNewType(n => ({ ...n, description: e.target.value }))}
              placeholder="Shown to students on the booking page (optional)" />
          </div>
          <div className="mt-detail-field">
            <label>Availability</label>
            <ScheduleBuilder availability={newType.availability}
              onChange={avail => setNewType(n => ({ ...n, availability: avail }))} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary"
              onClick={() => { setAddingNew(false); setNewType(emptyType()) }}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleAddNew}>
              Add Meeting Type
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
