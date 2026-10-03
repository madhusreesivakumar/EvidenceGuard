'use strict';

const AuditLog = require('../models/AuditLog');
const { nextAuditId } = require('./idService');
const { computeAuditHash } = require('./auditHash');
const { scoped } = require('./tenantScope');

// In-process async queue ensuring sequential writes per process
let queuePromise = Promise.resolve();

const enqueue = (fn) => {
  const resultPromise = queuePromise.then(() => fn(), () => fn());
  queuePromise = resultPromise.catch(() => {});
  return resultPromise;
};

const logEvent = async ({ user, action, evidenceId, caseId, description, req, orgId: explicitOrgId }) => {
  try {
    let ipAddress = 'unknown';
    if (req) {
      ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
    }

    const orgId = explicitOrgId || (user && user.orgId) || (req && req.user && req.user.orgId) || 'default';
    const userId = user ? (user._id ? String(user._id) : (user.userId || user.id ? String(user.userId || user.id) : null)) : null;
    const userName = user ? (user.name || 'System') : 'System';
    const role = user ? (user.role || 'SYSTEM') : 'SYSTEM';

    const ScopedAudit = scoped(AuditLog, orgId);

    return await enqueue(async () => {
      const maxRetries = 8;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const latest = await ScopedAudit.findOne({ seq: { $ne: null } }).sort({ seq: -1 });
          const seq = (latest && typeof latest.seq === 'number') ? latest.seq + 1 : 1;
          const prevHash = (latest && latest.entryHash) ? latest.entryHash : '0000000000000000';
          
          const eventId = await nextAuditId(orgId);
          const timestamp = new Date();

          const entryHash = computeAuditHash({
            seq,
            eventId,
            userId,
            userName,
            role,
            action,
            evidenceId: evidenceId || null,
            caseId: caseId || null,
            description: description || null,
            timestamp,
            ipAddress,
            prevHash
          });

          const logEntry = new ScopedAudit({
            eventId,
            orgId,
            seq,
            prevHash,
            entryHash,
            userId,
            userName,
            role,
            action,
            evidenceId: evidenceId || null,
            caseId: caseId || null,
            description: description || null,
            timestamp,
            ipAddress
          });

          await logEntry.save();
          return logEntry;
        } catch (err) {
          if (err.code === 11000 && attempt < maxRetries) {
            // Short random backoff before retrying next sequence slot
            await new Promise((resolve) => setTimeout(resolve, 20 + Math.floor(Math.random() * 50)));
            continue;
          }
          throw err;
        }
      }
    });
  } catch (error) {
    // Swallow error so application request flows are never blocked or crashed
    console.error(`[AuditService] Failed to write audit log for action ${action}: ${error.message}`);
  }
};

module.exports = {
  logEvent
};
