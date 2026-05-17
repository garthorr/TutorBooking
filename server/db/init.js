import db, { initializeDefaultUser } from './database.js';

async function init() {
  try {
    const adminId = await initializeDefaultUser();
    console.log('Database initialized successfully. Admin ID:', adminId);
    process.exit(0);
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

init();
