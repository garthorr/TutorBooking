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

// Session durations: 5-minute increments from 5 to 180 minutes
const SESSION_DURATIONS = Array.from({ length: 36 }, (_, i) => (i + 1) * 5)

function emptySchool() {
  return {
    id: '',
    name: '',
    address: '',
    sessionDuration: 60,
    availability: {},
    logoUrl: null
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
      <input
        type="text"
        className="block-name-input"
        value={block.name || ''}
        onChange={e => onChange({ ...block, name: e.target.value })}
        placeholder="Period (optional)"
        title="Optional period name shown to students, e.g. A2a"
      />
      <button type="button" className="remove-block-btn" onClick={onRemove} title="Remove">×</button>
    </div>
  )
}

export default function SchoolForm({ initial, onSave, onCancel, mapsApiKey, mapsLoaded }) {
  const [school, setSchool] = useState(initial ? { ...initial } : emptySchool())
  const [addressVerified, setAddressVerified] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [copyMenuDay, setCopyMenuDay] = useState(null)
  const [copyTargets, setCopyTargets] = useState([])
  const [usePlaceElement, setUsePlaceElement] = useState(false)
  const containerRef = useRef(null)
  const autocompleteRef = useRef(null)
  const selectingPlaceRef = useRef(false)

  // Initialise PlaceAutocompleteElement (new Places API, replaces deprecated Autocomplete)
  useEffect(() => {
    if (!mapsApiKey || !containerRef.current) return
    if (!window.google?.maps?.places?.PlaceAutocompleteElement) return

    let element
    try {
      element = new window.google.maps.places.PlaceAutocompleteElement({ types: ['address'] })
    } catch (e) {
      console.warn('PlaceAutocompleteElement failed to initialise:', e.message)
      return
    }

    containerRef.current.appendChild(element)
    autocompleteRef.current = element
    setUsePlaceElement(true)

    // Pre-populate existing address when editing a school
    const syncInternalValue = () => {
      if (element && school.address && !element.value) {
        element.value = school.address
      }
    }

    // Try a few times as the internal input might take a moment to be ready
    requestAnimationFrame(syncInternalValue)
    const timeoutId = setTimeout(syncInternalValue, 500)
    const timeoutId2 = setTimeout(syncInternalValue, 2000)

    const handlePlaceSelect = async (event) => {
      selectingPlaceRef.current = true
      try {
        await event.place.fetchFields({ fields: ['formattedAddress'] })
        const addr = event.place.formattedAddress
        if (addr) {
          element.value = addr
          setSchool(s => ({ ...s, address: addr }))
          setAddressVerified(true)
          setVerifyError('')
          return
        }
        setVerifyError('Could not retrieve formatted address. Please try again.')
        setAddressVerified(false)
      } catch (e) {
        console.warn('fetchFields failed:', e.message)
        setVerifyError('Could not retrieve formatted address. Please try again.')
        setAddressVerified(false)
      } finally {
        // Give the autocomplete element a moment to settle any trailing
        // input events triggered by the selection before re-enabling typing sync.
        setTimeout(() => { selectingPlaceRef.current = false }, 150)
      }
    }

    const handleInput = (event) => {
      // Ignore input events fired as a side-effect of selecting a place from
      // the dropdown; otherwise the partial typed text would overwrite the
      // formatted address resolved via fetchFields.
      if (selectingPlaceRef.current) return
      if (event.isTrusted) {
        const value = event.target.value ?? ''
        setSchool(s => ({ ...s, address: value }))
        setAddressVerified(false)
      }
    }

    element.addEventListener('gmp-placeselect', handlePlaceSelect)
    element.addEventListener('input', handleInput)

    return () => {
      clearTimeout(timeoutId)
      clearTimeout(timeoutId2)
      element.removeEventListener('gmp-placeselect', handlePlaceSelect)
      element.removeEventListener('input', handleInput)
      element.remove()
      autocompleteRef.current = null
      setUsePlaceElement(false)
    }
  }, [mapsApiKey, mapsLoaded])

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

  const openCopyMenu = (dayNum) => {
    setCopyMenuDay(dayNum)
    setCopyTargets([])
  }

  const applyCopy = (fromDay) => {
    const sourceBlocks = school.availability[fromDay] || []
    setSchool(s => {
      const avail = { ...s.availability }
      copyTargets.forEach(d => { avail[d] = sourceBlocks.map(b => ({ ...b })) })
      return { ...s, availability: avail }
    })
    setCopyMenuDay(null)
    setCopyTargets([])
  }

  const handleSave = () => {
    if (!school.name.trim()) { alert('School name is required'); return }

    // State is the source of truth — it holds the formatted address resolved
    // via fetchFields. Only fall back to the element's raw value if state is
    // empty (e.g. user typed something but never selected a suggestion).
    let finalAddress = school.address
    if (!finalAddress && usePlaceElement && autocompleteRef.current) {
      finalAddress = autocompleteRef.current.value || ''
    }

    if (!finalAddress.trim()) { alert('Address is required'); return }

    const finalSchool = {
      ...school,
      address: finalAddress.trim(),
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
        {usePlaceElement && school.address && (
          <p className="field-hint current-address">Current: {school.address}</p>
        )}
        <div className="address-row">
          {/* PlaceAutocompleteElement mounts here when the new Places API is available */}
          <div
            ref={containerRef}
            className={`place-autocomplete-container${usePlaceElement ? '' : ' hidden'}${addressVerified ? ' input-verified' : ''}`}
          />
          {!usePlaceElement && (
            <input
              type="text"
              defaultValue={school.address}
              onChange={e => { setSchool(s => ({ ...s, address: e.target.value })); setAddressVerified(false) }}
              placeholder="Start typing an address…"
              className={addressVerified ? 'input-verified' : ''}
              autoComplete="off"
            />
          )}
          {mapsApiKey && !usePlaceElement && (
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
          {SESSION_DURATIONS.map(d => {
            const label = d < 60
              ? `${d} min`
              : d === 60
                ? '1 hr'
                : d % 60 === 0
                  ? `${d / 60} hr`
                  : `${Math.floor(d / 60)} hr ${d % 60} min`
            return <option key={d} value={d}>{label}</option>
          })}
        </select>
      </div>

      <div className="form-group">
        <label>School Logo (optional)</label>
        <p className="field-hint">Shown as a tile image on the booking page. PNG or SVG recommended, transparent background ideal.</p>
        {school.logoUrl && (
          <div className="school-logo-preview">
            <img src={school.logoUrl} alt="Logo preview" />
          </div>
        )}
        <div className="logo-actions">
          <label className="btn btn-secondary logo-file-label">
            {school.logoUrl ? 'Change Logo' : 'Upload Logo'}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = ev => setSchool(s => ({ ...s, logoUrl: ev.target.result }))
                reader.readAsDataURL(file)
              }}
            />
          </label>
          {school.logoUrl && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setSchool(s => ({ ...s, logoUrl: null }))}
            >
              Remove
            </button>
          )}
        </div>
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
                    <div className="day-header-actions">
                      <button type="button" className="add-block-btn" onClick={() => addBlock(num)}>
                        + Add Block
                      </button>
                      <button
                        type="button"
                        className="copy-day-btn"
                        onClick={() => copyMenuDay === num ? setCopyMenuDay(null) : openCopyMenu(num)}
                        title="Copy schedule to another day"
                      >
                        Copy to…
                      </button>
                    </div>
                  )}
                </div>

                {active && copyMenuDay === num && (
                  <div className="copy-menu">
                    <span className="copy-menu-label">Copy to:</span>
                    {DAYS.filter(d => d.num !== num).map(d => (
                      <label key={d.num} className="copy-menu-day">
                        <input
                          type="checkbox"
                          checked={copyTargets.includes(d.num)}
                          onChange={() => setCopyTargets(prev =>
                            prev.includes(d.num) ? prev.filter(x => x !== d.num) : [...prev, d.num]
                          )}
                        />
                        {d.label}
                      </label>
                    ))}
                    <button
                      type="button"
                      className="btn btn-primary copy-apply-btn"
                      disabled={copyTargets.length === 0}
                      onClick={() => applyCopy(num)}
                    >
                      Apply
                    </button>
                    <button type="button" className="btn btn-secondary copy-apply-btn" onClick={() => setCopyMenuDay(null)}>
                      Cancel
                    </button>
                  </div>
                )}

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
