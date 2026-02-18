# TutorBooking

A self-hosted tutoring appointment booking app with Google Calendar integration. Students book sessions online; bookings appear directly on your calendar with drive-time buffers automatically handled between school locations.

## Features

- **School tile picker** — visual grid of school logos on the booking page
- **Multi-school scheduling** — each school has its own session length, availability blocks, and period names
- **Google Calendar sync** — real-time availability checking and automatic event creation
- **Drive time buffering** — auto-calculated from school addresses via Google Maps; same-location bookings back-to-back, different locations get drive time + 5 min
- **Google Meet support** — generates Meet links for online sessions
- **Admin panel** — password-protected GUI for all configuration; no config file editing required
- **Logo support** — business logo on booking page, individual logos per school
- **Multi-calendar** — check availability across multiple Google Calendars; book into any calendar
- **Secure by default** — bcrypt admin password, JWT sessions, AES-256-GCM encrypted OAuth tokens

---

## Quick Start (Docker)

```bash
git clone <your-repo-url>
cd TutorBooking
cd server
cp .env.example .env
# Edit .env — see Environment Variables section below
cd ..
docker compose up -d --build
```

Visit `http://localhost` — booking page.
Visit `http://localhost/admin` — admin panel (requires password).

---

## Environment Variables

All variables go in `server/.env`. Copy `server/.env.example` as a starting point.

### Required

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD_HASH` | bcrypt hash of your admin password (see below) |
| `JWT_SECRET` | Random secret for signing admin session tokens |
| `ENCRYPTION_KEY` | Random key for encrypting stored Google OAuth tokens |
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Must match your domain, e.g. `https://yourdomain.com/auth/google/callback` |

### Optional

| Variable | Description | Default |
|---|---|---|
| `TIMEZONE` | IANA timezone for slot generation | `America/Chicago` |
| `GOOGLE_MAPS_API_KEY` | Enables address autocomplete and drive time auto-calculation | — |
| `GOOGLE_REFRESH_TOKEN` | Fallback if not using the web OAuth flow | — |
| `PORT` | Server port inside the container | `5000` |

---

## Setting Up Admin Authentication

The admin panel at `/admin` requires a password. You must generate a bcrypt hash of your chosen password and add it to `server/.env` before first use.

### Step 1 — Generate the password hash

Run this once (Node.js must be installed, or run inside the container):

```bash
node -e "require('bcryptjs').hash('your-password-here', 12).then(console.log)"
```

Copy the output (it will look like `$2b$12$...`).

### Step 2 — Generate a JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Step 3 — Add to `server/.env`

```env
ADMIN_PASSWORD_HASH=$2b$12$...   # paste hash from step 1
JWT_SECRET=abc123...              # paste output from step 2
```

### Step 4 — Generate an encryption key (for OAuth token storage)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```env
ENCRYPTION_KEY=def456...          # paste output here
```

### How admin auth works

- Visiting `/admin` shows a login form
- On successful login a signed JWT (24h expiry) is stored in the browser
- All admin API endpoints (`PUT /api/schools`, `PUT /api/settings`, etc.) require a valid JWT in the `Authorization: Bearer` header
- The "Log out" button in the admin header clears the token
- After 24 hours the token expires and re-login is required
- Login attempts are rate-limited to 10 per 15 minutes

---

## Google Calendar Setup

### 1. Create OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable the **Google Calendar API**
3. Go to "APIs & Services" → "Credentials" → "Create Credentials" → "OAuth client ID"
4. Application type: **Web application**
5. Add authorized redirect URI: `https://yourdomain.com/auth/google/callback`
6. Copy the Client ID and Client Secret into `server/.env`

### 2. Connect via the admin panel

1. Start the app and log in to `/admin`
2. Go to the **Google Calendar** tab
3. Click **Connect Google Calendar**
4. Authorize with your Google account
5. Tokens are encrypted and saved automatically — no manual token handling needed

### 3. Select which calendars to use

After connecting, the **Calendar Settings** section appears. Choose:
- **Check Availability** — which calendars to scan for conflicts (check all calendars you use)
- **Add Bookings To** — which calendar to create new booking events in

---

## Google Maps API Setup (optional but recommended)

Enables two features:
- Address autocomplete in the school editor
- **Auto-calculate drive times** between schools via the Distance Matrix API

1. Enable these APIs in Google Cloud Console: **Maps JavaScript API**, **Places API**, **Geocoding API**, **Distance Matrix API**
2. Add the key to `server/.env`:
   ```env
   GOOGLE_MAPS_API_KEY=your_key_here
   ```

To calculate drive times: Admin → Schools → **Calculate from Addresses**. This calls the Distance Matrix API with a midday weekday departure time, averages the outbound and return to enforce symmetry, and fills the drive time matrix. Review the values and click **Save Drive Times**.

---

## Admin Panel Guide

### Logging in

Visit `/admin`. Enter your password (the one you hashed in `ADMIN_PASSWORD_HASH`).

### Google Calendar tab

- View OAuth and token status
- Connect, reconnect, or disconnect Google Calendar
- Test the live API connection
- Configure which calendars to check and book into

### Schools tab

Add and manage schools. Each school has:

- **Name** and **Address** — address autocompletes with Google Maps if API key is set
- **Session Length** — controls slot generation (e.g. 40 min sessions in a 40 min window = exactly one slot)
- **School Logo** — displayed as the tile image on the booking page; PNG/SVG with transparent background works best
- **Availability Schedule** — enable days, add time blocks, give blocks an optional period name (e.g. "A2a") shown to students
- **Copy to…** — copy a day's blocks to other days

