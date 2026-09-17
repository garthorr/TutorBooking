import nodemailer from 'nodemailer';
import dbService from './dbService.js';
import { parseGuestEmails } from './guests.js';

/*
 * Optional transactional email. Entirely no-op unless SMTP is configured via
 * env vars, so the app keeps working (relying on Google Calendar invites) when
 * email is not set up.
 *
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE (true/false),
 *   SMTP_USER, SMTP_PASS, EMAIL_FROM, PUBLIC_BASE_URL
 */

const TIMEZONE = process.env.TIMEZONE || 'America/Chicago';

let transporter;

export function isEmailEnabled() {
  return Boolean(process.env.SMTP_HOST);
}

function getTransporter() {
  if (transporter !== undefined) return transporter;
  if (!process.env.SMTP_HOST) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return transporter;
}

// Escape any user-controlled value before interpolating it into email HTML.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function businessName() {
  return dbService.getSettings(1)?.business_name || 'Tutoring';
}

/*
 * Absolute URL of a booking's self-service page, or null when one cannot be
 * built. Exported because the calendar invite carries it too: guests get no
 * email from us, so the invite is the only place they can reach it.
 *
 * Without PUBLIC_BASE_URL this would be a bare "/manage/…" path, which is
 * useless in an email or a calendar invite, so the link is omitted instead.
 */
export function manageUrl(token) {
  if (!token) return null;
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/manage/${token}`;
}

function formatWhen(timeISO, tz) {
  const d = new Date(timeISO);
  if (isNaN(d.getTime())) return timeISO;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: tz || TIMEZONE
  }).format(d);
}

// Normalize either a camelCase (freshly created) or snake_case (DB row) booking.
// Times are shown in the timezone the client booked in, when known.
function normalize(booking) {
  return {
    email: booking.email,
    name: booking.name,
    timeISO: booking.time,
    timezone: booking.timezone ?? booking.client_timezone ?? null,
    location: booking.location,
    sessionDuration: booking.sessionDuration ?? booking.session_duration,
    // An array on a freshly created booking, a JSON string on a row read back.
    guests: parseGuestEmails(booking.guestEmails ?? booking.guest_emails),
    manageToken: booking.manageToken ?? booking.manage_token,
    meetLink: booking.meetLink ?? booking.meet_link
  };
}

function layout(heading, bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
  <h2 style="color:#0f172a">${esc(heading)}</h2>
  ${bodyHtml}
  <p style="color:#64748b;font-size:13px;margin-top:24px">${esc(businessName())}</p>
</div>`;
}

function detailsHtml(b) {
  const rows = [
    ['When', esc(formatWhen(b.timeISO, b.timezone))],
    ['Length', b.sessionDuration ? `${esc(b.sessionDuration)} minutes` : null],
    ['Location', esc(b.location)],
    ['Also invited', b.guests.length > 0 ? esc(b.guests.join(', ')) : null],
    ['Video link', b.meetLink ? `<a href="${esc(b.meetLink)}">${esc(b.meetLink)}</a>` : null]
  ].filter(([, v]) => v);
  return `<table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#64748b">${k}</td><td style="padding:6px 0">${v}</td></tr>`
  ).join('')}</table>`;
}

function manageHtml(token) {
  const url = manageUrl(token);
  if (!url) return '';
  return `<p style="margin-top:20px"><a href="${url}" style="color:#4f46e5">Reschedule or cancel this session</a></p>`;
}

async function send(to, subject, html) {
  const t = getTransporter();
  if (!t || !to) return;
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost';
  try {
    await t.sendMail({ from, to, subject, html });
  } catch (error) {
    console.error('[email] send failed:', error.message);
  }
}

export async function sendConfirmation(booking) {
  const b = normalize(booking);
  await send(b.email, `Booking confirmed — ${formatWhen(b.timeISO, b.timezone)}`,
    layout(`You're booked, ${b.name}!`,
      `<p>Your session is confirmed. Details below:</p>${detailsHtml(b)}${manageHtml(b.manageToken)}`));
}

export async function sendReschedule(booking) {
  const b = normalize(booking);
  await send(b.email, `Booking rescheduled — ${formatWhen(b.timeISO, b.timezone)}`,
    layout('Your session was rescheduled',
      `<p>Hi ${esc(b.name)}, your session has been moved. Here are the new details:</p>${detailsHtml(b)}${manageHtml(b.manageToken)}`));
}

export async function sendCancellation(booking) {
  const b = normalize(booking);
  await send(b.email, 'Booking cancelled',
    layout('Your session was cancelled',
      `<p>Hi ${esc(b.name)}, your session for <strong>${esc(formatWhen(b.timeISO, b.timezone))}</strong> has been cancelled. ` +
      `If this was a mistake, you can book again any time.</p>`));
}

/*
 * Notify the tutor that a booking was made.
 *
 * Goes to ADMIN_EMAIL, falling back to EMAIL_FROM then SMTP_USER, so a normal
 * SMTP setup needs no extra configuration. Without this the only signal is the
 * Google Calendar invite — and a same-day booking suppresses both reminder
 * emails, so a session booked for this afternoon could arrive unannounced.
 */
function adminRecipient() {
  return process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || process.env.SMTP_USER || null;
}

export async function notifyAdminOfBooking(booking, { createdBy = 'public' } = {}) {
  const to = adminRecipient();
  if (!to) return;
  const b = normalize(booking);
  const soon = new Date(b.timeISO).getTime() - Date.now();
  const imminent = soon > 0 && soon <= 4 * 60 * 60 * 1000;
  const rows = [
    ['When', esc(formatWhen(b.timeISO, null))],
    ['Student', esc(b.name)],
    ['Email', esc(b.email)],
    ['Phone', esc(booking.phone ?? booking.phone_number ?? '')],
    ['Length', b.sessionDuration ? `${esc(b.sessionDuration)} minutes` : null],
    ['Location', esc(b.location)],
    ['Guests', b.guests.length > 0 ? esc(b.guests.join(', ')) : null],
    ['Notes', esc(booking.notes)],
    ['Booked via', createdBy === 'admin' ? 'admin panel' : 'booking page']
  ].filter(([, v]) => v);

  await send(to, `${imminent ? '⚠ Soon — ' : ''}New booking: ${b.name}, ${formatWhen(b.timeISO, null)}`,
    layout('New booking',
      (imminent ? '<p style="color:#b3322a"><strong>This session starts within the next few hours.</strong></p>' : '') +
      `<table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top">${k}</td><td style="padding:6px 0">${v}</td></tr>`
      ).join('')}</table>`));
}

export async function sendReminder(booking, label) {
  const b = normalize(booking);
  await send(b.email, `Reminder: your session is ${label}`,
    layout(`Your session is ${label}`,
      `<p>Hi ${esc(b.name)}, this is a reminder about your upcoming session:</p>${detailsHtml(b)}${manageHtml(b.manageToken)}`));
}
