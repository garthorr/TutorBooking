import express from 'express';
import {
  login,
  changePassword,
  verifyAdmin,
  initiateGoogleOAuth,
  googleOAuthCallback,
  getOAuthStatus,
  disconnectGoogleCalendar
} from '../controllers/authController.js';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// Admin auth middleware
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token — please log in again' });
  }
}

router.post('/admin/login', login);
router.post('/admin/change-password', adminAuth, changePassword);
router.get('/admin/verify', adminAuth, verifyAdmin);

router.get('/google', initiateGoogleOAuth);
router.get('/google/callback', googleOAuthCallback);
router.get('/status', adminAuth, getOAuthStatus);
router.post('/disconnect', adminAuth, disconnectGoogleCalendar);

export default router;
export { adminAuth };
