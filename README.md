# TutorBooking

Self-hosted tutor booking app with Google Calendar integration.

Designed for a single tutor/admin workflow:
- students book from a public page
- you manage everything from `/admin`
- bookings are written to Google Calendar with travel-time-aware availability

## What the app does today

- **Meeting types** (built-in + custom)
  - Built-ins: **Phone Call**, **Google Meet**, **School Location**
  - Create/edit/reorder/enable/disable meeting types in Admin

- **School/location scheduling**
  - Per-school session length and weekly availability blocks
  - Optional custom location bookings
  - Configurable "Other Location" session duration

- **Availability engine**
  - Pulls events from one or more Google calendars
  - Applies drive-time buffers between school locations
  - Automatic conflict detection with double-booking prevention

- **Booking flow**
  - Student chooses meeting type, location (if needed), date/time, and contact info
  - Event is created in the selected booking calendar with proper timezone
  - Google Meet links generated automatically for online meetings

- **White-label branding**
  - Custom business name and description
  - Theme color picker (4 presets: Indigo, Blue, Teal, Purple + custom hex)
  - Logo upload support

- **Admin auth + config**
  - bcrypt password login, JWT session tokens (24hr expiry)
  - Protected admin APIs with middleware
  - Manage branding, calendar selection, schools, drive times, meeting types

- **Security & performance**
  - Server-side validation for all inputs (availability and booking payloads)
  - Rate limiting on login (10/15min), availability checks (90/min), and bookings (12/15min)
  - CORS whitelisting for production domains
  - HTTP security headers via helmet (CSP, X-Frame-Options, etc.)
  - OAuth CSRF protection with time-limited state tokens
  - In-memory caching for file-based data to reduce disk I/O
  - Error message sanitization (no sensitive details leaked to clients)

---

## Architecture

- `client/`: React (Vite), served by nginx
- `server/`: Express API + Google integrations
- `docker-compose.yml`: production-style local deployment

The client proxies `/api` and `/auth` to the server through nginx.

---

## Quick start (Docker)

**Local testing** - works out of the box with Caddy on localhost:

```bash
git clone <your-repo-url>
cd TutorBooking
cp server/.env.example server/.env
# edit server/.env with your values
docker compose up -d --build
```

Open:
- Booking page: `http://localhost/`
- Admin page: `http://localhost/admin`

The Caddyfile is pre-configured for localhost. No changes needed for local development!

---

## Production deployment with Caddy

For production deployment with automatic HTTPS via Let's Encrypt:

### Prerequisites

1. **Domain name** pointing to your server's IP address
   - Create an A record: `booking.yourdomain.com` → `your.server.ip`
   - Wait for DNS propagation (can take up to 48 hours, usually much faster)

2. **Firewall configuration**
   - Ensure ports 80 (HTTP) and 443 (HTTPS) are open
   - Port 80 is required for Let's Encrypt challenge validation

### Setup steps

1. **Update Caddyfile for production**:
```bash
# Edit Caddyfile
nano Caddyfile

# Comment out the localhost block:
# localhost, http://localhost {
#   ...
# }

# Uncomment and configure the production block:
# Replace YOUR_DOMAIN_HERE with: booking.yourdomain.com
```

2. **Configure environment variables in `server/.env`**:
```bash
# Google OAuth redirect URI (must match Google Cloud Console)
GOOGLE_REDIRECT_URI=https://booking.yourdomain.com/auth/google/callback

# CORS origins (your production domain)
CORS_ORIGINS=https://booking.yourdomain.com

# Timezone (set to your location)
TIMEZONE=America/New_York

# Trust proxy is automatically set to 1 in docker-compose.yml
```

3. **Update Google Cloud Console**:
   - Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
   - Edit your OAuth 2.0 Client ID
   - Add authorized redirect URI: `https://booking.yourdomain.com/auth/google/callback`
   - Save changes

4. **Deploy**:
```bash
docker compose up -d --build
```

5. **Verify HTTPS is working**:
   - Visit `https://booking.yourdomain.com` (should show valid certificate)
   - Check admin: `https://booking.yourdomain.com/admin`
   - Caddy will automatically obtain Let's Encrypt certificates on first request

### What Caddy does

- **Automatic HTTPS**: Obtains and renews Let's Encrypt TLS certificates
- **HTTP/3 support**: Modern protocol for faster connections
- **Reverse proxy**: Routes requests to client (nginx) and server (Express)
- **Security headers**: HSTS, X-Frame-Options, etc.
- **Compression**: gzip and zstd for smaller payloads

### Certificate storage

Let's Encrypt certificates are stored in Docker volumes:
- `caddy-data`: Certificate files and ACME account info
- `caddy-config`: Caddy configuration cache

These volumes persist across container restarts. **Do not delete them** or Caddy will need to re-obtain certificates (rate limits apply).

### Switching between localhost and production

**Localhost is active by default** in the Caddyfile. To switch to production:

1. Edit `Caddyfile`
2. Comment out the localhost block
3. Uncomment the production block and set your domain
4. Restart: `docker compose restart caddy`

To switch back to localhost, reverse the process.

---

## Required environment variables

