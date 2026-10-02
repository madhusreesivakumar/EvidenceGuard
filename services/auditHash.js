'use strict';

const crypto = require('crypto');

/**
 * Computes the deterministic SHA-256 hash for an audit log entry.
 * Canonical structure: JSON.stringify([seq, eventId, userId, userName, role, action, evidenceId, caseId, description, timestampISO, ipAddress, prevHash])
 * 
 * @param {Object} entry
 * @returns {string} SHA-256 hex string (64 characters)
 */
function computeAuditHash(entry = {}) {
  const seq = (entry.seq !== undefined && entry.seq !== null) ? Number(entry.seq) : null;
  const eventId = entry.eventId !== undefined && entry.eventId !== null ? String(entry.eventId) : null;
  const userId = entry.userId !== undefined && entry.userId !== null ? String(entry.userId) : null;
  const userName = entry.userName !== undefined && entry.userName !== null ? String(entry.userName) : null;
  const role = entry.role !== undefined && entry.role !== null ? String(entry.role) : null;
  const action = entry.action !== undefined && entry.action !== null ? String(entry.action) : null;
  const evidenceId = entry.evidenceId !== undefined && entry.evidenceId !== null ? String(entry.evidenceId) : null;
  const caseId = entry.caseId !== undefined && entry.caseId !== null ? String(entry.caseId) : null;
  const description = entry.description !== undefined && entry.description !== null ? String(entry.description) : null;

  let timestampISO = null;
  if (entry.timestamp) {
    if (entry.timestamp instanceof Date) {
      timestampISO = entry.timestamp.toISOString();
    } else if (typeof entry.timestamp === 'string') {
      timestampISO = new Date(entry.timestamp).toISOString();
    } else if (typeof entry.timestamp === 'number') {
      timestampISO = new Date(entry.timestamp).toISOString();
    }
  }

  const ipAddress = entry.ipAddress !== undefined && entry.ipAddress !== null ? String(entry.ipAddress) : null;
  const prevHash = entry.prevHash !== undefined && entry.prevHash !== null ? String(entry.prevHash) : null;

  const payload = [
    seq,
    eventId,
    userId,
    userName,
    role,
    action,
    evidenceId,
    caseId,
    description,
    timestampISO,
    ipAddress,
    prevHash
  ];

  const canonicalString = JSON.stringify(payload);
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

/**
 * Validates the cryptographic integrity of the entire audit chain.
 * Checks contiguous sequence numbers, prevHash linkage, and deterministic entryHash.
 */
async function validateAuditChain() {
  const AuditLog = require('../models/AuditLog');
  const entries = await AuditLog.find({ seq: { $ne: null } })
    .sort({ seq: 1 })
    .lean();

  const issues = [];
  let expectedSeq = 1;
  let expectedPrevHash = '0000000000000000';
  let firstBrokenSeq = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const seq = entry.seq;

    if (seq !== expectedSeq) {
      if (!firstBrokenSeq) firstBrokenSeq = seq;
      if (issues.length < 50) {
        issues.push({
          seq,
          check: 'CONTIGUOUS_SEQ',
          expected: expectedSeq,
          actual: seq
        });
      }
    }

    if (entry.prevHash !== expectedPrevHash) {
      if (!firstBrokenSeq) firstBrokenSeq = seq;
      if (issues.length < 50) {
        issues.push({
          seq,
          check: 'PREV_HASH_LINKAGE',
          expected: expectedPrevHash,
          actual: entry.prevHash
        });
      }
    }

    const calculatedHash = computeAuditHash({
      seq: entry.seq,
      eventId: entry.eventId,
      userId: entry.userId || null,
      userName: entry.userName || null,
      role: entry.role || null,
      action: entry.action || null,
      evidenceId: entry.evidenceId || null,
      caseId: entry.caseId || null,
      description: entry.description || null,
      timestamp: entry.timestamp,
      ipAddress: entry.ipAddress || null,
      prevHash: entry.prevHash
    });

    if (entry.entryHash !== calculatedHash) {
      if (!firstBrokenSeq) firstBrokenSeq = seq;
      if (issues.length < 50) {
        issues.push({
          seq,
          check: 'ENTRY_HASH_INTEGRITY',
          expected: calculatedHash,
          actual: entry.entryHash
        });
      }
    }

    expectedSeq = seq + 1;
    expectedPrevHash = entry.entryHash;
  }

  const valid = issues.length === 0;
  const entriesChecked = entries.length;
  const head = entries.length > 0 ? {
    seq: entries[entries.length - 1].seq,
    entryHash: entries[entries.length - 1].entryHash
  } : null;
  const validatedAt = new Date().toISOString();
  const message = valid ? 'AUDIT CHAIN: VALID' : 'AUDIT CHAIN: INVALID';

  return {
    valid,
    entriesChecked,
    message,
    firstBrokenSeq,
    validatedAt,
    head,
    issues
  };
}

module.exports = {
  computeAuditHash,
  validateAuditChain
};
