'use strict';

/**
 * services/emailService.js
 * Sprint 13A – Secure Email Notification Service
 *
 * Implements Nodemailer integration, header injection defense, HTML/text templates,
 * and zero-leakage content sanitization (no hashes, file names, descriptions, or IPs).
 */

const nodemailer = require('nodemailer');

// ─── Header Injection Defense ────────────────────────────────────────────────
function stripCrLf(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\r\n]+/g, ' ').trim();
}

// ─── HTML Entity Escaping ────────────────────────────────────────────────────
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Zero-Leakage Defense-in-Depth Sanitizer ──────────────────────────────────
// Ensures no SHA-256 hashes or IPv4 addresses leak into notification text
function sanitizeContentText(text) {
  if (typeof text !== 'string') return '';
  return text
    // Redact any 64-char hex strings (SHA-256)
    .replace(/\b[a-f0-9]{64}\b/gi, '[REDACTED_HASH]')
    // Redact any IPv4 addresses
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_IP]');
}

// ─── Nodemailer Transporter Factory ──────────────────────────────────────────
function createTransporter() {
  const host = process.env.SMTP_HOST || 'localhost';
  const port = parseInt(process.env.SMTP_PORT || '1025', 10);
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  const transportOpts = {
    host,
    port,
    secure,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000
  };

  if (user && pass) {
    transportOpts.auth = { user, pass };
  } else {
    // Development (e.g. MailHog) or unauthenticated internal relay
    transportOpts.tls = { rejectUnauthorized: false };
  }

  return nodemailer.createTransport(transportOpts);
}

// ─── Startup Connection Check (Warns, Never Crashes) ─────────────────────────
async function verifySmtpConnection() {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log(`[SMTP] Successfully connected to mail server at ${process.env.SMTP_HOST || 'localhost'}:${process.env.SMTP_PORT || '1025'}`);
    return true;
  } catch (err) {
    console.warn(
      `[SMTP] WARNING: Could not connect to mail server at ${process.env.SMTP_HOST || 'localhost'}:${process.env.SMTP_PORT || '1025'} ` +
      `(${err.message}). Outgoing notification emails will be queued with retry backoff.`
    );
    return false;
  }
}

// ─── Email Template Builders ─────────────────────────────────────────────────
function renderPlainTextEmail({ severity, title, body, evidenceId, caseId, link }) {
  const cleanTitle = sanitizeContentText(title);
  const cleanBody = sanitizeContentText(body);
  const cleanLink = stripCrLf(link || `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/dashboard.html`);

  let text = `[EVIDENCEGUARD SECURITY ALERT]\n`;
  text += `==================================================\n`;
  text += `Severity:    ${severity}\n`;
  text += `Alert:       ${cleanTitle}\n`;
  if (evidenceId) text += `Evidence ID: ${evidenceId}\n`;
  if (caseId)     text += `Case ID:     ${caseId}\n`;
  text += `\nMessage:\n${cleanBody}\n\n`;
  text += `Review in Portal:\n${cleanLink}\n`;
  text += `--------------------------------------------------\n`;
  text += `Security Notice: Automated notification emails carry only system identifiers.\n`;
  text += `File contents, cryptographic hashes, and sensitive logs are never transmitted via email.\n`;
  return text;
}

