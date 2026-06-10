import test from 'node:test';
import assert from 'node:assert';
import { isCaptchaEnabled, getCaptchaConfig, verifyCaptcha } from '../services/captchaService.js';

// The service reads process.env at call time, so each test can configure it and
// restore afterwards.
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

test('CAPTCHA is disabled and verification passes when unconfigured', async () => {
  await withEnv({ CAPTCHA_SITE_KEY: undefined, CAPTCHA_SECRET_KEY: undefined }, async () => {
    assert.strictEqual(isCaptchaEnabled(), false);
    assert.deepStrictEqual(getCaptchaConfig(), { enabled: false });
    // Disabled => always passes, even with no token.
    assert.strictEqual(await verifyCaptcha(undefined), true);
  });
});

test('getCaptchaConfig exposes provider + site key, defaulting to turnstile', async () => {
  await withEnv({ CAPTCHA_SITE_KEY: 'site', CAPTCHA_SECRET_KEY: 'secret', CAPTCHA_PROVIDER: undefined }, () => {
    assert.deepStrictEqual(getCaptchaConfig(), { enabled: true, provider: 'turnstile', siteKey: 'site' });
  });
});

test('getCaptchaConfig honours hcaptcha and falls back on unknown providers', async () => {
  await withEnv({ CAPTCHA_SITE_KEY: 'site', CAPTCHA_SECRET_KEY: 'secret', CAPTCHA_PROVIDER: 'hcaptcha' }, () => {
    assert.strictEqual(getCaptchaConfig().provider, 'hcaptcha');
  });
  await withEnv({ CAPTCHA_SITE_KEY: 'site', CAPTCHA_SECRET_KEY: 'secret', CAPTCHA_PROVIDER: 'nonsense' }, () => {
    assert.strictEqual(getCaptchaConfig().provider, 'turnstile');
  });
});

test('verifyCaptcha rejects a missing token without calling out when enabled', async () => {
  await withEnv({ CAPTCHA_SITE_KEY: 'site', CAPTCHA_SECRET_KEY: 'secret' }, async () => {
    assert.strictEqual(await verifyCaptcha(''), false);
    assert.strictEqual(await verifyCaptcha(null), false);
  });
});
