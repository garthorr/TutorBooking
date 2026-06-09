/*
 * Optional CAPTCHA verification for the public booking endpoint.
 *
 * Supports Cloudflare Turnstile and hCaptcha, selected via env vars. Entirely
 * no-op (verification always passes, no widget advertised to the client) unless
 * a secret + site key are configured, so local development and the existing
 * deploy keep working without a CAPTCHA provider.
 *
 *   CAPTCHA_PROVIDER   "turnstile" (default) | "hcaptcha"
 *   CAPTCHA_SITE_KEY   public site key, served to the client
 *   CAPTCHA_SECRET_KEY private secret, used server-side to verify tokens
 */

const PROVIDERS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify'
};

function provider() {
  const p = String(process.env.CAPTCHA_PROVIDER || 'turnstile').toLowerCase();
  return PROVIDERS[p] ? p : 'turnstile';
}

// Configured only when BOTH a site key (for the widget) and secret (for
// server-side verification) are present.
export function isCaptchaEnabled() {
  return Boolean(process.env.CAPTCHA_SITE_KEY && process.env.CAPTCHA_SECRET_KEY);
}

// Public config safe to expose to the browser so it can render the right widget.
export function getCaptchaConfig() {
  if (!isCaptchaEnabled()) return { enabled: false };
  return { enabled: true, provider: provider(), siteKey: process.env.CAPTCHA_SITE_KEY };
}

// Verify a client-supplied token. Resolves true when CAPTCHA is disabled so
// callers can use it unconditionally.
export async function verifyCaptcha(token, remoteip) {
  if (!isCaptchaEnabled()) return true;
  if (!token || typeof token !== 'string') return false;

  const body = new URLSearchParams({ secret: process.env.CAPTCHA_SECRET_KEY, response: token });
  if (remoteip) body.set('remoteip', remoteip);

  try {
    const res = await fetch(PROVIDERS[provider()], {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch (error) {
    console.error('[captcha] verification request failed:', error.message);
    return false;
  }
}
