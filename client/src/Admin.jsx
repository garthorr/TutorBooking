import { useState, useEffect } from 'react'
import SchoolsManager from './components/SchoolsManager'
import MeetingTypesManager from './components/MeetingTypesManager'
import BookingsManager from './components/BookingsManager'
import EmbedBuilder from './components/EmbedBuilder'
import { adminFetch, clearToken } from './auth'
import { THEME_PRESETS, applyTheme } from './theme'
import './Admin.css'

const SESSION_DURATIONS = Array.from({ length: 36 }, (_, i) => (i + 1) * 5)

function durationLabel(d) {
  if (d < 60) return `${d} min`
  if (d === 60) return '1 hr'
  if (d % 60 === 0) return `${d / 60} hr`
  return `${Math.floor(d / 60)} hr ${d % 60} min`
}

function Admin() {
  const [tab, setTab] = useState('bookings')
  const [status, setStatus] = useState({
    connected: false,
    hasStoredTokens: false,
    hasRefreshToken: false,
    tokenExpiry: null,
    configured: false,
    loading: true
  })
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('')
  const [mapsApiKey, setMapsApiKey] = useState('')
  const [mapsLoaded, setMapsLoaded] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [availableCalendars, setAvailableCalendars] = useState([])
  const [calendarConfig, setCalendarConfig] = useState({ checkCalendars: ['primary'], bookingCalendar: 'primary' })
  const [calendarConfigLoading, setCalendarConfigLoading] = useState(false)
  const [savingCalConfig, setSavingCalConfig] = useState(false)
  // Settings tab
  const [logoPreview, setLogoPreview] = useState(null)
  const [logoSaving, setLogoSaving] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    businessName: '',
    businessDescription: '',
    customLocationDuration: 60,
    themeColor: '#4f46e5'
  })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [customColorInput, setCustomColorInput] = useState('')
  // Change password
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordChanging, setPasswordChanging] = useState(false)

  useEffect(() => {
    checkStatus()
    // Load current logo and settings for the Settings tab
    adminFetch('/api/logo').then(r => r.ok ? r.json() : null).then(d => { if (d?.dataUrl) setLogoPreview(d.dataUrl) }).catch(() => {})
    adminFetch('/api/settings').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return
      const color = d.themeColor || '#4f46e5'
      applyTheme(color)
      setSettingsForm({
        businessName: d.businessName || '',
        businessDescription: d.businessDescription || '',
        customLocationDuration: d.customLocationDuration || 60,
        themeColor: color
      })
      const isPreset = THEME_PRESETS.some(p => p.primary.toLowerCase() === color.toLowerCase())
      if (!isPreset) setCustomColorInput(color)
      if (d.googleMapsApiKey) setMapsApiKey(d.googleMapsApiKey)
    }).catch(() => {})

    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'true') {
      showMessage('Google Calendar connected successfully!', 'success')
      window.history.replaceState({}, '', '/admin')
    } else if (params.get('error')) {
      showMessage(`Connection failed: ${params.get('error')}`, 'error')
      window.history.replaceState({}, '', '/admin')
    }
  }, [])

  // Load Google Maps script once we have the key
  useEffect(() => {
    if (!mapsApiKey || mapsLoaded || window.google?.maps) return
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places`
    script.async = true
    script.onload = () => setMapsLoaded(true)
    document.head.appendChild(script)
  }, [mapsApiKey])

  const checkStatus = async () => {
    try {
      const response = await adminFetch('/auth/status')
      const data = await response.json()
      setStatus({ ...data, loading: false })
      if (data.connected) {
        loadCalendarList()
        loadCalendarConfig()
      }
    } catch {
      setStatus(prev => ({ ...prev, loading: false }))
    }
  }

  const loadCalendarList = async () => {
    setCalendarConfigLoading(true)
    try {
      const res = await adminFetch('/api/calendars')
      if (res.ok) setAvailableCalendars(await res.json())
    } catch {}
    setCalendarConfigLoading(false)
  }

  const loadCalendarConfig = async () => {
    try {
      const res = await adminFetch('/api/config/calendars')
      if (res.ok) setCalendarConfig(await res.json())
    } catch {}
  }

  const saveCalendarConfig = async () => {
    setSavingCalConfig(true)
    try {
      const res = await adminFetch('/api/config/calendars', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calendarConfig)
      })
      const data = await res.json()
      if (data.success) showMessage('Calendar settings saved!', 'success')
      else showMessage(data.error || 'Failed to save calendar settings', 'error')
    } catch {
      showMessage('Error saving calendar settings', 'error')
    }
    setSavingCalConfig(false)
  }

  const toggleCheckCalendar = (id) => {
    setCalendarConfig(prev => {
      const already = prev.checkCalendars.includes(id)
      const next = already
        ? prev.checkCalendars.filter(c => c !== id)
        : [...prev.checkCalendars, id]
      // Always keep at least one
      return { ...prev, checkCalendars: next.length > 0 ? next : [id] }
    })
  }

  const showMessage = (text, type) => {
    setMessage(text)
    setMessageType(type)
    setTimeout(() => { setMessage(''); setMessageType('') }, 5000)
  }

  const handleSettingsSave = async () => {
    setSettingsSaving(true)
    try {
      const res = await adminFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm)
      })
      const data = await res.json()
      if (data.success) {
        applyTheme(settingsForm.themeColor)
        showMessage('Settings saved!', 'success')
      } else {
        showMessage(data.error || 'Failed to save settings', 'error')
      }
    } catch { showMessage('Error saving settings', 'error') }
    setSettingsSaving(false)
  }

  const handleThemePresetSelect = (primary) => {
    setSettingsForm(f => ({ ...f, themeColor: primary }))
    setCustomColorInput('')
    applyTheme(primary)
  }

  const handleCustomColorChange = (val) => {
    setCustomColorInput(val)
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      setSettingsForm(f => ({ ...f, themeColor: val }))
      applyTheme(val)
    }
  }

  const handleLogoChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleLogoSave = async () => {
    if (!logoPreview) return
    setLogoSaving(true)
    try {
      const res = await adminFetch('/api/logo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: logoPreview })
      })
      const data = await res.json()
      if (data.success) showMessage('Logo saved!', 'success')
      else showMessage('Failed to save logo', 'error')
    } catch { showMessage('Error saving logo', 'error') }
    setLogoSaving(false)
  }

  const handleLogoRemove = async () => {
    try {
      await adminFetch('/api/logo', { method: 'DELETE' })
      setLogoPreview(null)
      showMessage('Logo removed', 'success')
    } catch { showMessage('Error removing logo', 'error') }
  }

  const handleConnect = () => {
    if (!status.configured) {
      showMessage('Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server/.env first', 'error')
      return
    }
    window.location.href = '/auth/google'
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await adminFetch('/auth/test')
      const data = await res.json()
      setTestResult(data)
    } catch {
      setTestResult({ success: false, error: 'Network error — could not reach server' })
    } finally {
      setTesting(false)
    }
  }

  const handleLogout = () => {
    clearToken()
    window.location.reload()
  }

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Google Calendar?')) return
    try {
      const res = await adminFetch('/auth/disconnect', { method: 'POST' })
      const data = await res.json()
      if (data.success) { showMessage('Google Calendar disconnected', 'success'); checkStatus() }
      else showMessage('Error disconnecting', 'error')
    } catch {
      showMessage('Error disconnecting', 'error')
    }
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showMessage('New passwords do not match', 'error')
      return
    }

    if (passwordForm.newPassword.length < 8) {
      showMessage('New password must be at least 8 characters', 'error')
      return
    }

    setPasswordChanging(true)
    try {
      const res = await adminFetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      })
      const data = await res.json()

      if (data.success) {
        showMessage('Password changed successfully!', 'success')
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      } else {
        showMessage(data.error || 'Failed to change password', 'error')
      }
    } catch {
      showMessage('Error changing password', 'error')
    }
    setPasswordChanging(false)
  }

  if (status.loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>
  }

  return (
    <div className="admin-container">
      <div className="admin-card">
        <div className="admin-header">
          <h1>Booking Management</h1>
          <div className="admin-header-actions">
            <a href="/" className="back-link">← Back to Booking Page</a>
            <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Log out</button>
          </div>
        </div>

        {message && <div className={`message ${messageType}`}>{message}</div>}

        {/* Tabs */}
        <div className="admin-tabs">
          <button
            className={`admin-tab ${tab === 'bookings' ? 'active' : ''}`}
            onClick={() => setTab('bookings')}
          >
            Bookings
          </button>
          <button
            className={`admin-tab ${tab === 'calendar' ? 'active' : ''}`}
            onClick={() => setTab('calendar')}
          >
            Google Calendar
          </button>
          <button
            className={`admin-tab ${tab === 'schools' ? 'active' : ''}`}
            onClick={() => setTab('schools')}
          >
            Schools
          </button>
          <button
            className={`admin-tab ${tab === 'meeting-types' ? 'active' : ''}`}
            onClick={() => setTab('meeting-types')}
          >
            Meeting Types
          </button>
          <button
            className={`admin-tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            Settings
          </button>
          <button
            className={`admin-tab ${tab === 'embed' ? 'active' : ''}`}
            onClick={() => setTab('embed')}
          >
            Embed
          </button>
        </div>

        {/* Google Calendar Tab */}
        {tab === 'calendar' && (
          <div className="tab-content">
            <div className="status-section">
              <h2>Connection Status</h2>
              <div className="status-grid">
                <div className="status-item">
                  <span className="status-label">OAuth Configured:</span>
                  <span className={`status-badge ${status.configured ? 'success' : 'error'}`}>
                    {status.configured ? '✓ Yes' : '✗ No'}
                  </span>
                </div>
                <div className="status-item">
                  <span className="status-label">Connection Status:</span>
                  <span className={`status-badge ${status.connected ? 'success' : 'error'}`}>
                    {status.connected ? '✓ Connected' : '✗ Not Connected'}
                  </span>
                </div>
                <div className="status-item">
                  <span className="status-label">Stored Tokens:</span>
                  <span className={`status-badge ${status.hasStoredTokens ? 'success' : 'error'}`}>
                    {status.hasStoredTokens ? '✓ Yes' : '✗ No'}
                  </span>
                </div>
                <div className="status-item">
                  <span className="status-label">Refresh Token:</span>
                  <span className={`status-badge ${status.hasRefreshToken ? 'success' : 'error'}`}>
                    {status.hasRefreshToken ? '✓ Yes' : '✗ No'}
                  </span>
                </div>
                {status.tokenExpiry && (
                  <div className="status-item">
                    <span className="status-label">Token Expires:</span>
                    <span className={`status-badge ${new Date(status.tokenExpiry) < new Date() ? 'error' : ''}`}>
                      {new Date(status.tokenExpiry) < new Date()
                        ? `Expired ${new Date(status.tokenExpiry).toLocaleString()}`
                        : new Date(status.tokenExpiry).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {status.hasStoredTokens && !status.hasRefreshToken && (
                <div className="info-box" style={{ marginTop: '1rem', borderColor: '#f59e0b', background: '#fffbeb' }}>
                  <strong>No refresh token found.</strong> Calendar access will stop working once the
                  current access token expires (within ~1 hour). Click <em>Reconnect Google Calendar</em> below
                  to get a permanent refresh token.
                </div>
              )}
            </div>

            <div className="actions-section">
              <h2>Actions</h2>

              {!status.configured && (
                <div className="info-box">
                  <h3>Setup Required</h3>
                  <p>To connect Google Calendar:</p>
                  <ol>
                    <li>Create a project in <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a></li>
                    <li>Enable the Google Calendar API</li>
                    <li>Create OAuth 2.0 credentials (Web application)</li>
                    <li>Add this redirect URI: <code>{window.location.origin}/auth/google/callback</code></li>
                    <li>Add to <code>server/.env</code>:
                      <pre>{`GOOGLE_CLIENT_ID=your_client_id\nGOOGLE_CLIENT_SECRET=your_client_secret\nGOOGLE_REDIRECT_URI=${window.location.origin}/auth/google/callback`}</pre>
                    </li>
                    <li>Restart the server</li>
                  </ol>
                </div>
              )}

              {status.configured && !status.connected && (
                <button className="btn btn-primary" onClick={handleConnect}>
                  Connect Google Calendar
                </button>
              )}

              {status.connected && (
                <div className="connected-actions">
                  <div className="connected-actions-row">
                    <button className="btn btn-secondary" onClick={handleTest} disabled={testing}>
                      {testing ? 'Testing…' : 'Test Calendar API'}
                    </button>
                    <button className="btn btn-primary" onClick={handleConnect}>
                      Reconnect Google Calendar
                    </button>
                    <button className="btn btn-danger" onClick={handleDisconnect}>
                      Disconnect
                    </button>
                  </div>

                  {testResult && (
                    <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                      {testResult.success ? (
                        <>
                          <strong>✓ API working.</strong> {testResult.message}
                          {testResult.primaryCalendar && <span> Calendar: <em>{testResult.primaryCalendar}</em></span>}
                        </>
                      ) : (
                        <>
                          <strong>✗ API call failed.</strong> {testResult.error}
                          {testResult.code && <span> (code: {testResult.code})</span>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Calendar selection — only shown when connected and calendars loaded */}
            {status.connected && (
              <div className="calendar-picker-section">
                <h2>Calendar Settings</h2>
                <p className="calendar-picker-desc">
                  Choose which calendars to check when determining availability, and which calendar
                  new bookings are added to.
                </p>

                {calendarConfigLoading ? (
                  <p className="cal-loading">Loading calendars…</p>
                ) : availableCalendars.length === 0 ? (
                  <p className="cal-empty">No calendars found. Make sure the Google Calendar API is enabled and the account has calendars.</p>
                ) : (
                  <>
                    <div className="cal-table">
                      <div className="cal-table-header">
                        <span>Calendar</span>
                        <span className="cal-col-center">Check Availability</span>
                        <span className="cal-col-center">Add Bookings To</span>
                      </div>

                      {availableCalendars.map(cal => (
                        <div key={cal.id} className="cal-table-row">
                          <div className="cal-name">
                            {cal.backgroundColor && (
                              <span
                                className="cal-dot"
                                style={{ background: cal.backgroundColor }}
                              />
                            )}
                            <span>{cal.summary}</span>
                            {cal.primary && <span className="cal-badge">primary</span>}
                          </div>

                          <div className="cal-col-center">
                            <input
                              type="checkbox"
                              checked={calendarConfig.checkCalendars.includes(cal.id)}
                              onChange={() => toggleCheckCalendar(cal.id)}
                            />
                          </div>

                          <div className="cal-col-center">
                            <input
                              type="radio"
                              name="bookingCalendar"
                              checked={calendarConfig.bookingCalendar === cal.id}
                              onChange={() => setCalendarConfig(prev => ({ ...prev, bookingCalendar: cal.id }))}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={saveCalendarConfig}
                      disabled={savingCalConfig}
                      style={{ marginTop: '1rem' }}
                    >
                      {savingCalConfig ? 'Saving…' : 'Save Calendar Settings'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bookings Tab */}
        {tab === 'bookings' && (
          <div className="tab-content">
            <BookingsManager />
          </div>
        )}

        {/* Meeting Types Tab */}
        {tab === 'meeting-types' && (
          <div className="tab-content">
            <MeetingTypesManager />
          </div>
        )}

        {/* Schools Tab */}
        {tab === 'schools' && (
          <div className="tab-content">
            <SchoolsManager mapsApiKey={mapsApiKey} mapsLoaded={mapsLoaded} />
          </div>
        )}

        {/* Settings Tab */}
        {tab === 'settings' && (
          <div className="tab-content">

            {/* Logo */}
            <div className="settings-section">
              <h2>Booking Page Logo</h2>
              <p className="field-hint">Displayed at the top of the booking page. PNG or SVG recommended, max ~2 MB.</p>

              {logoPreview && (
                <div className="logo-preview">
                  <img src={logoPreview} alt="Logo preview" />
                </div>
              )}

              <div className="logo-actions">
                <label className="btn btn-secondary logo-file-label">
                  {logoPreview ? 'Change Logo' : 'Choose Logo'}
                  <input type="file" accept="image/*" onChange={handleLogoChange} style={{ display: 'none' }} />
                </label>
                {logoPreview && (
                  <>
                    <button className="btn btn-primary" onClick={handleLogoSave} disabled={logoSaving}>
                      {logoSaving ? 'Saving…' : 'Save Logo'}
                    </button>
                    <button className="btn btn-danger" onClick={handleLogoRemove}>
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Booking page header text */}
            <div className="settings-section">
              <h2>Booking Page Header</h2>
              <p className="field-hint">Text shown at the top of the booking page. Leave blank to use the built-in defaults.</p>
              <div className="settings-field">
                <label>Business / Tutor Name</label>
                <input
                  type="text"
                  value={settingsForm.businessName}
                  onChange={e => setSettingsForm(f => ({ ...f, businessName: e.target.value }))}
                  placeholder="e.g. EducatOrr"
                />
              </div>
              <div className="settings-field">
                <label>Tagline / Description</label>
                <input
                  type="text"
                  value={settingsForm.businessDescription}
                  onChange={e => setSettingsForm(f => ({ ...f, businessDescription: e.target.value }))}
                  placeholder="e.g. Schedule your tutoring session in just a few steps"
                />
              </div>
            </div>

            {/* Other location session length */}
            <div className="settings-section">
              <h2>Other Location Session Length</h2>
              <p className="field-hint">Session duration used when a student selects &ldquo;Other Location&rdquo;.</p>
              <div className="settings-field settings-field-inline">
                <label>Duration</label>
                <select
                  value={settingsForm.customLocationDuration}
                  onChange={e => setSettingsForm(f => ({ ...f, customLocationDuration: Number(e.target.value) }))}
                >
                  {SESSION_DURATIONS.map(d => (
                    <option key={d} value={d}>{durationLabel(d)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Color theme */}
            <div className="settings-section">
              <h2>Color Theme</h2>
              <p className="field-hint">Choose a preset or enter a custom hex color for buttons, selected states, and accents.</p>
              <div className="theme-swatches">
                {THEME_PRESETS.map(p => (
                  <button
                    key={p.id}
                    className={`theme-swatch ${settingsForm.themeColor.toLowerCase() === p.primary.toLowerCase() ? 'theme-swatch-active' : ''}`}
                    style={{ '--swatch-color': p.primary }}
                    onClick={() => handleThemePresetSelect(p.primary)}
                    title={p.label}
                  >
                    <span className="theme-swatch-dot" />
                    <span className="theme-swatch-label">{p.label}</span>
                  </button>
                ))}
                <button
                  className={`theme-swatch ${!THEME_PRESETS.some(p => p.primary.toLowerCase() === settingsForm.themeColor.toLowerCase()) ? 'theme-swatch-active' : ''}`}
                  style={{ '--swatch-color': customColorInput || settingsForm.themeColor }}
                  onClick={() => {}}
                  title="Custom"
                >
                  <span className="theme-swatch-dot" />
                  <span className="theme-swatch-label">Custom</span>
                </button>
              </div>
              <div className="theme-custom-row">
                <label>Custom hex</label>
                <input
                  type="text"
                  className="theme-hex-input"
                  value={customColorInput}
                  onChange={e => handleCustomColorChange(e.target.value)}
                  placeholder="#4f46e5"
                  maxLength={7}
                />
                <span className="theme-hex-preview" style={{ background: /^#[0-9a-fA-F]{6}$/.test(customColorInput) ? customColorInput : 'transparent' }} />
              </div>
            </div>

            <button className="btn btn-primary" onClick={handleSettingsSave} disabled={settingsSaving}>
              {settingsSaving ? 'Saving…' : 'Save Settings'}
            </button>

            {/* Change Password */}
            <div className="settings-section" style={{ marginTop: '2rem', borderTop: '1px solid #e5e7eb', paddingTop: '2rem' }}>
              <h2>Change Admin Password</h2>
              <p className="field-hint">Update your admin password. Requires at least 8 characters.</p>

              <form onSubmit={handlePasswordChange}>
                <div className="settings-field">
                  <label>Current Password</label>
                  <input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={e => setPasswordForm(f => ({ ...f, currentPassword: e.target.value }))}
                    required
                    autoComplete="current-password"
                  />
                </div>

                <div className="settings-field">
                  <label>New Password</label>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={e => setPasswordForm(f => ({ ...f, newPassword: e.target.value }))}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>

                <div className="settings-field">
                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={e => setPasswordForm(f => ({ ...f, confirmPassword: e.target.value }))}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>

                <button className="btn btn-primary" type="submit" disabled={passwordChanging}>
                  {passwordChanging ? 'Changing…' : 'Change Password'}
                </button>
              </form>
            </div>

          </div>
        )}

        {/* Embed Tab */}
        {tab === 'embed' && (
          <div className="tab-content">
            <EmbedBuilder />
          </div>
        )}
      </div>
    </div>
  )
}

export default Admin
