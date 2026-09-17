import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDefaultUser } from './db/database.js';
import authRoutes from './routes/authRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { startReminderJob } from './jobs/reminderJob.js';
import { startCalendarSyncJob } from './services/calendarSync.js';
import { checkSecrets, warnIfDefaultPassword } from './securityCheck.js';

dotenv.config();

// Fail fast on insecure secrets before anything else starts.
checkSecrets();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Initialize Database
initializeDefaultUser().then(() => {
  console.log('✓ Database initialized');
  warnIfDefaultPassword();
  startReminderJob();
  startCalendarSyncJob();
}).catch(err => {
  // Without a database the app cannot serve or store anything, and a failure
  // here can mean the admin user was deliberately not seeded (see
  // ADMIN_PASSWORD_HASH). Stop rather than run in a half-initialized state.
  console.error(`✗ Database initialization failed: ${err.message}`);
  process.exit(1);
});

// Trust proxy for Docker/nginx environment
function parseTrustProxy(value) {
  if (value === undefined || value === '') return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  const num = Number(normalized);
  if (Number.isInteger(num) && num >= 0) return num;
  return value;
}

const trustProxyValue = process.env.TRUST_PROXY !== undefined
  ? parseTrustProxy(process.env.TRUST_PROXY)
  : 1;
app.set('trust proxy', trustProxyValue);

// Middleware
const DEFAULT_CORS_ORIGINS = [
  'http://localhost',
  'http://localhost:80',
  'http://localhost:5173',
  'http://127.0.0.1',
  'http://127.0.0.1:80',
  'http://127.0.0.1:5173'
];

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const corsOrigins = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_CORS_ORIGINS;

// Only bare localhost / 127.0.0.1 (any port) count as local dev origins. Match
// the parsed hostname rather than a string prefix — a prefix check would also
// accept attacker-controlled origins like http://localhost.evil.com.
function isLocalhostOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

// A request whose Origin matches the Host it arrived on is same-origin — the
// browser is talking to the page's own site through the proxy. That is the
// normal case for this app, and it must not depend on CORS_ORIGINS being set
// correctly: getting it wrong there fails every admin write, and the app has
// no cookie auth for CORS to be protecting in the first place (the admin token
// travels in an Authorization header, which cross-site requests cannot set).
function isSameOriginRequest(origin, req) {
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// The options-delegate form is used because it is the only one that hands the
// request to the decision — cors() calls a plain `origin` function without it.
app.use(cors((req, callback) => {
  const origin = req.headers.origin;
  const allowed = !origin
    || corsOrigins.includes(origin)
    || isLocalhostOrigin(origin)
    || isSameOriginRequest(origin, req);

  if (allowed) return callback(null, { origin: true, credentials: true });

  console.warn(`[CORS] Blocked origin: ${origin}`);
  const err = new Error(`Origin ${origin} is not allowed by CORS. Add it to CORS_ORIGINS.`);
  // Without a status this surfaced as a 500, which reads like a server fault
  // rather than the configuration problem it is.
  err.status = 403;
  callback(err);
}));

// CAPTCHA widgets (Cloudflare Turnstile / hCaptcha) load a script and render in
// an iframe, so their domains must be allowed in the CSP.
const CAPTCHA_HOSTS = ['https://challenges.cloudflare.com', 'https://hcaptcha.com', 'https://*.hcaptcha.com'];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://maps.googleapis.com", "https://maps.gstatic.com", ...CAPTCHA_HOSTS],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", ...CAPTCHA_HOSTS],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", 'data:', 'https:', "https://*.googleapis.com", "https://*.gstatic.com"],
      connectSrc: ["'self'", "https://maps.googleapis.com", "https://*.googleapis.com", ...CAPTCHA_HOSTS],
      frameSrc: ["'self'", ...CAPTCHA_HOSTS]
    }
  }
}));
// Keep request bodies small on public endpoints. The logo upload and the
// schools save need a larger limit: schools embed their tile logos as base64
// data URLs, so PUT /api/schools carries every school's logo on each save.
const standardJson = express.json({ limit: '64kb' });
const largeJson = express.json({ limit: '16mb' });
app.use((req, res, next) => {
  const needsLarge = req.method === 'PUT' && (req.path === '/api/logo' || req.path === '/api/schools');
  if (needsLarge) return largeJson(req, res, next);
  return standardJson(req, res, next);
});

// Routes
app.use('/auth', authRoutes);
app.use('/api', bookingRoutes);
app.use('/api', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Every client here expects JSON. Express's default handler returns an HTML
// page (with a stack trace outside production), which breaks the admin UI's
// error handling and leaks server paths. Catch everything that reaches this
// point — including body-parser's malformed-JSON and payload-too-large errors
// — and answer in JSON with a message that gives nothing away.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  console.error(`[error] ${req.method} ${req.url} → ${status}:`, err.message);
  const message = status === 413 ? 'Request body is too large'
    : status === 400 && err.type === 'entity.parse.failed' ? 'Malformed JSON in request body'
    : status < 500 ? err.message
    : 'Internal server error';
  res.status(status).json({ error: message });
});


app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

export default app;
