import { useState, useEffect } from 'react'
import './Admin.css'

function Admin() {
  const [status, setStatus] = useState({
    connected: false,
    hasStoredTokens: false,
    configured: false,
    loading: true
  })
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('')

  useEffect(() => {
    checkStatus()

    // Check for success/error in URL params
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'true') {
      showMessage('Google Calendar connected successfully!', 'success')
      // Clean URL
      window.history.replaceState({}, '', '/admin')
    } else if (params.get('error')) {
      const error = params.get('error')
      showMessage(`Connection failed: ${error}`, 'error')
      window.history.replaceState({}, '', '/admin')
    }
  }, [])

  const checkStatus = async () => {
    try {
      const response = await fetch('/auth/status')
      const data = await response.json()
      setStatus({ ...data, loading: false })
    } catch (error) {
      console.error('Error checking status:', error)
      setStatus(prev => ({ ...prev, loading: false }))
    }
  }

  const showMessage = (text, type) => {
    setMessage(text)
    setMessageType(type)
    setTimeout(() => {
      setMessage('')
      setMessageType('')
    }, 5000)
  }

  const handleConnect = () => {
    if (!status.configured) {
      showMessage('Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server/.env first', 'error')
      return
    }
    window.location.href = '/auth/google'
  }

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Google Calendar?')) {
      return
    }

    try {
      const response = await fetch('/auth/disconnect', {
        method: 'POST'
      })
      const data = await response.json()

      if (data.success) {
        showMessage('Google Calendar disconnected', 'success')
        checkStatus()
      } else {
        showMessage('Error disconnecting', 'error')
      }
    } catch (error) {
      console.error('Error disconnecting:', error)
      showMessage('Error disconnecting', 'error')
    }
  }

  if (status.loading) {
    return (
      <div className="admin-container">
        <div className="admin-card">
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-container">
      <div className="admin-card">
        <div className="admin-header">
          <h1>Admin Panel</h1>
          <a href="/" className="back-link">← Back to Booking Page</a>
        </div>

        {message && (
          <div className={`message ${messageType}`}>
            {message}
          </div>
        )}

        <div className="status-section">
          <h2>Google Calendar Status</h2>

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
          </div>
        </div>

        <div className="actions-section">
          <h2>Actions</h2>

          {!status.configured && (
            <div className="info-box">
              <h3>Setup Required</h3>
              <p>To connect Google Calendar, you need to:</p>
              <ol>
                <li>Create a project in <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a></li>
                <li>Enable the Google Calendar API</li>
                <li>Create OAuth 2.0 credentials (Web application)</li>
                <li>Add the following redirect URI:
                  <code>{window.location.origin}/auth/google/callback</code>
                </li>
                <li>Add your Client ID and Client Secret to <code>server/.env</code>:
                  <pre>
{`GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=${window.location.origin}/auth/google/callback`}
                  </pre>
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
            <div>
              <p className="success-text">✓ Google Calendar is connected and working!</p>
              <button className="btn btn-danger" onClick={handleDisconnect}>
                Disconnect Google Calendar
              </button>
            </div>
          )}
        </div>

        <div className="info-section">
          <h2>About OAuth Login</h2>
          <p>
            This admin panel allows you to connect your Google Calendar with a simple login flow,
            similar to how Calendly and other booking apps work.
          </p>
          <ul>
            <li><strong>Secure:</strong> Tokens are encrypted and stored locally on your server</li>
            <li><strong>Easy:</strong> No manual token generation required</li>
            <li><strong>Automatic:</strong> Tokens refresh automatically when needed</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Admin
