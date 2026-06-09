import { useEffect, useRef } from 'react'

/*
 * Renders a Cloudflare Turnstile or hCaptcha widget and reports the solved
 * token back via onToken(). The provider + site key are supplied by the server
 * (/api/config); when CAPTCHA is not configured this component is never
 * rendered, so the booking flow works unchanged.
 */

const SCRIPTS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit'
}

// Load a provider script once, returning a promise that resolves when its
// global API object is available.
function loadScript(provider) {
  const globalName = provider === 'hcaptcha' ? 'hcaptcha' : 'turnstile'
  if (window[globalName]) return Promise.resolve(window[globalName])

  const src = SCRIPTS[provider]
  let promise = loadScript._cache?.[src]
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`)
      const onReady = () => resolve(window[globalName])
      if (existing) {
        existing.addEventListener('load', onReady)
        existing.addEventListener('error', reject)
        return
      }
      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.defer = true
      script.onload = onReady
      script.onerror = reject
      document.head.appendChild(script)
    })
    loadScript._cache = { ...(loadScript._cache || {}), [src]: promise }
  }
  return promise
}

export default function Captcha({ provider, siteKey, onToken }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    if (!provider || !siteKey) return
    let cancelled = false

    loadScript(provider)
      .then(api => {
        if (cancelled || !api || !containerRef.current) return
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          callback: token => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken('')
        })
      })
      .catch(() => { /* network/script failure — booking submit will be blocked */ })

    return () => {
      cancelled = true
      const api = window[provider === 'hcaptcha' ? 'hcaptcha' : 'turnstile']
      if (api?.remove && widgetIdRef.current != null) {
        try { api.remove(widgetIdRef.current) } catch { /* ignore */ }
      }
    }
  }, [provider, siteKey])

  return <div ref={containerRef} className="captcha-widget" style={{ margin: '8px 0' }} />
}
