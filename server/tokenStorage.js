import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use DATA_DIR env var for Docker volume support, otherwise store alongside server
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const TOKEN_FILE = join(DATA_DIR, '.tokens.json');
const ALGORITHM = 'aes-256-gcm';

// Get encryption key from environment or generate one
function getEncryptionKey() {
  const keyFromEnv = process.env.ENCRYPTION_KEY;

  if (keyFromEnv) {
    // Derive key from environment variable
    return scryptSync(keyFromEnv, 'salt', 32);
  }

  // For development, use a default key (NOT SECURE FOR PRODUCTION)
  console.warn('WARNING: Using default encryption key. Set ENCRYPTION_KEY in .env for production!');
  return scryptSync('default-key-change-in-production', 'salt', 32);
}

// Encrypt data
function encrypt(text) {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

// Decrypt data
function decrypt(encryptedData) {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encryptedData.iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// Save tokens to encrypted file
export function saveTokens(tokens) {
  try {
    const encryptedData = encrypt(JSON.stringify(tokens));
    writeFileSync(TOKEN_FILE, JSON.stringify(encryptedData, null, 2));
    console.log('Tokens saved successfully');
    return true;
  } catch (error) {
    console.error('Error saving tokens:', error);
    return false;
  }
}

// Load tokens from encrypted file
export function loadTokens() {
  try {
    if (!existsSync(TOKEN_FILE)) {
      return null;
    }

    const encryptedData = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    const decrypted = decrypt(encryptedData);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Error loading tokens:', error);
    return null;
  }
}

// Delete tokens
export function deleteTokens() {
  try {
    if (existsSync(TOKEN_FILE)) {
      writeFileSync(TOKEN_FILE, '');
      console.log('Tokens deleted successfully');
    }
    return true;
  } catch (error) {
    console.error('Error deleting tokens:', error);
    return false;
  }
}

// Check if tokens exist
export function hasTokens() {
  return existsSync(TOKEN_FILE) && readFileSync(TOKEN_FILE, 'utf8').trim() !== '';
}
