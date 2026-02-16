# Tutor Booking System

A self-hosted booking application similar to Calendly, built for scheduling tutoring sessions with Google Calendar integration.

## Features

- 📅 **Date & Time Selection**: Interactive calendar with available time slots
- 📹 **Google Meet Integration**: Automatically generates Google Meet links for virtual sessions
- 📍 **Physical Location Options**: Select from predefined locations or enter custom locations
- 🚗 **Smart Drive Time Calculation**: Automatically accounts for travel time between different school locations
- ✏️ **Custom Location Entry**: Allow clients to specify their own meeting location
- ⚙️ **Easy Configuration**: Centralized config file for all customization options
- 🔄 **Google Calendar Sync**: Real-time availability checking and automatic calendar event creation
- 🔐 **Easy OAuth Setup**: Connect Google Calendar with a simple web login (no manual token generation)
- 📧 **Email Notifications**: Automatic confirmation emails sent to clients
- 🎨 **Modern UI**: Clean, responsive design that works on all devices
- 🏠 **Self-Hosted**: Run on your own Ubuntu server with full control

## Tech Stack

### Frontend
- **React 18**: Modern UI library
- **Vite**: Fast build tool and dev server
- **React DatePicker**: Intuitive date selection
- **date-fns**: Date manipulation and formatting

### Backend
- **Node.js**: Runtime environment
- **Express**: Web server framework
- **Google APIs**: Calendar and OAuth integration
- **CORS**: Cross-origin resource sharing

## Prerequisites

### For Docker Deployment (Recommended)
- Docker and Docker Compose installed
- Google Account with Calendar access
- Ubuntu server (for deployment)

### For Manual Installation
- Node.js 18+ and npm
- Google Account with Calendar access
- Ubuntu server (for deployment)

## Installation

