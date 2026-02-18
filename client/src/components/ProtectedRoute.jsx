import { useState, useEffect } from 'react'
import Login from '../Login'
import { getToken, clearToken } from '../auth'

function ProtectedRoute({ children }) {
  const [state, setState] = useState('checking') // 'checking' | 'authed' | 'unauthed'

  useEffect(() => {
    const token = getToken()
    if (!token) { setState('unauthed'); return }
    fetch('/auth/admin/verify', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (r.ok) {
          setState('authed')
        } else {
          clearToken()
          setState('unauthed')
        }
      })
      .catch(() => setState('unauthed'))
  }, [])

  if (state === 'checking') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
        Checking authentication…
      </div>
    )
  }

  if (state === 'unauthed') {
    return <Login onLogin={() => setState('authed')} />
  }

  return children
}

export default ProtectedRoute
