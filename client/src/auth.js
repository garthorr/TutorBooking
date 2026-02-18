export function getToken() {
  return localStorage.getItem('adminToken')
}

export function clearToken() {
  localStorage.removeItem('adminToken')
}

export function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Drop-in replacement for fetch() that attaches the admin JWT and handles
// automatic logout when the token is rejected by the server.
export async function adminFetch(url, options = {}) {
  const token = getToken()
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  if (res.status === 401) {
    clearToken()
    window.location.reload()
  }
  return res
}
