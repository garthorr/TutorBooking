import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import dbService from './services/dbService.js';

const ADMIN_ID = 1;
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_MATERIAL = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
const DERIVED_KEY = scryptSync(ENCRYPTION_KEY_MATERIAL, 'salt', 32);

function encrypt(text) {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, DERIVED_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return { encrypted, iv: iv.toString('hex'), authTag: authTag.toString('hex') };
}

function decrypt(encryptedData) {
  const decipher = createDecipheriv(ALGORITHM, DERIVED_KEY, Buffer.from(encryptedData.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function saveTokens(tokens) {
  try {
    const encryptedData = encrypt(JSON.stringify(tokens));
    dbService.saveTokens(ADMIN_ID, encryptedData);
    return true;
  } catch (error) {
    console.error('Error saving tokens:', error);
    return false;
  }
}

export function loadTokens() {
  try {
    const encryptedData = dbService.getTokens(ADMIN_ID);
    if (!encryptedData) return null;
    const decrypted = decrypt(encryptedData);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Error loading tokens:', error);
    return null;
  }
}

export function deleteTokens() {
  dbService.deleteTokens(ADMIN_ID);
  return true;
}

export function hasTokens() {
  return !!dbService.getTokens(ADMIN_ID);
}

export function getTokenInfo() {
  const info = {
    storage: 'sqlite',
    adminId: ADMIN_ID,
    hasTokens: false,
    hasRefreshToken: false,
    tokenExpiry: null
  };

  const encryptedData = dbService.getTokens(ADMIN_ID);
  if (encryptedData) {
    info.hasTokens = true;
    try {
      const tokens = JSON.parse(decrypt(encryptedData));
      info.hasRefreshToken = !!tokens.refresh_token;
      info.tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;
    } catch (e) {
      info.readError = e.message;
    }
  }
  return info;
}
