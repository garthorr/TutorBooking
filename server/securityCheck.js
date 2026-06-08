import passwordStore from './passwordStore.js';

// Hardcoded fallbacks used elsewhere in the app — treated as "not configured".
const INSECURE_DEFAULTS = {
  JWT_SECRET: 'dev-secret-change-in-production',
  ENCRYPTION_KEY: 'default-key-change-in-production'
};

// Refuse to run in production with default/weak secrets; warn in development.
export function checkSecrets() {
  const isProd = process.env.NODE_ENV === 'production';
  const problems = [];

  for (const key of ['JWT_SECRET', 'ENCRYPTION_KEY']) {
    const val = process.env[key];
    if (!val) problems.push(`${key} is not set`);
    else if (val === INSECURE_DEFAULTS[key]) problems.push(`${key} is still the insecure default value`);
    else if (val.length < 16) problems.push(`${key} is shorter than 16 characters`);
  }

  if (problems.length === 0) return;

  const message = ['SECURITY: insecure configuration detected:', ...problems.map(p => `  - ${p}`)].join('\n');
  if (isProd) {
    console.error(`\n${message}\n\nRefusing to start in production. Set strong, unique values in server/.env.\n`);
    process.exit(1);
  } else {
    console.warn(`\n⚠ ${message}\n  (Allowed in development only — these MUST be set before deploying.)\n`);
  }
}

// Non-fatal: surface the fact that the seeded default admin password is unchanged.
export async function warnIfDefaultPassword() {
  try {
    if (await passwordStore.verifyPassword('password')) {
      console.warn('\n⚠ SECURITY: the admin password is still the default ("password"). Change it in the admin panel now.\n');
    }
  } catch {
    /* ignore — password not set up yet */
  }
}