**Drive Times Between Schools** — matrix of actual driving minutes between each pair. Use **Calculate from Addresses** to auto-fill, or enter manually. The system adds 5 minutes for parking/walking and rounds to the nearest 5 before applying buffers.

### Settings tab

- **Booking Page Logo** — displayed above the page title on the student-facing booking page
- **Google Meet Session Length** — duration for online sessions

---

## Booking Page

Students visit the root URL (`/`). The flow:

1. **Choose meeting type** — Google Meet or Physical Location
2. **Select school** — tile grid with logo and session duration; or enter a custom location
3. **Pick a date** — only dates with available slots are enabled in the calendar
4. **Pick a time** — slots show the time and optional period name; slots blocked by calendar events or drive time requirements are excluded automatically
5. **Enter contact info** — name, email, phone (optional), notes (optional)
6. **Confirm** — booking creates a calendar event with a descriptive title (`Student Name — Tutoring at School Name`), sends an invite to the student's email, and generates a Google Meet link if applicable

---

## Deployment

### Cloudflare Tunnel (recommended for homelab)

Cloudflare Tunnel exposes your local app publicly without opening firewall ports:

```bash
# Install cloudflared on your machine
# Then create a tunnel:
cloudflared tunnel create tutor-booking
cloudflared tunnel route dns tutor-booking yourdomain.com
cloudflared tunnel run tutor-booking
```

Cloudflare handles TLS automatically. No Let's Encrypt setup needed.

Update `GOOGLE_REDIRECT_URI` in `.env` to your public domain and add it to your OAuth client's authorized redirect URIs in Google Cloud Console.

### DigitalOcean Droplet (or any VPS)

1. Install Docker and Docker Compose on the droplet
2. Clone the repo, configure `server/.env`
3. Run `docker compose up -d --build`
4. Point your domain's DNS A record to the droplet IP
5. Set up HTTPS with [Caddy](https://caddyserver.com/) (simplest) or Certbot + nginx

**Caddy example** (automatic HTTPS, no certificate management):
```
yourdomain.com {
    reverse_proxy localhost:80
}
```

### Updating

```bash
git pull
docker compose up -d --build
```

Data (tokens, schools, settings, logos) is stored in a named Docker volume and persists across rebuilds.

---

## Docker Reference

```bash
# Start
docker compose up -d

# View logs
docker compose logs -f

# Rebuild after code changes
docker compose up -d --build

# Stop
docker compose down

# Stop and delete all data volumes (destructive)
docker compose down -v
```

Health check endpoints:
- `GET /api/health` — server status and calendar connection

---

## API Reference

### Public (no auth required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/availability` | Available slots for a date/school |
| `POST` | `/api/availability/days` | Which days in a month have slots |
| `POST` | `/api/bookings` | Create a booking |
| `GET` | `/api/config` | Public runtime config (Maps key, Meet duration) |
| `GET` | `/api/logo` | Business logo |
| `GET` | `/api/schools` | School list (booking page needs this) |
| `GET` | `/api/health` | Health check |
| `GET` | `/auth/google` | Initiate Google OAuth flow |
| `GET` | `/auth/google/callback` | OAuth callback |
| `GET` | `/auth/status` | Calendar connection status |

### Admin (JWT required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/admin/login` | Exchange password for JWT |
| `GET` | `/auth/admin/verify` | Validate existing JWT |
| `GET` | `/auth/test` | Test live calendar API |
| `POST` | `/auth/disconnect` | Disconnect Google Calendar |
| `GET/PUT` | `/api/settings` | Google Meet duration etc. |
| `GET/PUT` | `/api/logo` | Business logo |
| `DELETE` | `/api/logo` | Remove business logo |
| `GET/PUT` | `/api/schools` | School list (GET is public, PUT is admin) |
| `GET/PUT` | `/api/drivetimes` | Drive time matrix |
| `POST` | `/api/drivetimes/calculate` | Auto-calculate via Google Maps |
| `GET` | `/api/calendars` | List connected Google Calendars |
| `GET/PUT` | `/api/config/calendars` | Calendar selection config |
| `GET` | `/api/bookings` | All bookings |

---

## Troubleshooting

**Admin panel shows login form but login fails**
- Verify `ADMIN_PASSWORD_HASH` in `server/.env` is a valid bcrypt hash starting with `$2b$`
- Make sure you're hashing the right password — re-run the generation command if unsure
- Check that `JWT_SECRET` is set

**Google Calendar not connecting**
- Confirm `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are correct
- Verify the redirect URI in Google Cloud Console exactly matches `GOOGLE_REDIRECT_URI` in `.env`
- Check server logs: `docker compose logs -f server`

**Slots not showing / wrong times**
- Set `TIMEZONE` in `.env` to your local IANA timezone (e.g. `America/Chicago`, `America/New_York`)
- Confirm the school's availability blocks are saved in the admin panel

**Drive time calculation fails**
- Ensure `GOOGLE_MAPS_API_KEY` is set and the **Distance Matrix API** is enabled in Google Cloud Console
- The key needs billing enabled; the Distance Matrix API is not on the free tier

**Tokens lost after container restart**
- Data is stored in a named Docker volume (`token-data`). Check `docker volume ls` to confirm it exists.
- Do not use `docker compose down -v` in production — that deletes volumes
