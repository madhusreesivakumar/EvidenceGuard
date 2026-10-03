'use strict';
/**
 * config/env.js
 * Sprint 8A – startup environment validation.
 * Import ONCE at the very top of server.js before any other require().
 */

const KNOWN_PLACEHOLDERS = [
  'changeme', 'secret', 'your-secret-here', 'replace-me',
  // The exact .env.example placeholder
  'CHANGE_ME_TO_A_LONG_RANDOM_STRING'
];

function fail(...lines) {
  console.error('\n[STARTUP] FATAL – Invalid configuration:\n');
  lines.forEach(l => console.error('  ✖ ' + l));
  console.error('\nFix the above issues in your .env file, then restart.\n');
  process.exit(1);
}

function warn(msg) {
  console.warn('[STARTUP] WARNING: ' + msg);
}

// ── Load dotenv first ────────────────────────────────────────────────────────
require('dotenv').config();

const errors = [];
const isProduction = process.env.NODE_ENV === 'production';

// ── MONGODB_URI ───────────────────────────────────────────────────────────────
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri || mongoUri.trim() === '') {
  errors.push('MONGODB_URI is required');
}

// ── JWT_SECRET ────────────────────────────────────────────────────────────────
const jwtSecret = process.env.JWT_SECRET || '';
if (!jwtSecret || jwtSecret.length < 32) {
  errors.push('JWT_SECRET must be at least 32 characters long');
} else if (isProduction) {
  const lc = jwtSecret.toLowerCase();
  if (KNOWN_PLACEHOLDERS.some(p => lc.includes(p.toLowerCase()))) {
    errors.push('JWT_SECRET looks like a placeholder. Use a random secret in production.');
  }
}

// ── PORT ──────────────────────────────────────────────────────────────────────
const portRaw = process.env.PORT || '3000';
const port = parseInt(portRaw, 10);
if (isNaN(port) || port < 1 || port > 65535) {
  errors.push(`PORT must be a valid port number (got: "${portRaw}")`);
}

// ── PUBLIC_BASE_URL ───────────────────────────────────────────────────────────
const rawPublicBaseUrl = process.env.PUBLIC_BASE_URL || '';
if (!rawPublicBaseUrl) {
  errors.push('PUBLIC_BASE_URL is required');
} else {
  try {
    const parsedUrl = new URL(rawPublicBaseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      errors.push('PUBLIC_BASE_URL must use http or https protocol');
    }
    if (rawPublicBaseUrl.endsWith('/')) {
      errors.push('PUBLIC_BASE_URL must not have a trailing slash');
    }
    if (isProduction && rawPublicBaseUrl.includes('localhost')) {
      errors.push('PUBLIC_BASE_URL must not contain "localhost" in production');
    }
  } catch (e) {
    errors.push(`PUBLIC_BASE_URL is not a valid URL: ${e.message}`);
  }
}

// ── Production-only checks ────────────────────────────────────────────────────
if (isProduction) {
  if (!process.env.CLIENT_ORIGIN) {
    warn('CLIENT_ORIGIN is not set; CORS will be same-origin only (recommended for production)');
  }
  // Cookies will only be Secure in production; warn if someone disabled it explicitly.
  // (We always set secure: NODE_ENV === 'production' so this is informational)
}

// ── Non-localhost QR warning (non-fatal) ──────────────────────────────────────
if (rawPublicBaseUrl && rawPublicBaseUrl.includes('localhost') && !isProduction) {
  warn(
    "PUBLIC_BASE_URL contains 'localhost'. Phones cannot scan QR codes or open links via localhost. " +
    "Use your LAN IP (e.g. http://192.168.1.50:3000) or a tunnel URL for mobile demos."
  );
}

// ── Fail fast ─────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  fail(...errors);
}

// Export validated values for use in server.js
module.exports = {
  mongoUri: mongoUri.trim(),
  jwtSecret,
  port,
  publicBaseUrl: rawPublicBaseUrl,
  isProduction,
  clientOrigin: process.env.CLIENT_ORIGIN || null,
  featureNotifications: process.env.FEATURE_NOTIFICATIONS === 'true',
  smtpHost: process.env.SMTP_HOST || 'localhost',
  smtpPort: parseInt(process.env.SMTP_PORT || '1025', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpSecure: process.env.SMTP_SECURE === 'true',
  emailFrom: process.env.EMAIL_FROM || 'EvidenceGuard Security <notifications@evidenceguard.local>'
};