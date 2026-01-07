# Tutor Booking System

A self-hosted booking application similar to Calendly, built for scheduling tutoring sessions with Google Calendar integration.

## Features

- 📅 **Date & Time Selection**: Interactive calendar with available time slots
- 📹 **Google Meet Integration**: Automatically generates Google Meet links for virtual sessions
- 📍 **Physical Location Options**: Select from predefined locations or enter custom locations
- ✏️ **Custom Location Entry**: Allow clients to specify their own meeting location
- ⚙️ **Easy Configuration**: Centralized config file for all customization options
- 🔄 **Google Calendar Sync**: Real-time availability checking and automatic calendar event creation
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
3. Configure the OAuth consent screen if prompted
4. Choose "Web application" as the application type
5. Add authorized redirect URIs:
   - `http://localhost:5000/oauth2callback` (for development)
   - `http://your-server-ip:5000/oauth2callback` (for production)
6. Save and note your **Client ID** and **Client Secret**

#### Step 3: Get Refresh Token

You'll need to run a one-time OAuth flow to get a refresh token. Here's a quick script:

\`\`\`bash
cd server
node get-refresh-token.js
\`\`\`

Follow the URL, authorize the application, and copy the refresh token.

#### Step 4: Configure Environment Variables

\`\`\`bash
cp .env.example .env
\`\`\`

Edit `.env` and add your credentials:

\`\`\`env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
GOOGLE_CALENDAR_ID=primary
TIMEZONE=America/New_York
\`\`\`

### 4. Configure Your Booking Settings

All customization options are centralized in `client/src/config.js`. Edit this file to:

**Business Information:**
\`\`\`javascript
businessName: 'Your Business Name',
businessDescription: 'Your booking page description',
\`\`\`

**Physical Locations:**
\`\`\`javascript
physicalLocations: [
  'Your Office - Address Line 1',
  'Second Location - Address Line 2',
  // Add more locations as needed
]
\`\`\`

**Location Options:**
\`\`\`javascript
locationOptions: {
  allowCustomLocation: true, // Enable/disable custom location entry
  customLocationPlaceholder: 'Enter your preferred meeting location...',
  customLocationHelp: 'Please provide a specific address or location name'
}
\`\`\`

**Working Hours:**
\`\`\`javascript
booking: {
  startHour: 9,  // 9 AM
  endHour: 17,   // 5 PM
  sessionDuration: 60,  // 60 minutes
  advanceBookingDays: 90,  // How far in advance can clients book?
  allowWeekends: false  // Allow booking on weekends?
}
\`\`\`

See `client/src/config.js` for all available options.

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

3. **Get Google Calendar refresh token:**
   ```bash
   # Install dependencies temporarily
   cd ../../server
   npm install
   node get-refresh-token.js
   # Follow instructions, then add token to .env
   ```

4. **Deploy with Docker:**
   ```bash
   cd ..  # Back to project root
   docker-compose up -d --build
   ```

5. **Configure firewall:**
   ```bash
   # Allow HTTP traffic
   sudo ufw allow 80/tcp
   sudo ufw allow 5000/tcp  # If you want direct API access
   sudo ufw enable
   ```

6. **Set up auto-restart:**
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

## API Endpoints

### `GET /api/availability/:date`
Get available time slots for a specific date.

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
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "notes": "Need help with calculus"
}
\`\`\`

### `GET /api/health`
Check server health and Google Calendar connection status.

## Customization

Most settings can be customized in `client/src/config.js`. Here are the key options:

### Business Settings

\`\`\`javascript
businessName: 'Tutoring Services',
businessDescription: 'Schedule your tutoring session in just a few steps',
\`\`\`

### Booking Hours & Rules

\`\`\`javascript
booking: {
  startHour: 9,           // Start time (24-hour format)
  endHour: 17,            // End time (24-hour format)
  sessionDuration: 60,    // Duration in minutes
  advanceBookingDays: 90, // How far ahead clients can book
  allowWeekends: false    // Allow weekend bookings
}
\`\`\`

### Location Configuration

\`\`\`javascript
// Predefined locations
physicalLocations: [
  'Main Office - 123 Main St, Suite 100',
  'Downtown Branch - 456 Center Ave'
],

// Custom location options
locationOptions: {
  allowCustomLocation: true,  // Enable custom location entry
  customLocationPlaceholder: 'Enter your preferred meeting location...',
  customLocationHelp: 'Please provide a specific address or location name'
}
\`\`\`

### Meeting Types

Enable or disable meeting types and customize labels:

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
    label: 'Physical Location',
    description: 'Meet in person at a location of your choice.',
    icon: '📍'
  }
}
\`\`\`

### Session Duration (Backend)

For different session durations, also update `server/server.js`:

\`\`\`javascript
// Line ~158
const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000) // 1 hour
\`\`\`

Change `60 * 60 * 1000` to match your session duration in milliseconds.

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
- [ ] User authentication for multiple tutors
- [ ] Email templates customization
- [ ] SMS reminders via Twilio
- [ ] Payment integration
- [ ] Recurring sessions
- [ ] Admin dashboard
- [ ] Multiple timezone support
- [ ] Waiting list functionality

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
