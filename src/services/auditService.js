'use strict';
/**
 * src/services/auditService.js
 * Thin wrapper around AuditLog.create — fire-and-forget, never throws.
 */
const AuditLog = require('../models/AuditLog');

/**
 * Write an audit event. Failures are logged to stderr but never propagate
 * to callers — audit logging must never break a user-facing operation.
 *
 * @param {Object} opts
 * @param {import('mongoose').Types.ObjectId|null} opts.userId
 * @param {string} opts.userName
 * @param {string} opts.role
 * @param {string} opts.action   - e.g. 'EVIDENCE_UPLOAD'
 * @param {string|null} opts.evidenceId
 * @param {string|null} opts.caseId
 * @param {string} opts.description
 * @param {string} [opts.ip]
 */
async function audit({ userId = null, userName = 'System', role = 'system',
                       action, evidenceId = null, caseId = null,
                       description, ip = '' }) {
  try {
    await AuditLog.create({ userId, userName, role, action, evidenceId, caseId, description, ipAddress: ip });
  } catch (err) {
    console.error('[audit] write failed:', err.message);
  }
}

module.exports = { audit };
