'use strict';

const crypto = require('crypto');
const CustodyEvent = require('../models/CustodyEvent');
const User = require('../models/User');
const { logEvent } = require('./auditService');

const GENESIS_PREV_HASH = '0000000000000000';
const TRANSFER_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours

/**
 * Computes deterministic SHA-256 hash for a custody event entry.
 * Canonical array payload:
 * [seq, custodyId, evidenceId, type, actorUserId, toUserId, externalParty, reason, location, conditionNotes, occurredAtISO, auto, prevHash]
 */
function computeCustodyHash(event = {}) {
  const seq = Number(event.seq);
  const custodyId = String(event.custodyId);
  const evidenceId = String(event.evidenceId);
  const type = String(event.type);
  const actorUserId = event.actorUserId ? String(event.actorUserId) : null;
  const toUserId = event.toUserId ? String(event.toUserId) : null;
  
  const externalParty = event.externalParty && (event.externalParty.name || event.externalParty.organization)
    ? {
        name: event.externalParty.name ? String(event.externalParty.name).trim() : null,
        organization: event.externalParty.organization ? String(event.externalParty.organization).trim() : null
      }
    : null;

  const reason = String(event.reason || '').trim();
  const location = event.location ? String(event.location).trim() : null;
  const conditionNotes = event.conditionNotes ? String(event.conditionNotes).trim() : null;

  let occurredAtISO = null;
  if (event.occurredAt) {
    if (event.occurredAt instanceof Date) {
      occurredAtISO = event.occurredAt.toISOString();
    } else {
      occurredAtISO = new Date(event.occurredAt).toISOString();
    }
  }

  const auto = Boolean(event.auto);
  const prevHash = String(event.prevHash || GENESIS_PREV_HASH);

  const payload = [
    seq,
    custodyId,
    evidenceId,
    type,
    actorUserId,
    toUserId,
    externalParty,
    reason,
    location,
    conditionNotes,
    occurredAtISO,
    auto,
    prevHash
  ];

  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

/**
 * Derives the current custody state from an ordered array of custody events.
 */
function deriveCustodyState(events = []) {
  let currentCustodian = null; // { userId: String, name: String }
  let status = 'IN_CUSTODY'; // 'IN_CUSTODY' | 'PENDING_TRANSFER' | 'RELEASED'
  let pendingTransfer = null; // object or null
  let externalParty = null;

  for (const event of events) {
    const actorIdStr = event.actorUserId ? String(event.actorUserId) : '';
    const toIdStr = event.toUserId ? String(event.toUserId) : '';

    switch (event.type) {
      case 'COLLECTED':
        currentCustodian = {
          userId: actorIdStr,
          name: event.actorName || ''
        };
        status = 'IN_CUSTODY';
        pendingTransfer = null;
        externalParty = null;
        break;

      case 'TRANSFER_INITIATED': {
        const isExpired = event.expiresAt ? (new Date() > new Date(event.expiresAt)) : false;
        pendingTransfer = {
          custodyId: event.custodyId,
          seq: event.seq,
          fromUserId: actorIdStr,
          fromUserName: event.actorName || '',
          toUserId: toIdStr,
          toUserName: event.toUserName || '',
          reason: event.reason,
          expiresAt: event.expiresAt,
          isExpired
        };
        status = 'PENDING_TRANSFER';
        break;
      }

      case 'TRANSFER_ACCEPTED':
        currentCustodian = {
          userId: toIdStr || actorIdStr,
          name: event.toUserName || event.actorName || ''
        };
        status = 'IN_CUSTODY';
        pendingTransfer = null;
        break;

      case 'TRANSFER_REJECTED':
      case 'TRANSFER_CANCELLED':
        status = 'IN_CUSTODY';
        pendingTransfer = null;
        break;

      case 'ACCESSED':
      case 'ANALYZED':
      case 'STORED':
        // Maintains current custodian & status
        break;

      case 'RELEASED':
        currentCustodian = null;
        status = 'RELEASED';
        pendingTransfer = null;
        externalParty = event.externalParty || null;
        break;

      case 'RETURNED':
        currentCustodian = {
          userId: toIdStr || actorIdStr,
          name: event.toUserName || event.actorName || ''
        };
        status = 'IN_CUSTODY';
        pendingTransfer = null;
        externalParty = null;
        break;

      default:
        break;
    }
  }

  // Check if pending transfer is currently expired
  if (pendingTransfer && pendingTransfer.expiresAt) {
    if (new Date() > new Date(pendingTransfer.expiresAt)) {
      pendingTransfer.isExpired = true;
    }
  }

  return {
    currentCustodian,
    status,
    pendingTransfer,
    externalParty
  };
}

/**
 * Validates the custody chain integrity and state machine transitions.
 */
async function validateCustodyChain(evidenceId) {
  const events = await CustodyEvent.find({ evidenceId }).sort({ seq: 1 }).lean();
  const issues = [];

  if (events.length === 0) {
    return {
      valid: true,
      totalEvents: 0,
      currentCustodian: null,
      status: 'NO_EVENTS',
      pendingTransfer: null,
      issues: []
    };
  }

  let expectedSeq = 1;
  let expectedPrevHash = GENESIS_PREV_HASH;

  // Track state machine transitions step-by-step
  let stepCustodian = null;
  let stepStatus = 'IN_CUSTODY';
  let stepPending = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // 1. Contiguous seq check
    if (event.seq !== expectedSeq) {
      issues.push({
        seq: event.seq,
        check: 'CONTIGUOUS_SEQ',
        message: `Sequence gap detected: expected ${expectedSeq}, got ${event.seq}`
      });
    }

    // 2. prevHash linkage check
    if (event.prevHash !== expectedPrevHash) {
      issues.push({
        seq: event.seq,
        check: 'PREV_HASH_LINKAGE',
        message: `Broken hash link at seq ${event.seq}: expected prevHash ${expectedPrevHash}, got ${event.prevHash}`
      });
    }

    // 3. entryHash recomputation check
    const recomputed = computeCustodyHash(event);
    if (recomputed !== event.entryHash) {
      issues.push({
        seq: event.seq,
        check: 'ENTRY_HASH_MATCH',
        message: `Tampered hash at seq ${event.seq}: calculated ${recomputed}, stored ${event.entryHash}`
      });
    }

    // 4. State transition legality
    const actorIdStr = event.actorUserId ? String(event.actorUserId) : '';
    const toIdStr = event.toUserId ? String(event.toUserId) : '';

    if (i === 0 && event.type !== 'COLLECTED') {
      issues.push({
        seq: event.seq,
        check: 'LEGAL_TRANSITION',
        message: `First custody event must be COLLECTED, found ${event.type}`
      });
    }

    if (stepStatus === 'RELEASED' && event.type !== 'RETURNED') {
      issues.push({
        seq: event.seq,
        check: 'LEGAL_TRANSITION',
        message: `Illegal transition while evidence is RELEASED: ${event.type}`
      });
    }

    switch (event.type) {
      case 'COLLECTED':
        stepCustodian = { userId: actorIdStr, name: event.actorName };
        stepStatus = 'IN_CUSTODY';
        stepPending = null;
        break;

      case 'TRANSFER_INITIATED':
        if (stepPending && !stepPending.isExpired) {
          issues.push({
            seq: event.seq,
            check: 'LEGAL_TRANSITION',
            message: `Cannot initiate transfer while a previous transfer is already pending`
          });
        }
        stepPending = {
          custodyId: event.custodyId,
          fromUserId: actorIdStr,
          toUserId: toIdStr,
          expiresAt: event.expiresAt,
          isExpired: event.expiresAt ? (new Date(event.recordedAt) > new Date(event.expiresAt)) : false
        };
        stepStatus = 'PENDING_TRANSFER';
        break;

      case 'TRANSFER_ACCEPTED':
        if (!stepPending) {
          issues.push({
            seq: event.seq,
            check: 'LEGAL_TRANSITION',
            message: `TRANSFER_ACCEPTED without an active pending transfer`
          });
        }
        stepCustodian = { userId: toIdStr || actorIdStr, name: event.toUserName || event.actorName };
        stepStatus = 'IN_CUSTODY';
        stepPending = null;
        break;

      case 'TRANSFER_REJECTED':
      case 'TRANSFER_CANCELLED':
        if (!stepPending) {
          issues.push({
            seq: event.seq,
            check: 'LEGAL_TRANSITION',
            message: `${event.type} without an active pending transfer`
          });
        }
        stepStatus = 'IN_CUSTODY';
        stepPending = null;
        break;

      case 'RELEASED':
        stepCustodian = null;
        stepStatus = 'RELEASED';
        stepPending = null;
        break;

      case 'RETURNED':
        if (stepStatus !== 'RELEASED') {
          issues.push({
            seq: event.seq,
            check: 'LEGAL_TRANSITION',
            message: `RETURNED event can only be recorded when evidence is RELEASED`
          });
        }
        stepCustodian = { userId: toIdStr || actorIdStr, name: event.toUserName || event.actorName };
        stepStatus = 'IN_CUSTODY';
        stepPending = null;
        break;

      case 'ACCESSED':
      case 'ANALYZED':
      case 'STORED':
        break;
    }

    expectedSeq = event.seq + 1;
    expectedPrevHash = event.entryHash;
  }

  const derived = deriveCustodyState(events);

  return {
    valid: issues.length === 0,
    totalEvents: events.length,
    currentCustodian: derived.currentCustodian,
    status: derived.status,
    pendingTransfer: derived.pendingTransfer,
    externalParty: derived.externalParty,
    issues
  };
}

