# TutorBooking

Self-hosted tutor booking app with Google Calendar integration.

Designed for a scalable tutor/admin workflow:
- students book from a public page
- you manage everything from `/admin`
- bookings are written to Google Calendar with travel-time-aware availability

## What the app does today

- **Relational Data Persistence**
  - Powered by **SQLite** for reliable, concurrent data management.
  - Multi-user ready schema with `user_id` tracking.

- **Meeting types** (built-in + custom)
  - Built-ins: **Phone Call**, **Google Meet**, **School Location**
  - Create/edit/reorder/enable/disable meeting types in Admin
  - **Custom availability**: Set per-meeting-type weekly schedules
  - **Date overrides**: Add specific available dates or ranges (whitelist) and unavailable dates (blackout)

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
  - Rate limiting on availability checks (90/min) and bookings (12/15min)
  - CORS whitelisting for production domains
  - HTTP security headers via helmet (CSP, X-Frame-Options, etc.)
  - OAuth CSRF protection with time-limited state tokens
  - Error message sanitization (no sensitive details leaked to clients)

---

## Security

This application implements multiple layers of security:

### Authentication & Access Control
- **Password hashing**: bcrypt with 12 rounds
- **Session management**: JWT tokens with 24-hour expiry
- **Admin password changes**: Available in admin panel at `/admin` → Change Password
- **Rate limiting**:
  - Login: 10 attempts per 15 minutes
  - Availability checks: 90 requests per minute
  - Bookings: 12 attempts per 15 minutes

### Input Validation & Sanitization
- All API endpoints validate input types, formats, and lengths
- Email validation with regex
- Meeting type validation ensures only enabled types are bookable
- React auto-escapes all output (XSS protection)

### Network Security
- **CORS**: Whitelist-based origin validation (configure `CORS_ORIGINS` in production)
- **CSP headers**: Helmet-enforced Content Security Policy
- **HTTPS**: Automatic TLS via Traefik or Caddy in production
- **Trust proxy**: Configured for proper IP handling behind proxies (set `TRUST_PROXY=2` for Traefik)

### Data Protection
- **OAuth tokens**: Encrypted at rest in SQLite using `ENCRYPTION_KEY`
- **Secrets**: All sensitive data stored in environment variables (never committed)
- **Admin passwords**: Persisted as bcrypt hashes in secure SQLite volume
- **.gitignore**: Prevents accidental commit of `.env`, database, and runtime data

### OAuth Security
- **CSRF protection**: Time-limited state tokens (10-minute TTL)
- **State validation**: Single-use tokens prevent replay attacks

---

## Architecture

- `client/`: React (Vite), served by nginx
- `server/`: Express API + Google integrations
  - **Modular structure**: Separated into `Routes`, `Controllers`, `Services`, and `DB` layers.
  - **Persistence**: Relational SQLite database (`better-sqlite3`).
- `docker-compose.yml`: Unified production deployment with Traefik support.

---

## Performance & Resource Optimization

### Optimized for Low-RAM Instances (1GB RAM)

This application is optimized to run on resource-constrained instances like **Oracle Cloud Free Tier** (1 CPU, 1GB RAM):

#### Memory Management
- **Docker memory limits**: Enforced per-container limits prevent OOM kills
  - Server: 400MB (main backend process)
  - Client (nginx): 150MB (lightweight static file server)

#### Resource Limits in docker-compose.yml
```yaml
services:
  server:
    mem_limit: 400m        # Hard limit
    mem_reservation: 300m  # Soft limit
  client:
    mem_limit: 150m
    mem_reservation: 100m
```

#### Scaling Considerations
The move to **SQLite** provides a significant performance boost over the previous file-based storage, allowing for better concurrency and data integrity as the number of bookings increases.

---

## Quick start (Docker)

**Local testing** - works out of the box on port 5500:

```bash
git clone <your-repo-url>
cd TutorBooking
cp server/.env.example server/.env
# edit server/.env with your values
docker compose up -d --build
```

Open:
- Booking page: `http://localhost:5500/`
- Admin page: `http://localhost:5500/admin`

---

## Production deployment with Traefik

The application is pre-configured to run behind a **Traefik** reverse proxy.

### Setup steps

1. **Update docker-compose.yml**:
   Ensure the Traefik host rule matches your domain:
   ```yaml
   - "traefik.http.routers.tutorbooking.rule=Host(`tutorbooking.oracle.tastymath.com`)"
   ```

2. **Configure environment variables in `server/.env`**:
```bash
# Google OAuth redirect URI
GOOGLE_REDIRECT_URI=https://tutorbooking.oracle.tastymath.com/auth/google/callback

# CORS origins
CORS_ORIGINS=https://tutorbooking.oracle.tastymath.com

# Trust proxy
TRUST_PROXY=2
```

3. **Deploy**:
```bash
docker compose up -d --build
```

---

## Required environment variables

Set these in `server/.env`:

- `ADMIN_PASSWORD_HASH` - bcrypt hash for admin login password
- `JWT_SECRET` - secret used to sign admin JWTs
- `ENCRYPTION_KEY` - key used to encrypt stored Google OAuth tokens
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` - e.g. `https://tutorbooking.oracle.tastymath.com/auth/google/callback`

Optional:
- `TIMEZONE` (default `America/Chicago`)
- `GOOGLE_MAPS_API_KEY` (enables address autocomplete + drive-time matrix)
- `PORT` (default `5000`)
- `DATA_DIR` (defaults to /app/data in Docker)
- `TRUST_PROXY` (set to `2` when behind Traefik)
- `CORS_ORIGINS` (comma-separated list for production)

---

## Admin password setup

### Initial Setup

Generate a bcrypt hash:

```bash
node -e "require('bcryptjs').hash('your-password-here', 12).then(console.log)"
```

Put the hash into `ADMIN_PASSWORD_HASH` in `server/.env`.

### Changing Your Password

After initial setup, you can change your admin password from the web interface:

1. Log in to `/admin`
2. Click the **"Change Password"** button
3. The new password is saved directly to the SQLite database.

---

## Data storage

Docker Compose volumes for persistent data:

**Application data** (`token-data` volume → `/app/data` inside server container):
- `database.sqlite`: All schools, drive times, config, and bookings.
- Logo and settings are also stored within the database.

---

## Troubleshooting

### Connectivity Check
Verify the backend is responding from inside the client container:
```bash
docker exec tutor-booking-client curl -v http://server:5000/api/health
```

### Database Logs
Check the server logs to ensure the database is initialized:
```bash
docker compose logs -f server
```
Expected output:
`✓ Database initialized`
`🚀 Server running on http://localhost:5000`

### CORS Errors
If you see CORS errors in the browser console, ensure `CORS_ORIGINS` in your `.env` exactly matches the URL you are using to access the site.