**🐳 Using Docker? Skip to [Docker Deployment](#docker-deployment-recommended) for the easiest setup.**

### Manual Installation Steps

### 1. Clone the Repository

\`\`\`bash
git clone <your-repo-url>
cd TutorBooking
\`\`\`

### 2. Install Dependencies

\`\`\`bash
npm run install-all
\`\`\`

This will install dependencies for the root, client, and server.

### 3. Configure Google Calendar API

#### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Calendar API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

#### Step 2: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Configure the OAuth consent screen if prompted:
   - Add your email as a test user
   - Add scopes: Google Calendar API
4. Choose "Web application" as the application type
5. Add authorized redirect URIs:
   - `http://localhost:5000/auth/google/callback` (for development)
   - `http://your-domain.com/auth/google/callback` (for production)
6. Save and note your **Client ID** and **Client Secret**

#### Step 3: Configure Environment Variables

\`\`\`bash
cp .env.example .env
\`\`\`

Edit `.env` and add your OAuth credentials:

\`\`\`env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:5000/auth/google/callback
GOOGLE_CALENDAR_ID=primary
TIMEZONE=America/Chicago
ENCRYPTION_KEY=your-random-encryption-key-here
\`\`\`

**Important:** Generate a secure random string for `ENCRYPTION_KEY` in production. This is used to encrypt OAuth tokens stored on your server.

#### Step 4: Connect Google Calendar via Web Interface

1. Start the server: `npm run dev` (or use Docker)
2. Visit the admin panel: `http://localhost:5000/admin`
3. Click "Connect Google Calendar"
4. Sign in with your Google account
5. Grant calendar access
6. You're done! The app will automatically save and refresh tokens

**That's it!** No manual token generation required. The OAuth tokens are encrypted and stored securely on your server.

### 4. Configure Your Booking Settings

All customization options are centralized in `client/src/config.js`. Edit this file to:

**Business Information:**
\`\`\`javascript
businessName: 'Your Business Name',
businessDescription: 'Your booking page description',
\`\`\`

**Schools (Each with Different Session Lengths & Schedules):**
\`\`\`javascript
schools: [
  {
    id: 'school-1',
    name: 'Elementary School',
    address: '123 Main St',
    sessionDuration: 30, // 30-minute sessions

    // Available time blocks by day of week (0=Sun, 1=Mon, etc.)
    availability: {
      1: [{ start: '08:00', end: '15:00' }], // Monday 8am-3pm
      2: [{ start: '08:00', end: '15:00' }], // Tuesday 8am-3pm
      // Add more days...
    }
  },
  {
    id: 'school-2',
    name: 'High School',
    address: '456 Oak Ave',
    sessionDuration: 60, // 60-minute sessions

    availability: {
      1: [{ start: '15:30', end: '18:00' }], // Monday 3:30pm-6pm
      // Different schedule than elementary!
    }
  }
]
\`\`\`

**Google Meet Settings:**
\`\`\`javascript
googleMeet: {
  sessionDuration: 60,
  availability: {
    1: [{ start: '09:00', end: '17:00' }], // Monday
    2: [{ start: '09:00', end: '17:00' }], // Tuesday
    // ... more days
  }
}
\`\`\`

**Custom Location Options:**
\`\`\`javascript
locationOptions: {
  allowCustomLocation: true,
  customLocationSessionDuration: 60,
  customLocationAvailability: {
    1: [{ start: '09:00', end: '17:00' }],
    // ... more days
  }
}
\`\`\`

See `client/src/config.js` for the complete configuration with all 4 example schools.

## Docker Deployment (Recommended)

Docker makes deployment simple and consistent across environments.

### Quick Start with Docker

1. **Configure environment variables:**
   ```bash
   cd server
   cp .env.example .env
   # Edit .env with your Google Calendar credentials
   ```

2. **Build and start containers:**
   ```bash
   cd ..  # Back to project root
   docker-compose up -d
   ```

3. **Access the application:**
   - Frontend: http://localhost (or http://your-server-ip)
   - Backend API: http://localhost:5000 (or http://your-server-ip:5000)

### Docker Commands

```bash
# Start containers
docker-compose up -d

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f server
docker-compose logs -f client

# Stop containers
docker-compose down

# Rebuild containers after code changes
docker-compose up -d --build

# Stop and remove containers, networks, and volumes
docker-compose down -v
```

### Production Docker Deployment

For production on your Ubuntu server:

1. **Install Docker and Docker Compose:**
   ```bash
   # Update package index
   sudo apt update

   # Install Docker
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh

   # Install Docker Compose
   sudo apt install docker-compose

   # Add your user to docker group (optional, to run without sudo)
   sudo usermod -aG docker $USER
   newgrp docker
   ```

2. **Clone and configure:**
   ```bash
   git clone <your-repo-url>
   cd TutorBooking

   # Configure environment
   cd server
   cp .env.example .env
   nano .env  # Edit with your credentials

   # Configure booking settings
   cd ../client/src
   nano config.js  # Customize your settings
   ```

3. **Deploy with Docker:**
   ```bash
   cd ..  # Back to project root
   docker-compose up -d --build
   ```

5. **Connect Google Calendar:**
   - Open your browser and visit: `http://your-server-ip/admin`
   - Click "Connect Google Calendar"
   - Sign in and authorize
   - Done! Tokens are encrypted and stored automatically

6. **Configure firewall:**
   ```bash
   # Allow HTTP traffic
   sudo ufw allow 80/tcp
   sudo ufw allow 5000/tcp  # If you want direct API access
   sudo ufw enable
   ```

7. **Set up auto-restart:**
   Docker Compose containers are configured with `restart: unless-stopped`, so they'll automatically restart on server reboot.

### HTTPS with Docker and Nginx Proxy

For production with SSL, use a reverse proxy like Nginx Proxy Manager or Traefik:

**Option 1: Using Nginx Proxy Manager (Easiest)**

1. Install Nginx Proxy Manager in Docker
2. Point it to http://localhost:80 for your booking app
3. Configure SSL certificate through the UI

**Option 2: Using Let's Encrypt with Certbot**

1. Install Certbot on host:
   ```bash
   sudo apt install certbot
   ```

2. Stop containers temporarily:
   ```bash
   docker-compose down
   ```

3. Get certificate:
   ```bash
   sudo certbot certonly --standalone -d your-domain.com
   ```

4. Update `docker-compose.yml` to mount certificates:
   ```yaml
   client:
     volumes:
       - /etc/letsencrypt:/etc/letsencrypt:ro
   ```

5. Update `client/nginx.conf` to use SSL

### Docker Health Checks

The containers include health checks:
- Server health check: `http://localhost:5000/api/health`
- Client health check: Nginx availability

View health status:
```bash
docker-compose ps
```

### Updating the Application

```bash
# Pull latest changes
git pull

# Rebuild and restart containers
docker-compose up -d --build

# View logs to ensure everything started correctly
docker-compose logs -f
```

## Manual Development (Without Docker)

If you prefer to develop without Docker:

\`\`\`bash
npm run install-all
npm run dev
\`\`\`

This starts:
- Frontend: http://localhost:3000
- Backend: http://localhost:5000

## Manual Production Deployment

**Note:** Docker deployment is recommended. Use manual deployment only if Docker is not available.

### Build the Frontend

\`\`\`bash
npm run build
\`\`\`

### Run the Production Server

\`\`\`bash
cd server
NODE_ENV=production npm start
\`\`\`

### Using PM2 for Process Management

\`\`\`bash
# Install PM2 globally
sudo npm install -g pm2

# Start the server
cd server
pm2 start server.js --name tutor-booking

# Set up PM2 to start on system boot
pm2 startup
pm2 save
\`\`\`

### Nginx Reverse Proxy (Recommended)

Create an Nginx configuration:

\`\`\`nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
\`\`\`

### SSL/HTTPS with Let's Encrypt

\`\`\`bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
\`\`\`

## Admin Panel

The application includes an admin panel at `/admin` for easy Google Calendar management.

### Features

- **Connection Status**: See if Google Calendar is connected
- **One-Click OAuth**: Connect with a simple button click (no manual token generation)
- **Secure Token Storage**: Tokens are encrypted and stored locally
- **Easy Disconnect**: Disconnect and reconnect as needed

### Accessing the Admin Panel

1. **Development**: Visit `http://localhost:5000/admin`
2. **Production**: Visit `http://your-domain.com/admin`

### OAuth Setup Flow

1. Click "Connect Google Calendar" in the admin panel
2. Sign in with your Google account
3. Grant calendar and event permissions
4. Get redirected back with success confirmation
5. Tokens are automatically saved and encrypted

### Security

- Tokens are encrypted using AES-256-GCM encryption
- Encryption key is stored in environment variables
- Tokens are never exposed in logs or responses
- OAuth flow uses HTTPS in production (recommended)

### Manual Token Setup (Alternative)

If you prefer manual setup, you can still use environment variables:

```env
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
```

The system will automatically use tokens from the web interface if available, or fall back to environment variables.

## API Endpoints

### `POST /api/availability`
Get available time slots for a specific date with drive time consideration.

**Request Body:**
\`\`\`json
{
  "date": "2024-01-15T00:00:00.000Z",
  "schoolId": "elementary-school",
  "sessionDuration": 30
}
\`\`\`

**Response:**
\`\`\`json
{
  "slots": [
    { "time": "2024-01-15T09:00:00.000Z", "available": true },
    { "time": "2024-01-15T10:00:00.000Z", "available": true }
  ]
}
\`\`\`

**Note:** This endpoint automatically accounts for drive time between different school locations. Time slots that don't allow enough travel time from previous bookings are automatically filtered out.

### `GET /api/availability/:date` (Legacy)
Get available time slots for a specific date (without drive time consideration).

**Response:**
\`\`\`json
{
  "slots": [
    { "time": "2024-01-15T09:00:00.000Z", "available": true },
    { "time": "2024-01-15T10:00:00.000Z", "available": false }
  ]
}
\`\`\`

### `POST /api/bookings`
Create a new booking.

**Request Body:**
\`\`\`json
{
  "date": "2024-01-15T00:00:00.000Z",
  "time": "2024-01-15T09:00:00.000Z",
  "meetingType": "google-meet",
  "location": "",
  "schoolId": "elementary-school",
  "sessionDuration": 30,
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "notes": "Need help with calculus"
}
\`\`\`

**Note:** The `schoolId` is stored with the calendar event to enable drive time calculations for future bookings.

### `GET /api/health`
Check server health and Google Calendar connection status.

## Customization

Most settings can be customized in `client/src/config.js`. Here are the key options:

### Business Settings

\`\`\`javascript
businessName: 'Tutoring Services',
businessDescription: 'Schedule your tutoring session in just a few steps',
\`\`\`

### Booking Rules

\`\`\`javascript
booking: {
  advanceBookingDays: 90,  // How far ahead clients can book
  allowWeekends: false     // Global weekend setting (can be overridden per school)
}
\`\`\`

### School Configuration

**Each school can have its own session duration and availability schedule:**

\`\`\`javascript
schools: [
  {
    id: 'elementary-school',
    name: 'Lincoln Elementary School',
    address: '123 Main St, Springfield',
    sessionDuration: 30, // 30 minute sessions

    // Available time blocks per day of week
    // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    availability: {
      1: [ // Monday
        { start: '08:00', end: '12:00' },
        { start: '13:00', end: '15:30' }
      ],
      2: [ // Tuesday
        { start: '08:00', end: '12:00' },
        { start: '13:00', end: '15:30' }
      ],
      // ... more days
    }
  },
  {
    id: 'high-school',
    name: 'Jefferson High School',
    address: '789 Elm Street, Springfield',
    sessionDuration: 60, // 60 minute sessions

    availability: {
      1: [{ start: '15:30', end: '18:00' }], // Monday
      2: [{ start: '15:30', end: '18:00' }], // Tuesday
      // ... more days
    }
  }
]
\`\`\`

**Key Features:**
- ✅ **Different session lengths** per school (30, 45, 60 minutes, etc.)
- ✅ **Custom schedules** per school with multiple time blocks per day
- ✅ **Flexible availability** - some schools can have weekend hours
- ✅ **Multiple time blocks** - e.g., morning and afternoon sessions

### Google Meet Configuration

\`\`\`javascript
googleMeet: {
  enabled: true,
  sessionDuration: 60, // Default session duration for Google Meet

  // Available time blocks for Google Meet sessions
  availability: {
    1: [{ start: '09:00', end: '17:00' }], // Monday
    2: [{ start: '09:00', end: '17:00' }], // Tuesday
    // ... more days
  }
}
\`\`\`

### Custom Location Options

\`\`\`javascript
locationOptions: {
  allowCustomLocation: true,
  customLocationSessionDuration: 60, // Session duration for custom locations
  customLocationPlaceholder: 'Enter your preferred meeting location...',
  customLocationHelp: 'Please provide a specific address or location name',

  // Availability schedule for custom locations
  customLocationAvailability: {
    1: [{ start: '09:00', end: '17:00' }],
    2: [{ start: '09:00', end: '17:00' }],
    // ... more days
  }
}
\`\`\`

### Drive Time Between Locations

The system automatically accounts for travel time between different school locations to prevent back-to-back bookings that don't allow enough time to travel.

**Configuration:** Edit `server/schoolConfig.js` to define actual drive times between schools:

\`\`\`javascript
driveTimes: {
  'elementary-school': {
    'middle-school': 15,    // 15 minutes actual drive time
    'high-school': 20,      // 20 minutes actual drive time
    'community-center': 10  // 10 minutes actual drive time
  },
  'middle-school': {
    'elementary-school': 15,
    'high-school': 12,
    'community-center': 18
  },
  // ... more schools
}
\`\`\`

**How It Works:**

1. **Actual Drive Time + Walking Buffer**: For each route, define the actual driving time in minutes. The system automatically adds 5 minutes for walking/parking.

2. **Rounding**: Total time is rounded to the nearest 5 minutes for cleaner scheduling.

3. **Automatic Blocking**: When a client tries to book at a different school than their previous session, the system checks if there's enough time to travel and blocks slots that are too close.

**Example:**
- Drive time from Elementary to Middle School: 15 minutes
- Walking/parking buffer: +5 minutes
- **Total buffer: 20 minutes** (rounded to nearest 5)
- If you have a session at Elementary ending at 3:00 PM, the earliest available slot at Middle School is 3:20 PM

**Special Cases:**
- **Same school**: No drive time needed (buffer = 0)
- **Google Meet sessions**: No drive time needed (virtual meetings)
- **Undefined routes**: System defaults to 30 minutes and logs a warning

**Benefits:**
- ✅ Prevents impossible scheduling scenarios
- ✅ Accounts for realistic travel time
- ✅ Includes time for parking and walking
- ✅ No manual buffer management needed

### How Scheduling Works

1. **Client selects a school** → System loads that school's session duration and availability
2. **Client picks a date** → Only dates with available time blocks are enabled
3. **System generates time slots** → Based on the school's availability blocks and session duration
4. **Booking created** → Calendar event created with the correct session length

**Example:**
- Elementary School: 30-min sessions, 8:00-12:00, 1:00-3:30
  - Available slots: 8:00, 8:30, 9:00, 9:30... 1:00, 1:30, 2:00, 2:30, 3:00
- High School: 60-min sessions, 3:30-6:00
  - Available slots: 3:30, 4:30

### Meeting Types

\`\`\`javascript
meetingTypes: {
  googleMeet: {
    enabled: true,
    label: 'Google Meet',
    description: 'Join remotely via video call...',
    icon: '📹'
  },
  physical: {
    enabled: true,
    label: 'School Location',
    description: 'Meet in person at one of the schools.',
    icon: '🏫'
  }
}
\`\`\`

## Troubleshooting

### Google Calendar Not Connected

1. Check that all environment variables are set correctly in `.env`
2. Verify that the Google Calendar API is enabled in Google Cloud Console
3. Ensure your OAuth credentials have the correct redirect URIs
4. Check the server logs for specific error messages

### Time Zone Issues

Make sure the `TIMEZONE` environment variable matches your local timezone:

\`\`\`bash
# List available timezones
timedatectl list-timezones

# Set in .env
TIMEZONE=America/New_York
\`\`\`

### Port Already in Use

Change the port in `.env`:

\`\`\`env
PORT=5001
\`\`\`

## Future Enhancements

- [ ] Database integration (PostgreSQL/MongoDB)
- [ ] User authentication for multiple tutors with separate calendars
- [ ] Email templates customization
- [ ] SMS reminders via Twilio
- [ ] Payment integration
- [ ] Recurring sessions
- [ ] Booking history and management dashboard
- [ ] Multiple timezone support for clients
- [ ] Waiting list functionality
- [ ] Client rescheduling and cancellation

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
