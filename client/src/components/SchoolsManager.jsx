import { useState, useEffect } from 'react'
import SchoolForm from './SchoolForm'
import { adminFetch } from '../auth'

const DAYS = [
  { num: 0, label: 'Sun' }, { num: 1, label: 'Mon' }, { num: 2, label: 'Tue' },
  { num: 3, label: 'Wed' }, { num: 4, label: 'Thu' }, { num: 5, label: 'Fri' },
  { num: 6, label: 'Sat' },
]

function formatSchedule(availability) {
  const active = Object.entries(availability || {})
    .filter(([, blocks]) => blocks.length > 0)
    .map(([day, blocks]) => {
      const label = DAYS.find(d => d.num === Number(day))?.label || day
      const times = blocks.map(b => `${b.start}–${b.end}`).join(', ')
      return `${label}: ${times}`
    })
  return active.length ? active.join(' | ') : 'No availability set'
}

export default function SchoolsManager({ mapsApiKey, mapsLoaded }) {
  const [schools, setSchools] = useState([])
  const [driveTimes, setDriveTimes] = useState({})
  const [editing, setEditing] = useState(null)  // null | 'new' | school object
  const [saving, setSaving] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [schoolsRes, dtRes] = await Promise.all([
        fetch('/api/schools'),        // public endpoint
        adminFetch('/api/drivetimes') // admin only
      ])
      const schoolsData = await schoolsRes.json()
      const dtData = await dtRes.json()
      if (Array.isArray(schoolsData)) setSchools(schoolsData)
      if (typeof dtData === 'object') setDriveTimes(dtData)
    } catch (err) {
      showMessage('Failed to load configuration', 'error')
    }
  }

  const showMessage = (text, type) => {
    setMessage({ text, type })
    setTimeout(() => setMessage({ text: '', type: '' }), 4000)
  }

  const saveSchools = async (updated) => {
    setSaving(true)
    try {
      const res = await adminFetch('/api/schools', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (res.ok) {
        setSchools(updated)
        showMessage('Schools saved', 'success')
      } else {
        showMessage('Failed to save schools', 'error')
      }
    } catch {
      showMessage('Failed to save schools', 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveDriveTimes = async (updated) => {
    setSaving(true)
    try {
      const res = await adminFetch('/api/drivetimes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (res.ok) {
        setDriveTimes(updated)
        showMessage('Drive times saved', 'success')
      } else {
        showMessage('Failed to save drive times', 'error')
      }
    } catch {
      showMessage('Failed to save drive times', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSchoolSave = (school) => {
    let updated
    if (editing === 'new') {
      updated = [...schools, school]
    } else {
      updated = schools.map(s => s.id === school.id ? school : s)
    }
    setEditing(null)
    saveSchools(updated)
  }

  const handleDelete = (id) => {
    if (!confirm('Delete this school? This cannot be undone.')) return
    const updated = schools.filter(s => s.id !== id)
    // Also remove drive time entries for this school
    const dt = { ...driveTimes }
    delete dt[id]
    Object.keys(dt).forEach(k => { delete dt[k][id] })
    saveSchools(updated)
    saveDriveTimes(dt)
  }

  const handleDriveTimeChange = (fromId, toId, value) => {
    const mins = parseInt(value, 10)
    setDriveTimes(prev => ({
      ...prev,
      [fromId]: {
        ...(prev[fromId] || {}),
        [toId]: isNaN(mins) ? 0 : mins,
      }
    }))
  }

  const handleSaveDriveTimes = () => {
    saveDriveTimes(driveTimes)
  }

  const handleCalculateDriveTimes = async () => {
    setCalculating(true)
    try {
      const res = await adminFetch('/api/drivetimes/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schools.map(s => ({ id: s.id, address: s.address })))
      })
      const data = await res.json()
      if (res.ok) {
        setDriveTimes(data.driveTimes)
        showMessage('Drive times calculated — review and save when ready.', 'success')
      } else {
        showMessage(data.error || 'Calculation failed', 'error')
      }
    } catch {
      showMessage('Network error during calculation', 'error')
    } finally {
      setCalculating(false)
    }
  }

  if (editing !== null) {
    return (
      <div>
        <h3>{editing === 'new' ? 'Add School' : `Edit: ${editing.name}`}</h3>
        <SchoolForm
          initial={editing === 'new' ? null : editing}
          onSave={handleSchoolSave}
          onCancel={() => setEditing(null)}
          mapsApiKey={mapsApiKey}
          mapsLoaded={mapsLoaded}
        />
      </div>
    )
  }

  return (
    <div className="schools-manager">
      {message.text && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      {/* Schools List */}
      <div className="section-header">
        <h3>Schools</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          + Add School
        </button>
      </div>

      {schools.length === 0 ? (
        <div className="empty-state">
          <p>No schools configured yet. Add your first school to get started.</p>
        </div>
      ) : (
        <div className="schools-list">
          {schools.map(school => (
            <div key={school.id} className="school-card">
              <div className="school-card-info">
                <h4>{school.name}</h4>
                <p className="school-address">{school.address}</p>
                <p className="school-meta">
                  <strong>{school.sessionDuration} min</strong> sessions
                </p>
                <p className="school-schedule">{formatSchedule(school.availability)}</p>
              </div>
              <div className="school-card-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(school)}>
                  Edit
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(school.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drive Times Matrix */}
      {schools.length >= 2 && (
        <div className="drive-times-section">
          <div className="section-header">
            <h3>Drive Times Between Schools</h3>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleCalculateDriveTimes}
              disabled={calculating}
              title="Calculate drive times from school addresses using Google Maps"
            >
              {calculating ? 'Calculating…' : 'Calculate from Addresses'}
            </button>
          </div>
          <p className="field-hint">
            Actual driving time in minutes between each pair of schools — the system adds 5 min for parking/walking and rounds to the nearest 5.
            Use <strong>Calculate from Addresses</strong> to auto-fill using Google Maps (requires Maps API key), then save.
          </p>
          <div className="drive-times-table-wrap">
            <table className="drive-times-table">
              <thead>
                <tr>
                  <th>From \ To</th>
                  {schools.map(s => <th key={s.id}>{s.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {schools.map(from => (
                  <tr key={from.id}>
                    <td className="row-label">{from.name}</td>
                    {schools.map(to => (
                      <td key={to.id}>
                        {from.id === to.id ? (
                          <span className="same-school">—</span>
                        ) : (
                          <div className="drive-time-cell">
                            <input
                              type="number"
                              min="0"
                              max="180"
                              value={driveTimes[from.id]?.[to.id] ?? ''}
                              onChange={e => handleDriveTimeChange(from.id, to.id, e.target.value)}
                              placeholder="0"
                            />
                            <span className="drive-time-unit">min</span>
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSaveDriveTimes}
            disabled={saving}
            style={{ marginTop: '1rem' }}
          >
            {saving ? 'Saving…' : 'Save Drive Times'}
          </button>
        </div>
      )}
    </div>
  )
}
