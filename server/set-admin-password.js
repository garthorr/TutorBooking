#!/usr/bin/env node
import bcrypt from 'bcryptjs'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const password = process.argv[2]

if (!password) {
  console.error('Usage: node set-admin-password.js <your-password>')
  process.exit(1)
}

const hash = bcrypt.hashSync(password, 10)

// Create or update .env file
let envContent = ''
if (existsSync('.env')) {
  envContent = readFileSync('.env', 'utf8')
  // Replace existing ADMIN_PASSWORD_HASH or add it
  if (envContent.includes('ADMIN_PASSWORD_HASH=')) {
    envContent = envContent.replace(/ADMIN_PASSWORD_HASH=.*/, `ADMIN_PASSWORD_HASH=${hash}`)
  } else {
    envContent += `\nADMIN_PASSWORD_HASH=${hash}\n`
  }
} else {
  // Read from .env.example template
  if (existsSync('.env.example')) {
    envContent = readFileSync('.env.example', 'utf8')
  }
  envContent = envContent.replace('ADMIN_PASSWORD_HASH=', `ADMIN_PASSWORD_HASH=${hash}`)
}

writeFileSync('.env', envContent)
console.log('✅ Admin password set successfully!')
console.log('🔄 Restart the server to apply changes: docker compose restart server')
