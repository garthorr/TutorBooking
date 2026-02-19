# TutorBooking

Self-hosted tutor booking app with Google Calendar integration.

Designed for a single tutor/admin workflow:
- students book from a public page
- you manage everything from `/admin`
- bookings are written to Google Calendar with travel-time-aware availability

## What the app does today

- Meeting types (built-in + custom)
  - Built-ins: **Phone Call**, **Google Meet**, **School Location**
  - You can create/edit/reorder/enable/disable meeting types in Admin
- School/location scheduling
  - Per-school session length and weekly availability blocks
  - Optional custom location bookings
- Availability engine
  - Pulls events from one or more Google calendars
  - Applies drive-time buffers between school locations
- Booking flow
  - Student chooses meeting type, location (if needed), date/time, and contact info
  - Event is created in the selected booking calendar
  - Google Meet links generated automatically for online meetings
- Admin auth + config
  - bcrypt password login, JWT session, protected admin APIs
  - Manage business branding, theme color, logo, calendar selection, schools, drive times, meeting types
- Security improvements in API
  - Server-side validation for availability and booking payloads
  - Rate limiting on login, availability checks, and booking creation

---

## Architecture

- `client/`: React (Vite), served by nginx
- `server/`: Express API + Google integrations
- `docker-compose.yml`: production-style local deployment

The client proxies `/api` and `/auth` to the server through nginx.

---

## Quick start (Docker)

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
- `TIMEZONE` (default `America/Chicago`)
- `GOOGLE_MAPS_API_KEY` (address autocomplete + drive-time matrix)
- `GOOGLE_REFRESH_TOKEN` (fallback/manual setup)
- `PORT` (default `5000`)
- `DATA_DIR` (defaults to app directory unless overridden)

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

## Cloudflare Zero Trust / Tunnel notes

- Put this app behind Cloudflare Tunnel / Zero Trust as your public entry.
- Restrict `/admin` access with Zero Trust policy (you only).
- Keep booking page public if students need direct access.
- Ensure `GOOGLE_REDIRECT_URI` uses your public HTTPS domain.

---

## Data storage

With Docker Compose, persistent app data is stored in the `token-data` volume (`/app/data` inside server container), including:

- encrypted OAuth tokens
- schools
- drive times
- calendar config
- meeting types
- settings/logo

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
