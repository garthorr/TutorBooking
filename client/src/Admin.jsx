import { useState, useEffect } from 'react'
import SchoolsManager from './components/SchoolsManager'
import './Admin.css'

function Admin() {
  const [tab, setTab] = useState('calendar')
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

  useEffect(() => {
    checkStatus()
    loadPublicConfig()

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

  const loadPublicConfig = async () => {
    try {
      const res = await fetch('/api/config')
      const data = await res.json()
      if (data.googleMapsApiKey) setMapsApiKey(data.googleMapsApiKey)
    } catch {}
  }

  const checkStatus = async () => {
    try {
      const response = await fetch('/auth/status')
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
      const res = await fetch('/api/calendars')
      if (res.ok) setAvailableCalendars(await res.json())
    } catch {}
    setCalendarConfigLoading(false)
  }

  const loadCalendarConfig = async () => {
    try {
      const res = await fetch('/api/config/calendars')
      if (res.ok) setCalendarConfig(await res.json())
    } catch {}
  }

  const saveCalendarConfig = async () => {
    setSavingCalConfig(true)
    try {
      const res = await fetch('/api/config/calendars', {
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
      const res = await fetch('/auth/test')
      const data = await res.json()
      setTestResult(data)
    } catch {
      setTestResult({ success: false, error: 'Network error — could not reach server' })
    } finally {
      setTesting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Google Calendar?')) return
    try {
      const res = await fetch('/auth/disconnect', { method: 'POST' })
      const data = await res.json()
      if (data.success) { showMessage('Google Calendar disconnected', 'success'); checkStatus() }
      else showMessage('Error disconnecting', 'error')
    } catch {
      showMessage('Error disconnecting', 'error')
    }
  }

  if (status.loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>
  }

  return (
    <div className="admin-container">
      <div className="admin-card">
        <div className="admin-header">
          <h1>Admin Panel</h1>
          <a href="/" className="back-link">← Back to Booking Page</a>
        </div>

        {message && <div className={`message ${messageType}`}>{message}</div>}

        {/* Tabs */}
        <div className="admin-tabs">
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

        {/* Schools Tab */}
        {tab === 'schools' && (
          <div className="tab-content">
            <SchoolsManager mapsApiKey={mapsApiKey} />
          </div>
        )}
      </div>
    </div>
  )
}

export default Admin
