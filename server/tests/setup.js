/*
 * Test bootstrap, loaded via `node --test --import ./tests/setup.js` so it runs
 * before any test module imports db/database.js — which opens its connection at
 * import time, and would otherwise read and write the real development database
 * in server/data.
 *
 * Each test file runs in its own child process and so gets its own throwaway
 * database, seeded with the admin user (id 1) that the schools, settings and
 * bookings tables all reference by foreign key.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const dir = mkdtempSync(path.join(tmpdir(), 'tutorbooking-test-'));
process.env.DATA_DIR = dir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-not-a-real-one';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-not-a-real-one';

const { initializeDefaultUser } = await import('../db/database.js');
await initializeDefaultUser();

process.on('exit', () => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});
