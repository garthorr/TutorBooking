// Drop-in replacement for fetch() that sends the admin session cookie and
// reloads the page on 401 so the login form is shown.
export async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: { ...(options.headers || {}) }
  })
  if (res.status === 401) {
    window.location.reload()
  }
  return res
}