Set these in `server/.env`:

- `ADMIN_PASSWORD_HASH` - bcrypt hash for admin login password
- `JWT_SECRET` - secret used to sign admin JWTs
- `ENCRYPTION_KEY` - key used to encrypt stored Google OAuth tokens
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` - for example `https://yourdomain.com/auth/google/callback`

Optional:
- `TIMEZONE` (default `America/Chicago`) - **Important**: Set this to your local timezone (e.g., `America/New_York`, `Europe/London`) to ensure availability slots display at correct times
- `GOOGLE_MAPS_API_KEY` (enables address autocomplete in admin + drive-time matrix calculations)
- `GOOGLE_REFRESH_TOKEN` (fallback/manual setup)
- `PORT` (default `5000`)
- `DATA_DIR` (defaults to app directory unless overridden)
- `TRUST_PROXY` (set to `1` or `true` when behind Cloudflare/reverse proxy)
- `CORS_ORIGINS` (comma-separated list for production, e.g., `https://booking.yourdomain.com`)

---

## Admin password setup

Generate a bcrypt hash:

```bash
node -e "require('bcryptjs').hash('your-password-here', 12).then(console.log)"
```

Put the hash into `ADMIN_PASSWORD_HASH` in `server/.env`.

> If you use Docker Compose `env_file`, escape `$` as `$$` in bcrypt hashes.

---

## Google Calendar setup

1. In Google Cloud, enable Calendar API and create OAuth Web credentials.
2. Add your redirect URI (`/auth/google/callback`) in Google Cloud and `.env`.
3. Log into `/admin` and click **Connect Google Calendar**.
4. In Admin, choose:
   - calendars to check for availability
   - calendar where new bookings are created

---

## White-label customization

Customize the booking page appearance in `/admin` → **Settings** tab:

1. **Business name** - Replaces default "Book a Tutoring Session" header
2. **Business description** - Replaces default subtitle text
3. **Theme color** - Choose from 4 presets or enter custom hex color:
   - Indigo (default): `#4f46e5`
   - Blue: `#3b82f6`
   - Teal: `#14b8a6`
   - Purple: `#a855f7`
   - Or use any hex color: `#c026d3`, `#dc2626`, etc.
4. **Logo** - Upload your logo (appears at top of booking page)
5. **Custom location duration** - Default session length for "Other Location" bookings

All changes take effect immediately on the booking page (no restart needed).

---

## Cloudflare Zero Trust / Tunnel notes

**Alternative to Caddy**: If you prefer Cloudflare Tunnel over direct HTTPS exposure:

- Put this app behind Cloudflare Tunnel / Zero Trust as your public entry.
- Restrict `/admin` access with Zero Trust policy (you only).
- Keep booking page public if students need direct access.
- When using Cloudflare Tunnel, you can **disable Caddy** in `docker-compose.yml`:
  ```bash
  docker compose stop caddy
  # Or comment out the caddy service entirely
  ```
- Point Cloudflare Tunnel to `client:80` (internal port, no public exposure needed)
- Ensure `GOOGLE_REDIRECT_URI` uses your public HTTPS domain (the Cloudflare one)
- Set `CORS_ORIGINS` to your Cloudflare domain
- `TRUST_PROXY=1` is still required when behind Cloudflare

**Summary**: Use **Caddy** for simple VPS/dedicated server setups. Use **Cloudflare Tunnel** if you want Zero Trust access policies or don't want to open ports 80/443 on your firewall.

---

## Data storage

Docker Compose volumes for persistent data:

**Application data** (`token-data` volume → `/app/data` inside server container):
- encrypted OAuth tokens
- schools
- drive times
- calendar config
- meeting types
- settings/logo

**Caddy data** (production HTTPS only):
- `caddy-data`: Let's Encrypt certificates and ACME account
- `caddy-config`: Caddy configuration cache

**Important**: Never delete `caddy-data` volume in production or you'll hit Let's Encrypt rate limits when re-obtaining certificates.

---


## Localhost compatibility notes

These hardening changes are safe for local testing out of the box:

- `TRUST_PROXY` defaults to off, which is correct for direct localhost runs.
- CORS defaults allow `http://localhost`, `http://localhost:80`, `http://localhost:5173`, and `127.0.0.1` equivalents.
- In production behind Cloudflare/another proxy, set `TRUST_PROXY` (commonly `1` or `true`) and set explicit `CORS_ORIGINS`.

---

## Security + privacy checklist for this repo

To avoid exposing private data in GitHub:

- Never commit `server/.env`
- Never commit OAuth token files (`.tokens.json`)
- Never commit generated runtime data files (`schools.json`, `settings.json`, etc.)
- Do not hardcode API keys, secrets, refresh tokens, or personal addresses in source files
- Before pushing, run:

```bash
git status
rg -n "(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE KEY|refresh_token)" -g '!**/package-lock.json'
```

If sensitive data was ever committed, rotate credentials and rewrite git history before publishing.

---

## Useful commands

```bash
# start
docker compose up -d --build

# logs
docker compose logs -f

# stop
docker compose down

# stop and remove volumes (destructive)
docker compose down -v
```

