import { useState, useEffect, useRef } from 'react'

const DAYS = [
  { num: 0, label: 'Sunday' },
  { num: 1, label: 'Monday' },
  { num: 2, label: 'Tuesday' },
  { num: 3, label: 'Wednesday' },
  { num: 4, label: 'Thursday' },
  { num: 5, label: 'Friday' },
  { num: 6, label: 'Saturday' },
]

const SESSION_DURATIONS = [15, 20, 30, 45, 60, 90, 120]

function emptySchool() {
  return {
    id: '',
    name: '',
    address: '',
    sessionDuration: 60,
    availability: {}
  }
}

function generateId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function TimeBlock({ block, onChange, onRemove }) {
  return (
    <div className="time-block-row">
      <input
        type="time"
        value={block.start}
        onChange={e => onChange({ ...block, start: e.target.value })}
      />
      <span className="time-block-to">to</span>
      <input
        type="time"
        value={block.end}
        onChange={e => onChange({ ...block, end: e.target.value })}
      />
      <button type="button" className="remove-block-btn" onClick={onRemove} title="Remove">×</button>
    </div>
  )
}

export default function SchoolForm({ initial, onSave, onCancel, mapsApiKey }) {
  const [school, setSchool] = useState(initial ? { ...initial } : emptySchool())
  const [addressVerified, setAddressVerified] = useState(!!initial?.address)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const addressRef = useRef(null)
  const autocompleteRef = useRef(null)

  // Load Google Maps Places Autocomplete if key is available
  useEffect(() => {
    if (!mapsApiKey || !addressRef.current) return
    if (!window.google?.maps?.places) return

    autocompleteRef.current = new window.google.maps.places.Autocomplete(addressRef.current, {
      types: ['address'],
    })

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace()
      if (place.formatted_address) {
        setSchool(s => ({ ...s, address: place.formatted_address }))
        setAddressVerified(true)
        setVerifyError('')
      }
    })
  }, [mapsApiKey, addressRef.current])

  const handleVerifyAddress = async () => {
    if (!school.address.trim()) {
      setVerifyError('Enter an address first')
      return
    }
    setVerifying(true)
    setVerifyError('')
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(school.address)}&key=${mapsApiKey}`
      )
      const data = await res.json()
      if (data.status === 'OK' && data.results.length > 0) {
        const formatted = data.results[0].formatted_address
        setSchool(s => ({ ...s, address: formatted }))
        setAddressVerified(true)
        setVerifyError('')
      } else {
        setVerifyError('Address not found. Please check and try again.')
        setAddressVerified(false)
      }
    } catch {
      setVerifyError('Could not verify address. Check your Maps API key.')
      setAddressVerified(false)
    } finally {
      setVerifying(false)
    }
  }

  const toggleDay = (dayNum) => {
    setSchool(s => {
      const avail = { ...s.availability }
      if (avail[dayNum]) {
        delete avail[dayNum]
      } else {
        avail[dayNum] = [{ start: '09:00', end: '17:00' }]
      }
      return { ...s, availability: avail }
    })
  }

  const addBlock = (dayNum) => {
    setSchool(s => {
      const blocks = [...(s.availability[dayNum] || [])]
      blocks.push({ start: '09:00', end: '17:00' })
      return { ...s, availability: { ...s.availability, [dayNum]: blocks } }
    })
  }

  const updateBlock = (dayNum, idx, updated) => {
    setSchool(s => {
      const blocks = [...s.availability[dayNum]]
      blocks[idx] = updated
      return { ...s, availability: { ...s.availability, [dayNum]: blocks } }
    })
  }

  const removeBlock = (dayNum, idx) => {
    setSchool(s => {
      const blocks = s.availability[dayNum].filter((_, i) => i !== idx)
      const avail = { ...s.availability }
      if (blocks.length === 0) delete avail[dayNum]
      else avail[dayNum] = blocks
      return { ...s, availability: avail }
    })
  }

  const handleSave = () => {
    if (!school.name.trim()) { alert('School name is required'); return }
    if (!school.address.trim()) { alert('Address is required'); return }
    const finalSchool = {
      ...school,
      id: school.id || generateId(school.name),
    }
    onSave(finalSchool)
  }

  return (
    <div className="school-form">
      <div className="form-group">
        <label>School Name *</label>
        <input
          type="text"
          value={school.name}
          onChange={e => setSchool(s => ({ ...s, name: e.target.value, id: s.id || generateId(e.target.value) }))}
          placeholder="e.g. Lincoln Elementary School"
        />
      </div>

      <div className="form-group">
        <label>Address *</label>
        <div className="address-row">
          <input
            ref={addressRef}
            type="text"
            value={school.address}
            onChange={e => { setSchool(s => ({ ...s, address: e.target.value })); setAddressVerified(false) }}
            placeholder="Start typing an address…"
            className={addressVerified ? 'input-verified' : ''}
          />
          {mapsApiKey && !window.google?.maps?.places && (
            <button type="button" className="verify-btn" onClick={handleVerifyAddress} disabled={verifying}>
              {verifying ? 'Checking…' : 'Verify'}
            </button>
          )}
        </div>
        {addressVerified && <p className="field-hint success">✓ Address verified</p>}
        {verifyError && <p className="field-hint error">{verifyError}</p>}
        {!mapsApiKey && (
          <p className="field-hint">Add GOOGLE_MAPS_API_KEY to .env for address autocomplete</p>
        )}
      </div>

      <div className="form-group">
        <label>Session Length</label>
        <select
          value={school.sessionDuration}
          onChange={e => setSchool(s => ({ ...s, sessionDuration: Number(e.target.value) }))}
        >
          {SESSION_DURATIONS.map(d => (
            <option key={d} value={d}>{d} minutes</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Availability Schedule</label>
        <p className="field-hint">Select which days sessions are available and add time blocks for each day.</p>
        <div className="schedule-builder">
          {DAYS.map(({ num, label }) => {
            const active = !!school.availability[num]
            const blocks = school.availability[num] || []
            return (
              <div key={num} className={`schedule-day ${active ? 'active' : ''}`}>
                <div className="schedule-day-header">
                  <label className="day-toggle">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleDay(num)}
                    />
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
                      <TimeBlock
                        key={idx}
                        block={block}
                        onChange={updated => updateBlock(num, idx, updated)}
                        onRemove={() => removeBlock(num, idx)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={handleSave}>Save School</button>
      </div>
    </div>
  )
}
