import jwt from 'jsonwebtoken';
import passwordStore from '../passwordStore.js';
import { google } from 'googleapis';
import { saveTokens, deleteTokens, getTokenInfo } from '../tokenStorage.js';
import { randomBytes } from 'crypto';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const oauthStates = new Map();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function createOAuthState() {
  const state = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
  oauthStates.set(state, expiresAt);
  if (oauthStates.size > 500) {
    const now = Date.now();
    for (const [key, expiry] of oauthStates.entries()) {
      if (expiry <= now) oauthStates.delete(key);
    }
  }
  return state;
}

function consumeOAuthState(state) {
  if (typeof state !== 'string' || !state) return false;
  const expiresAt = oauthStates.get(state);
  if (!expiresAt) return false;
  oauthStates.delete(state);
  return expiresAt > Date.now();
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/auth/google/callback'
  );
}

export const login = async (req, res) => {
  const { password } = req.body;
  try {
    const match = await passwordStore.verifyPassword(password || '');
    if (!match) return res.status(401).json({ error: 'Invalid password' });
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Login error' });
  }
};

export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  try {
    await passwordStore.changePassword(currentPassword, newPassword);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const verifyAdmin = (req, res) => {
  res.json({ ok: true });
};

export const initiateGoogleOAuth = (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({
      error: 'OAuth not configured',
      message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env'
    });
  }

  const oauth2Client = getOAuthClient();
  const state = createOAuthState();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    prompt: 'consent',
    state
  });
  res.redirect(authUrl);
};

export const googleOAuthCallback = async (req, res) => {
  const { code, error, state } = req.query;
  if (error) return res.redirect('/admin?error=auth_failed');
  if (!code) return res.redirect('/admin?error=no_code');
  if (!consumeOAuthState(String(state || ''))) return res.redirect('/admin?error=invalid_state');

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (saveTokens(tokens)) {
      res.redirect('/admin?success=true');
    } else {
      res.redirect('/admin?error=save_failed');
    }
  } catch (error) {
    res.redirect('/admin?error=token_exchange_failed');
  }
};

export const getOAuthStatus = (req, res) => {
  const info = getTokenInfo();
  res.json({
    ...info,
    configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    connected: info.hasTokens && info.hasRefreshToken
  });
};

export const disconnectGoogleCalendar = (req, res) => {
  const deleted = deleteTokens();
  res.json({
    success: deleted,
    message: deleted ? 'Google Calendar disconnected' : 'Error disconnecting'
  });
};
