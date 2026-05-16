import bcrypt from 'bcryptjs';
import dbService from './services/dbService.js';
import db from './db/database.js';

class PasswordStore {
  getPasswordHash() {
    const admin = dbService.getAdminUser();
    return admin?.password_hash;
  }

  setPasswordHash(passwordHash) {
    const admin = dbService.getAdminUser();
    if (!admin) return false;

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(passwordHash, admin.id);
    return true;
  }

  async verifyPassword(password) {
    const hash = this.getPasswordHash();
    if (!hash) return false;
    return await bcrypt.compare(password, hash);
  }

  async hashPassword(password) {
    return await bcrypt.hash(password, 10);
  }

  async changePassword(currentPassword, newPassword) {
    const isValid = await this.verifyPassword(currentPassword);
    if (!isValid) throw new Error('Current password is incorrect');
    if (!newPassword || newPassword.length < 8) throw new Error('New password must be at least 8 characters');

    const newHash = await this.hashPassword(newPassword);
    return this.setPasswordHash(newHash);
  }
}

export default new PasswordStore();
