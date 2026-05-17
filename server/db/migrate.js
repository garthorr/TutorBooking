import db from './database.js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

function migrateFile(filename, table, mapFn) {
  const filePath = path.join(DATA_DIR, filename);
  if (existsSync(filePath)) {
    console.log(`Migrating ${filename}...`);
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      mapFn(data);
      console.log(`✓ ${filename} migrated.`);
    } catch (error) {
      console.error(`Error migrating ${filename}:`, error);
    }
  }
}

async function migrate() {
  const adminId = 1;
  migrateFile('schools.json', 'schools', (data) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO schools (id, user_id, name, address, availability) VALUES (?, ?, ?, ?, ?)');
    for (const school of data) {
      stmt.run(school.id, adminId, school.name, school.address, JSON.stringify(school.availability));
    }
  });
  console.log('Migration completed.');
}

migrate();
