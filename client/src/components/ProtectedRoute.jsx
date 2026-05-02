import { useState, useEffect } from 'react'
import Login from '../Login'

function ProtectedRoute({ children }) {
  const [state, setState] = useState('checking') // 'checking' | 'authed' | 'unauthed'

  useEffect(() => {
    fetch('/auth/admin/verify', { credentials: 'include' })
      .then(r => setState(r.ok ? 'authed' : 'unauthed'))
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
