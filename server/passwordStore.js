import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const DATA_DIR = process.env.DATA_DIR || './data';
const PASSWORD_FILE = path.join(DATA_DIR, 'admin-password.json');

/**
 * Password storage module - stores admin password hash in persistent volume
 * Falls back to ADMIN_PASSWORD_HASH env var if no custom password is set
 */
class PasswordStore {
  /**
   * Get the current admin password hash
   * Checks persistent file first, then falls back to env var
   */
  getPasswordHash() {
    try {
      if (fs.existsSync(PASSWORD_FILE)) {
        const data = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
        if (data.passwordHash) {
          return data.passwordHash;
        }
      }
    } catch (error) {
      console.error('Error reading password file:', error);
    }

    // Fall back to environment variable
    return process.env.ADMIN_PASSWORD_HASH;
  }

  /**
   * Set a new admin password hash
   * Stores in persistent file that survives container restarts
   */
  setPasswordHash(passwordHash) {
    try {
      // Ensure data directory exists
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const data = {
        passwordHash,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(PASSWORD_FILE, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Error writing password file:', error);
      return false;
    }
  }

  /**
   * Verify a password against the stored hash
   */
  async verifyPassword(password) {
    const hash = this.getPasswordHash();
    if (!hash) {
      return false;
    }
    return await bcrypt.compare(password, hash);
  }

  /**
   * Hash a new password
   */
  async hashPassword(password) {
    return await bcrypt.hash(password, 10);
  }

  /**
   * Change the admin password
   * Validates current password before setting new one
   */
  async changePassword(currentPassword, newPassword) {
    // Verify current password
    const isValid = await this.verifyPassword(currentPassword);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
    }

    // Hash and store new password
    const newHash = await this.hashPassword(newPassword);
    const success = this.setPasswordHash(newHash);

    if (!success) {
      throw new Error('Failed to save new password');
    }

    return true;
  }
}

export default new PasswordStore();
