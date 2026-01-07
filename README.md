# Tutor Booking System

A self-hosted booking application similar to Calendly, built for scheduling tutoring sessions with Google Calendar integration.

## Features

- 📅 **Date & Time Selection**: Interactive calendar with available time slots
- 📹 **Google Meet Integration**: Automatically generates Google Meet links for virtual sessions
- 📍 **Physical Location Options**: Select from predefined physical meeting locations
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

- Node.js 18+ and npm
- Google Account with Calendar access
- Ubuntu server (for deployment)

## Installation

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

### 4. Customize Physical Locations

Edit the `PHYSICAL_LOCATIONS` array in `client/src/App.jsx` to match your actual locations:

\`\`\`javascript
const PHYSICAL_LOCATIONS = [
  'Your Office - Address Line 1',
  'Second Location - Address Line 2',
  // Add more locations as needed
]
\`\`\`

## Development

Run the development servers:

\`\`\`bash
npm run dev
\`\`\`

This starts:
- Frontend: http://localhost:3000
- Backend: http://localhost:5000

## Production Deployment

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

### Working Hours

Edit the time slot generation in `client/src/App.jsx`:

\`\`\`javascript
const startHour = 9  // 9 AM
const endHour = 17   // 5 PM
const slotDuration = 60 // 60 minutes
\`\`\`

### Session Duration

Change the duration in `server/server.js`:

\`\`\`javascript
const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000) // 1 hour
\`\`\`

### Available Days

Modify the `isDateDisabled` function in `client/src/App.jsx` to change which days are bookable.

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
