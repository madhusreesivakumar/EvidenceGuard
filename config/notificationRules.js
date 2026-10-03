'use strict';

/**
 * config/notificationRules.js
 * Sprint 13A – Centralized Notification Rules Table
 *
 * Defines event triggers, recipient resolution, severity, and message templates.
 * Rule constraints:
 * - Content contains generic messages, severity, Evidence ID, Case ID, and portal links.
 * - NEVER leaks hashes, file names, descriptions, other user names, or client IP addresses.
 */

const NOTIFICATION_TYPES = {
  TAMPER_ALERT: 'TAMPER_ALERT',
  CHAIN_INVALID: 'CHAIN_INVALID',
  STORAGE_MISMATCH: 'STORAGE_MISMATCH',
  ANCHOR_MISMATCH: 'ANCHOR_MISMATCH',
  ROLE_CHANGED: 'ROLE_CHANGED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  FAILED_LOGINS: 'FAILED_LOGINS',
  CUSTODY_TRANSFER: 'CUSTODY_TRANSFER'
};

const COALESCE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const RULES = {
  [NOTIFICATION_TYPES.TAMPER_ALERT]: {
    type: NOTIFICATION_TYPES.TAMPER_ALERT,
    severity: 'CRITICAL',
    channels: ['IN_APP', 'EMAIL'],
    async resolveRecipients(data, { User, CustodyEvent }) {
      const recipientIds = new Set();

      // 1. Evidence uploader
      if (data.evidence && data.evidence.uploadedBy) {
        recipientIds.add(String(data.evidence.uploadedBy));
      }

      // 2. Current custodian (if Sprint 12 custody exists)
      if (CustodyEvent && data.evidence && data.evidence.evidenceId) {
        try {
          const latestCustody = await CustodyEvent.findOne({ evidenceId: data.evidence.evidenceId })
            .sort({ seq: -1 })
            .lean();
          if (latestCustody) {
            if (latestCustody.toUserId) {
              recipientIds.add(String(latestCustody.toUserId));
            } else if (latestCustody.actorUserId) {
              recipientIds.add(String(latestCustody.actorUserId));
            }
          }
        } catch (_) {}
      }

      // 3. All active ADMINs
      const admins = await User.find({ role: 'ADMIN', isActive: true }).select('_id').lean();
      admins.forEach(a => recipientIds.add(String(a._id)));

      return Array.from(recipientIds);
    },
    format(data, baseUrl) {
      const evId = data.evidence?.evidenceId || 'Unknown';
      const caseId = data.evidence?.caseId || '';
      return {
        title: `[CRITICAL] Tamper Alert: Evidence Integrity Compromised (${evId})`,
        body: `Cryptographic integrity verification failed for evidence ${evId}. The file digital signature did not match the sealed blockchain ledger record. Log in to review verification details.`,
        link: `${baseUrl}/evidence-details.html?id=${encodeURIComponent(evId)}`,
        evidenceId: evId,
        caseId: caseId
      };
    }
  },

  [NOTIFICATION_TYPES.CHAIN_INVALID]: {
    type: NOTIFICATION_TYPES.CHAIN_INVALID,
    severity: 'CRITICAL',
    channels: ['IN_APP', 'EMAIL'],
    async resolveRecipients(data, { User }) {
      const admins = await User.find({ role: 'ADMIN', isActive: true }).select('_id').lean();
      return admins.map(a => String(a._id));
    },
    format(data, baseUrl) {
      const chainName = data.chainType || 'Ledger';
      const page = chainName.toUpperCase() === 'AUDIT' ? 'audit.html' : 'blockchain.html';
      return {
        title: `[CRITICAL] System Integrity Alert: ${chainName} Chain Invalid`,
        body: `Cryptographic verification detected an unbroken chain error in the ${chainName} ledger. Immediate administrative inspection is required.`,
        link: `${baseUrl}/${page}`,
        evidenceId: data.evidenceId || null,
        caseId: null
      };
    }
  },

  [NOTIFICATION_TYPES.STORAGE_MISMATCH]: {
    type: NOTIFICATION_TYPES.STORAGE_MISMATCH,
    severity: 'CRITICAL',
    channels: ['IN_APP', 'EMAIL'],
    async resolveRecipients(data, { User }) {
      const admins = await User.find({ role: 'ADMIN', isActive: true }).select('_id').lean();
      return admins.map(a => String(a._id));
    },
    format(data, baseUrl) {
      const evId = data.evidenceId || 'Unknown';
      return {
        title: `[CRITICAL] Storage Integrity Alert: Replica Mismatch (${evId})`,
        body: `Stored file copy verification failed for evidence ${evId}. Physical storage differs from the primary ledger register.`,
        link: `${baseUrl}/dashboard.html`,
        evidenceId: evId,
        caseId: data.caseId || null
      };
    }
  },

  [NOTIFICATION_TYPES.ANCHOR_MISMATCH]: {
    type: NOTIFICATION_TYPES.ANCHOR_MISMATCH,
    severity: 'CRITICAL',
    channels: ['IN_APP', 'EMAIL'],
    async resolveRecipients(data, { User }) {
      const admins = await User.find({ role: 'ADMIN', isActive: true }).select('_id').lean();
      return admins.map(a => String(a._id));
    },
    format(data, baseUrl) {
      return {
        title: `[CRITICAL] Security Alert: Public Ledger Anchor Mismatch`,
        body: `Public anchor state verification detected an out-of-sync root hash. External ledger proof requires administrative review.`,
        link: `${baseUrl}/blockchain.html`,
        evidenceId: null,
        caseId: null
      };
    }
  },

  [NOTIFICATION_TYPES.ROLE_CHANGED]: {
    type: NOTIFICATION_TYPES.ROLE_CHANGED,
    severity: 'INFO',
    channels: ['IN_APP', 'EMAIL'],
    async resolveRecipients(data, { User }) {
      const recipientIds = new Set();
      // Affected user
      if (data.user && data.user._id) {
        recipientIds.add(String(data.user._id));
      }
      // All active ADMINs
      const admins = await User.find({ role: 'ADMIN', isActive: true }).select('_id').lean();
      admins.forEach(a => recipientIds.add(String(a._id)));
      return Array.from(recipientIds);
    },
    format(data, baseUrl) {
      const newRole = data.newRole || 'updated';
      return {
        title: `[INFO] Account Role Updated: ${newRole}`,
        body: `An account access level was updated in EvidenceGuard to ${newRole}. Log in to review current permissions.`,
        link: `${baseUrl}/dashboard.html`,
        evidenceId: null,
        caseId: null
      };
    }
  },

  [NOTIFICATION_TYPES.USER_DEACTIVATED]: {
    type: NOTIFICATION_TYPES.USER_DEACTIVATED,
    severity: 'INFO',
    channels: ['IN_APP', 'EMAIL'],
    async resolveRecipients(data, { User }) {
      const admins = await User.find({ role: 'ADMIN', isActive: true }).select('_id').lean();
      return admins.map(a => String(a._id));
    },
    format(data, baseUrl) {
      return {
        title: `[INFO] User Account Deactivated`,
        body: `A user account was deactivated by an administrator. Review user administration records.`,
        link: `${baseUrl}/users.html`,
        evidenceId: null,
        caseId: null
      };
    }
  },

  [NOTIFICATION_TYPES.FAILED_LOGINS]: {
    type: NOTIFICATION_TYPES.FAILED_LOGINS,
    severity: 'WARNING',
    channels: ['IN_APP', 'EMAIL'],
    async resolveRecipients(data, { User }) {
      const recipientIds = new Set();
      // Account owner if exists
      if (data.email) {
        const owner = await User.findOne({ email: data.email.toLowerCase(), isActive: true }).select('_id').lean();
        if (owner) recipientIds.add(String(owner._id));
      }
      // All active ADMINs
      const admins = await User.find({ role: 'ADMIN', isActive: true }).select('_id').lean();
      admins.forEach(a => recipientIds.add(String(a._id)));
      return Array.from(recipientIds);
    },
    format(data, baseUrl) {
      return {
        title: `[WARNING] Security Alert: 5 Failed Login Attempts Detected`,
        body: `5 failed authentication attempts were detected within 15 minutes for an account. If this was not you, please verify your credentials and security settings immediately.`,
        link: `${baseUrl}/login.html`,
        evidenceId: null,
        caseId: null
      };
    }
  },

  [NOTIFICATION_TYPES.CUSTODY_TRANSFER]: {
    type: NOTIFICATION_TYPES.CUSTODY_TRANSFER,
    severity: 'INFO',
    channels: ['IN_APP', 'EMAIL'],
    async resolveRecipients(data) {
      if (data.toUserId) {
        return [String(data.toUserId)];
      }
      return [];
    },
    format(data, baseUrl) {
      const evId = data.evidenceId || data.transferEvent?.evidenceId || 'Unknown';
      return {
        title: `[INFO] Chain of Custody: Handover Pending Acceptance (${evId})`,
        body: `A custody transfer has been initiated for evidence ${evId} and requires your acceptance in the Custody Hub.`,
        link: `${baseUrl}/custody.html`,
        evidenceId: evId,
        caseId: null
      };
    }
  }
};

module.exports = {
  NOTIFICATION_TYPES,
  COALESCE_WINDOW_MS,
  RULES
};