Health endpoint:
- `GET /api/health`

---

## Troubleshooting

### Availability times are wrong / timezone mismatch

**Problem**: School availability slots show at incorrect times (e.g., 3:00 PM instead of 9:00 AM)

**Solution**: Set `TIMEZONE` in `server/.env` to match your local timezone:
```bash
# In server/.env
TIMEZONE=America/New_York  # or America/Chicago, Europe/London, etc.
```

After changing, restart the server:
```bash
docker compose restart server
```

### Address field not accepting input

**Problem**: Address field in school form is uneditable, blocked, or shows error icon

**Root causes** (fixed in recent versions):
1. Google Maps autocomplete creating multiple instances on the same input (React useEffect bug)
2. Content Security Policy blocking Google Maps resources (`maps.gstatic.com`)

**Solution**: Update to the latest version (commit 8319649 or later) which includes:
- Fixed React useEffect cleanup in SchoolForm component
- Expanded CSP to allow all Google Maps domains

If still experiencing issues after updating:
```bash
git pull origin claude/booking-page-frontend-SRTuz
docker compose build
docker compose up -d
```

### Address autocomplete not working

**Problem**: Address field doesn't suggest addresses as you type, or autocomplete appears broken

**Solution**:

1. **Add Google Maps API key** in `server/.env`:
```bash
# In server/.env
GOOGLE_MAPS_API_KEY=your_api_key_here
```

2. **Enable required Google Cloud APIs**:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Enable "Places API" (for autocomplete)
   - Enable "Geocoding API" (for address verification)
   - Enable "Distance Matrix API" (for drive time calculations)
   - Create credentials → API key
   - Restrict the key to your domain for security

3. **Verify CSP is correctly configured** (should be automatic in latest version):
   - Check that `server/server.js` includes `maps.gstatic.com` in CSP directives
   - This is required for Google Maps JavaScript library to load properly

4. **Restart server** after adding API key:
```bash
docker compose restart server
```

### Google Calendar tokens expire frequently

**Problem**: Admin shows "token expired" even though you just connected

**Solution**: This was fixed in recent updates. The app now automatically refreshes tokens and persists them. If still seeing issues:
1. Disconnect Google Calendar in admin
2. Reconnect by clicking "Connect Google Calendar"
3. Ensure you selected "Allow" for both calendar scopes in Google's consent screen

### CORS errors in production

**Problem**: Browser console shows CORS errors when accessing from your domain

**Solution**: Set `CORS_ORIGINS` in `server/.env`:
```bash
# In server/.env
CORS_ORIGINS=https://booking.yourdomain.com,https://yourdomain.com
```

### Bookings not creating calendar events

**Problem**: Bookings succeed but no Google Calendar event is created

**Checklist**:
1. Check `/admin` shows "Google Calendar: Connected"
2. In admin, verify you've selected a "Booking calendar" under Settings → Calendars
3. Check server logs: `docker compose logs -f server`
4. Try the "Test Connection" button in admin

### Rate limit errors

**Problem**: "Too many requests" error when checking availability

**Solution**: The app has rate limits for security:
- Availability checks: 90 per minute
- Bookings: 12 per 15 minutes
- Login attempts: 10 per 15 minutes

If you're hitting these during normal use, they reset automatically. For development/testing, you can temporarily increase limits in `server/server.js`.

### Data appears lost after git pull / update

**Problem**: After pulling latest code, all schools/settings/config reverted to defaults

**Root cause**: App data files (`.json`, `.tokens.json`) are gitignored for security/privacy. They exist in the Docker volume but the server's in-memory cache needs to reload them.

**Solution**: Your data is safe in the Docker volume! Simply restart the server:
```bash
docker compose restart server
```

To verify your data is still there:
```bash
# List files in the data volume
docker compose exec server ls -la /app/data/
```

**Prevention**: Data files are never committed to git (by design). Always use Docker volumes for persistence in production.

### Logo uploads fail with "Payload too large"

**Problem**: Logo upload returns 413 error or "request entity too large"

**Solution**: This was fixed in recent versions (increased limit to 4MB). Update to latest:
```bash
git pull origin claude/booking-page-frontend-SRTuz
docker compose build server
docker compose up -d
```

For custom deployments, ensure your nginx/reverse proxy also allows 4MB+ uploads.

### Changes not appearing after update

**Problem**: Pulled latest code but UI/functionality hasn't changed

**Solution**:

1. **Rebuild Docker containers** (required for code changes):
```bash
git pull origin claude/booking-page-frontend-SRTuz
docker compose build
docker compose up -d
```

2. **Clear browser cache** (for client-side changes):
   - Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
   - Or clear site data in browser DevTools → Application → Clear storage

3. **Check logs for errors**:
```bash
docker compose logs -f server
docker compose logs -f client
```

### Server won't start - missing dependencies

**Problem**: Server container fails with "Cannot find package" error (e.g., helmet)

**Solution**: Ensure `package-lock.json` is in sync:
```bash
cd server
npm install
cd ..
docker compose build server
docker compose up -d
```

This was an issue in earlier versions where `package.json` was updated but `package-lock.json` wasn't regenerated.
