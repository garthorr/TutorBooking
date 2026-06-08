import nodemailer from 'nodemailer';
import dbService from './dbService.js';

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

function manageUrl(token) {
  if (!token) return null;
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
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

export async function sendReminder(booking, label) {
  const b = normalize(booking);
  await send(b.email, `Reminder: your session is ${label}`,
    layout(`Your session is ${label}`,
      `<p>Hi ${esc(b.name)}, this is a reminder about your upcoming session:</p>${detailsHtml(b)}${manageHtml(b.manageToken)}`));
}
