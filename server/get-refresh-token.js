import { google } from 'googleapis'
import dotenv from 'dotenv'
import readline from 'readline'

dotenv.config()

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/oauth2callback'
)

const SCOPES = ['https://www.googleapis.com/auth/calendar']

// Generate the URL to get authorization code
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent' // Force to get refresh token
})

console.log('\n=== Google Calendar OAuth Setup ===\n')
console.log('1. Visit this URL to authorize the application:\n')
console.log(authUrl)
console.log('\n2. After authorization, you\'ll be redirected to a URL.')
console.log('3. Copy the "code" parameter from the URL and paste it below.\n')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.question('Enter the authorization code: ', async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code)

    console.log('\n✓ Success! Add these to your .env file:\n')
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log(`\nAccess token (for testing): ${tokens.access_token}\n`)

    if (!tokens.refresh_token) {
      console.log('⚠️  Warning: No refresh token received.')
      console.log('This might happen if you\'ve already authorized this app.')
      console.log('Try revoking access at https://myaccount.google.com/permissions')
      console.log('and run this script again.\n')
    }
  } catch (error) {
    console.error('\n✗ Error getting tokens:', error.message)
  }

  rl.close()
})
