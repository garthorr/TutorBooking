#!/usr/bin/env node
/*
 * Writes ADMIN_PASSWORD_HASH into server/.env.
 *
 * This only decides the password the admin user is SEEDED with, on the very
 * first run against an empty database. Once that user exists the password lives
 * in the database, and this file is no longer consulted — change it at
 * /admin -> Change Password instead.
 */
import bcrypt from 'bcryptjs'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.join(__dirname, '.env')

const password = process.argv[2]

if (!password) {
  console.error('Usage: node set-admin-password.js <your-password>')
  process.exit(1)
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}

// 12 rounds, matching what the app uses everywhere else.
const hash = bcrypt.hashSync(password, 12)

let envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
if (/^ADMIN_PASSWORD_HASH=.*$/m.test(envContent)) {
  envContent = envContent.replace(/^ADMIN_PASSWORD_HASH=.*$/m, `ADMIN_PASSWORD_HASH=${hash}`)
} else {
  envContent += `${envContent.endsWith('\n') || envContent === '' ? '' : '\n'}ADMIN_PASSWORD_HASH=${hash}\n`
}
writeFileSync(ENV_PATH, envContent)

console.log(`✅ ADMIN_PASSWORD_HASH written to ${ENV_PATH}`)
console.log('')
console.log('This sets the password the admin user is created with on a FRESH database.')
console.log('If that user already exists, this changes nothing — use /admin → Change Password.')