/**
 * Creates and records a new custody event enforcing state machine rules and optimistic concurrency.
 */
async function recordCustodyEvent(params = {}) {
  const {
    evidenceId,
    type,
    user,
    toUserId,
    externalParty,
    reason,
    location,
    conditionNotes,
    occurredAt,
    auto = false,
    expectedSeq,
    signature,
    req
  } = params;

  if (!evidenceId) {
    const err = new Error('Evidence ID is required');
    err.status = 400;
    err.code = 'INVALID_EVIDENCE_ID';
    throw err;
  }

  if (!reason || reason.trim().length < 5 || reason.trim().length > 500) {
    const err = new Error('Reason must be between 5 and 500 characters');
    err.status = 400;
    err.code = 'INVALID_REASON';
    throw err;
  }

  // OccurredAt validation: cannot be > 5 minutes in the future
  const eventOccurredAt = occurredAt ? new Date(occurredAt) : new Date();
  if (isNaN(eventOccurredAt.getTime())) {
    const err = new Error('Invalid occurredAt date');
    err.status = 400;
    err.code = 'INVALID_DATE';
    throw err;
  }
  const maxFutureAllowed = Date.now() + (5 * 60 * 1000);
  if (eventOccurredAt.getTime() > maxFutureAllowed) {
    const err = new Error('occurredAt cannot be more than 5 minutes in the future');
    err.status = 400;
    err.code = 'OCCURRED_AT_FUTURE';
    throw err;
  }

  // Fetch all existing events for state machine and seq linkage
  const existingEvents = await CustodyEvent.find({ evidenceId }).sort({ seq: 1 }).lean();
  const nextSeq = existingEvents.length + 1;
  const prevHash = existingEvents.length > 0
    ? existingEvents[existingEvents.length - 1].entryHash
    : GENESIS_PREV_HASH;

  // Optimistic concurrency check
  if (expectedSeq !== undefined && expectedSeq !== null) {
    if (Number(expectedSeq) !== nextSeq) {
      const err = new Error(`Concurrency conflict: expected sequence ${expectedSeq}, but next sequence is ${nextSeq}`);
      err.status = 409;
      err.code = 'CONCURRENCY_CONFLICT';
      throw err;
    }
  }

  const currentState = deriveCustodyState(existingEvents);
  const userIdStr = user._id ? String(user._id) : String(user.id);
  const isAdmin = user.role === 'ADMIN';
  const isCurrentCustodian = currentState.currentCustodian && (String(currentState.currentCustodian.userId) === userIdStr);

  // State Machine Rule Enforcements
  if (type === 'COLLECTED') {
    if (existingEvents.length > 0) {
      const err = new Error('COLLECTED event can only be the initial event (seq 1)');
      err.status = 400;
      err.code = 'ILLEGAL_TRANSITION';
      throw err;
    }
  } else {
    if (existingEvents.length === 0) {
      const err = new Error('First custody event must be COLLECTED');
      err.status = 400;
      err.code = 'NO_COLLECTED_EVENT';
      throw err;
    }

    // If RELEASED, only RETURNED by ADMIN is permitted
    if (currentState.status === 'RELEASED') {
      if (type !== 'RETURNED') {
        const err = new Error('Evidence is RELEASED. No actions permitted until an Admin records RETURNED.');
        err.status = 400;
        err.code = 'EVIDENCE_IS_RELEASED';
        throw err;
      }
      if (!isAdmin) {
        const err = new Error('Only an ADMIN can return released evidence into custody');
        err.status = 403;
        err.code = 'FORBIDDEN_RETURN';
        throw err;
      }
    }

    if (type === 'RETURNED') {
      if (currentState.status !== 'RELEASED') {
        const err = new Error('RETURNED event can only be recorded when evidence is in RELEASED state');
        err.status = 400;
        err.code = 'NOT_RELEASED';
        throw err;
      }
      if (!isAdmin) {
        const err = new Error('Only an ADMIN can record a RETURNED event');
        err.status = 403;
        err.code = 'FORBIDDEN_RETURN';
        throw err;
      }
    }

    if (type === 'TRANSFER_INITIATED') {
      if (currentState.pendingTransfer && !currentState.pendingTransfer.isExpired) {
        const err = new Error('A transfer is already pending for this evidence');
        err.status = 400;
        err.code = 'TRANSFER_ALREADY_PENDING';
        throw err;
      }
      if (!isCurrentCustodian && !isAdmin) {
        const err = new Error('Only the current custodian or an ADMIN can initiate a custody transfer');
        err.status = 403;
        err.code = 'NOT_CURRENT_CUSTODIAN';
        throw err;
      }
      if (!toUserId) {
        const err = new Error('Transfer recipient (toUserId) is required');
        err.status = 400;
        err.code = 'RECIPIENT_REQUIRED';
        throw err;
      }
      if (String(toUserId) === userIdStr) {
        const err = new Error('Cannot initiate a custody transfer to yourself');
        err.status = 400;
        err.code = 'INVALID_RECIPIENT';
        throw err;
      }
    }

    if (type === 'TRANSFER_ACCEPTED' || type === 'TRANSFER_REJECTED') {
      if (!currentState.pendingTransfer) {
        const err = new Error('No pending transfer found for this evidence');
        err.status = 400;
        err.code = 'NO_PENDING_TRANSFER';
        throw err;
      }
      if (currentState.pendingTransfer.isExpired) {
        const err = new Error('The pending transfer has expired (> 72 hours elapsed)');
        err.status = 400;
        err.code = 'TRANSFER_EXPIRED';
        throw err;
      }
      const isRecipient = String(currentState.pendingTransfer.toUserId) === userIdStr;
      if (!isRecipient && !isAdmin) {
        const err = new Error('Only the designated recipient or an ADMIN can accept or reject a transfer');
        err.status = 403;
        err.code = 'NOT_TRANSFER_RECIPIENT';
        throw err;
      }
    }

    if (type === 'TRANSFER_CANCELLED') {
      if (!currentState.pendingTransfer) {
        const err = new Error('No pending transfer to cancel');
        err.status = 400;
        err.code = 'NO_PENDING_TRANSFER';
        throw err;
      }
      const isInitiator = String(currentState.pendingTransfer.fromUserId) === userIdStr;
      if (!isInitiator && !isAdmin) {
        const err = new Error('Only the transfer initiator or an ADMIN can cancel a transfer');
        err.status = 403;
        err.code = 'NOT_TRANSFER_INITIATOR';
        throw err;
      }
    }

    if (type === 'ANALYZED' || type === 'STORED' || type === 'RELEASED') {
      if (!isCurrentCustodian && !isAdmin) {
        const err = new Error(`Only the current custodian or an ADMIN can record ${type}`);
        err.status = 403;
        err.code = 'NOT_CURRENT_CUSTODIAN';
        throw err;
      }
      if (type === 'RELEASED') {
        if (!externalParty || !externalParty.name || !externalParty.organization) {
          const err = new Error('externalParty { name, organization } is required when releasing evidence');
          err.status = 400;
          err.code = 'EXTERNAL_PARTY_REQUIRED';
          throw err;
        }
      }
    }
  }

  // Resolve recipient user name if toUserId provided
  let toUserName = '';
  let resolvedToUserId = null;
  if (toUserId) {
    const toUser = await User.findById(toUserId).lean();
    if (!toUser) {
      const err = new Error('Recipient user not found');
      err.status = 400;
      err.code = 'USER_NOT_FOUND';
      throw err;
    }
    resolvedToUserId = toUser._id;
    toUserName = toUser.name || toUser.email;
  } else if (type === 'TRANSFER_ACCEPTED' && currentState.pendingTransfer) {
    resolvedToUserId = currentState.pendingTransfer.toUserId;
    toUserName = currentState.pendingTransfer.toUserName;
  }

  const custodyId = crypto.randomUUID();
  const recordedAt = new Date();
  let expiresAt = null;
  if (type === 'TRANSFER_INITIATED') {
    expiresAt = new Date(recordedAt.getTime() + TRANSFER_EXPIRY_MS);
  }

  const eventData = {
    custodyId,
    evidenceId,
    seq: nextSeq,
    type,
    actorUserId: user._id,
    actorName: user.name || user.email || 'Unknown',
    toUserId: resolvedToUserId,
    toUserName,
    externalParty: externalParty || { name: null, organization: null },
    reason: reason.trim(),
    location: location ? location.trim() : '',
    conditionNotes: conditionNotes ? conditionNotes.trim() : '',
    occurredAt: eventOccurredAt,
    recordedAt,
    expiresAt,
    auto: Boolean(auto),
    prevHash,
    signature: signature || undefined
  };

  const entryHash = computeCustodyHash(eventData);
  eventData.entryHash = entryHash;

  let created;
  try {
    created = await CustodyEvent.create(eventData);
  } catch (err) {
    if (err.code === 11000) {
      const conflictErr = new Error(`Concurrency conflict: a custody event at sequence ${nextSeq} was already recorded`);
      conflictErr.status = 409;
      conflictErr.code = 'CONCURRENCY_CONFLICT';
      throw conflictErr;
    }
    throw err;
  }

  // Audit logging
  const auditAction = (type.startsWith('TRANSFER_')) ? 'CUSTODY_TRANSFER' : 'CUSTODY_EVENT';
  await logEvent({
    user,
    action: auditAction,
    evidenceId,
    description: `Custody event [${type}] recorded (seq #${nextSeq}): ${reason.trim()}`,
    req
  });

  if (type === 'TRANSFER_INITIATED') {
    try {
      const eventBus = require('./eventBus');
      eventBus.emit('CUSTODY_TRANSFER_INITIATED', {
        evidenceId,
        transferEvent: created,
        actorUser: user,
        toUserId: resolvedToUserId,
        toUserName,
        req
      });
    } catch (busErr) {
      console.error('[EVENT_BUS ERROR]', busErr);
    }
  }

  return created;
}

module.exports = {
  computeCustodyHash,
  deriveCustodyState,
  validateCustodyChain,
  recordCustodyEvent,
  GENESIS_PREV_HASH,
  TRANSFER_EXPIRY_MS
};