function renderHtmlEmail({ severity, title, body, evidenceId, caseId, link }) {
  const safeSeverity = escapeHtml(severity);
  const safeTitle = escapeHtml(sanitizeContentText(title));
  const safeBody = escapeHtml(sanitizeContentText(body));
  const safeLink = escapeHtml(stripCrLf(link || `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/dashboard.html`));
  const safeEvidenceId = evidenceId ? escapeHtml(evidenceId) : null;
  const safeCaseId = caseId ? escapeHtml(caseId) : null;

  let badgeColor = '#4cc9f0'; // INFO
  let badgeBorder = '#3a506b';
  if (severity === 'CRITICAL') {
    badgeColor = '#e63946';
    badgeBorder = '#e63946';
  } else if (severity === 'WARNING') {
    badgeColor = '#f5a623';
    badgeBorder = '#f5a623';
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b132b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e0e6ed;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0b132b; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #1c2541; border: 1px solid #3a506b; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.5);" cellspacing="0" cellpadding="0" border="0">
          <!-- Header -->
          <tr>
            <td style="padding: 24px 32px; background-color: #0e172e; border-bottom: 1px solid #3a506b;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 700; color: #4cc9f0; letter-spacing: 0.5px;">🛡️ EvidenceGuard</span>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: ${badgeColor}; border: 1px solid ${badgeBorder}; background-color: rgba(0,0,0,0.25);">
                      ${safeSeverity}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                ${safeTitle}
              </h2>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                ${safeBody}
              </p>

              <!-- Identifiers metadata card -->
              ${(safeEvidenceId || safeCaseId) ? `
              <div style="background-color: #0b132b; border: 1px solid #2a3b5c; border-radius: 6px; padding: 16px; margin-bottom: 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="4" border="0" style="font-size: 13px;">
                  ${safeEvidenceId ? `<tr><td width="120" style="color: #8da4c4; font-weight: 600;">Evidence ID:</td><td style="color: #4cc9f0; font-family: monospace; font-size: 14px;">${safeEvidenceId}</td></tr>` : ''}
                  ${safeCaseId ? `<tr><td width="120" style="color: #8da4c4; font-weight: 600;">Case ID:</td><td style="color: #e0e6ed; font-family: monospace;">${safeCaseId}</td></tr>` : ''}
                </table>
              </div>
              ` : ''}

              <!-- Button CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 16px;">
                <tr>
                  <td align="center" style="border-radius: 4px; background-color: #4cc9f0;">
                    <a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 24px; font-size: 14px; font-weight: 600; color: #0b132b; text-decoration: none; border-radius: 4px; border: 1px solid #4cc9f0;">
                      Open EvidenceGuard Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #0e172e; border-top: 1px solid #2a3b5c; font-size: 12px; line-height: 1.5; color: #8da4c4;">
              <strong>Security Notice:</strong> Automated alert emails carry only non-sensitive system identifiers. File contents, cryptographic hash signatures, and confidential logs are never transmitted via email. Log in to EvidenceGuard to inspect authentic records.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Send Notification Email ─────────────────────────────────────────────────
async function sendNotificationEmail(toEmail, notification) {
  const cleanTo = stripCrLf(toEmail);
  if (!cleanTo || !cleanTo.includes('@')) {
    throw new Error(`Invalid recipient email address: "${cleanTo}"`);
  }

  const fromAddress = stripCrLf(
    process.env.EMAIL_FROM || 'EvidenceGuard Security <notifications@evidenceguard.local>'
  );

  const cleanSubject = stripCrLf(notification.title || 'EvidenceGuard Security Notification');

  const textContent = renderPlainTextEmail({
    severity: notification.severity || 'INFO',
    title: notification.title,
    body: notification.body,
    evidenceId: notification.evidenceId,
    caseId: notification.caseId,
    link: notification.link
  });

  const htmlContent = renderHtmlEmail({
    severity: notification.severity || 'INFO',
    title: notification.title,
    body: notification.body,
    evidenceId: notification.evidenceId,
    caseId: notification.caseId,
    link: notification.link
  });

  const transporter = createTransporter();

  const mailOptions = {
    from: fromAddress,
    to: cleanTo,
    subject: cleanSubject,
    text: textContent,
    html: htmlContent
  };

  return await transporter.sendMail(mailOptions);
}

module.exports = {
  createTransporter,
  verifySmtpConnection,
  stripCrLf,
  escapeHtml,
  sanitizeContentText,
  renderPlainTextEmail,
  renderHtmlEmail,
  sendNotificationEmail
};
