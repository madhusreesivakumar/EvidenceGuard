'use strict';

const CustodyEvent = require('../models/CustodyEvent');
const Evidence = require('../models/Evidence');
const User = require('../models/User');
const { scoped } = require('../services/tenantScope');
const {
  deriveCustodyState,
  validateCustodyChain,
  recordCustodyEvent
} = require('../services/custodyService');

/**
 * Helper to ensure evidence exists.
 */
async function findEvidence(id, user) {
  if (!id || typeof id !== 'string') return null;
  const ScopedEvidence = scoped(Evidence, user);
  return await ScopedEvidence.findOne({
    $or: [{ evidenceId: id }, { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }],
    isDeleted: false
  }).lean();
}

/**
 * GET /api/evidence/:id/custody
 * Fetch complete custody history, current state, and pending transfer.
 */
async function getEvidenceCustody(req, res, next) {
  try {
    const evidence = await findEvidence(req.params.id, req.user);
    if (!evidence) {
      return res.status(404).json({
        success: false,
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence record not found'
      });
    }

    const ScopedCustody = scoped(CustodyEvent, req.user);
    const events = await ScopedCustody.find({ evidenceId: evidence.evidenceId })
      .sort({ seq: 1 })
      .lean();

    const currentState = deriveCustodyState(events);

    return res.json({
      success: true,
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      currentCustodian: currentState.currentCustodian,
      status: currentState.status,
      pendingTransfer: currentState.pendingTransfer,
      externalParty: currentState.externalParty,
      totalEvents: events.length,
      events
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/evidence/:id/custody
 * Append a custody event (TRANSFER_INITIATED, ACCESSED, ANALYZED, STORED, RELEASED, RETURNED).
 */
async function createEvidenceCustodyEvent(req, res, next) {
  try {
    const evidence = await findEvidence(req.params.id, req.user);
    if (!evidence) {
      return res.status(404).json({
        success: false,
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence record not found'
      });
    }

    const {
      type,
      toUserId,
      externalParty,
      reason,
      location,
      notes,
      conditionNotes,
      occurredAt,
      expectedSeq,
      signature
    } = req.body;

    const event = await recordCustodyEvent({
      evidenceId: evidence.evidenceId,
      type,
      user: req.user,
      toUserId,
      externalParty,
      reason,
      location,
      notes,
      conditionNotes: conditionNotes || notes,
      occurredAt,
      expectedSeq,
      signature,
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Custody event recorded successfully',
      event
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        code: err.code || 'CUSTODY_ERROR',
        message: err.message
      });
    }
    next(err);
  }
}

/**
 * POST /api/evidence/:id/custody/transfer/accept
 * Accept a pending custody transfer.
 */
async function acceptTransfer(req, res, next) {
  try {
    const custodyId = req.params.custodyId || req.body?.transferId;
    const ScopedCustody = scoped(CustodyEvent, req.user);

    let initiateEvent = null;
    if (custodyId) {
      initiateEvent = await ScopedCustody.findOne({
        custodyId,
        type: 'TRANSFER_INITIATED'
      }).lean();
    } else if (req.params.id) {
      const evidence = await findEvidence(req.params.id, req.user);
      if (evidence) {
        initiateEvent = await ScopedCustody.findOne({
          evidenceId: evidence.evidenceId,
          type: 'TRANSFER_INITIATED'
        }).sort({ seq: -1 }).lean();
      }
    }

    if (!initiateEvent) {
      return res.status(404).json({
        success: false,
        code: 'TRANSFER_NOT_FOUND',
        message: 'Pending transfer event not found'
      });
    }

    if (String(initiateEvent.toUserId) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        code: 'NOT_TRANSFER_RECIPIENT',
        message: 'Only the designated recipient can accept this custody transfer'
      });
    }

    const {
      reason = 'Custody transfer accepted and physical custody assumed',
      location,
      conditionNotes,
      occurredAt,
      expectedSeq,
      signature
    } = req.body;

    const accepted = await recordCustodyEvent({
      evidenceId: initiateEvent.evidenceId,
      type: 'TRANSFER_ACCEPTED',
      user: req.user,
      toUserId: initiateEvent.toUserId,
      reason: reason || 'Transfer accepted',
      location,
      conditionNotes,
      occurredAt,
      expectedSeq,
      signature,
      req
    });

    return res.json({
      success: true,
      message: 'Custody transfer successfully accepted',
      event: accepted
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        code: err.code || 'BAD_REQUEST',
        message: err.message
      });
    }
    next(err);
  }
}

/**
 * POST /api/custody/:custodyId/reject or /api/evidence/:id/custody/transfer/reject
 * Reject a pending custody transfer.
 */
async function rejectTransfer(req, res, next) {
  try {
    const custodyId = req.params.custodyId || req.body?.transferId;
    const ScopedCustody = scoped(CustodyEvent, req.user);

    let initiateEvent = null;
    if (custodyId) {
      initiateEvent = await ScopedCustody.findOne({
        custodyId,
        type: 'TRANSFER_INITIATED'
      }).lean();
    } else if (req.params.id) {
      const evidence = await findEvidence(req.params.id, req.user);
      if (evidence) {
        initiateEvent = await ScopedCustody.findOne({
          evidenceId: evidence.evidenceId,
          type: 'TRANSFER_INITIATED'
        }).sort({ seq: -1 }).lean();
      }
    }

    if (!initiateEvent) {
      return res.status(404).json({
        success: false,
        code: 'TRANSFER_NOT_FOUND',
        message: 'Pending transfer event not found'
      });
    }

    if (String(initiateEvent.toUserId) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        code: 'UNAUTHORIZED_RECIPIENT',
        message: 'Only the designated recipient can reject this custody transfer'
      });
    }

    const {
      reason,
      location,
      conditionNotes,
      occurredAt,
      expectedSeq,
      signature
    } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        code: 'REASON_REQUIRED',
        message: 'A reason of at least 5 characters is required to reject a custody transfer'
      });
    }

    const rejected = await recordCustodyEvent({
      evidenceId: initiateEvent.evidenceId,
      type: 'TRANSFER_REJECTED',
      user: req.user,
      reason: reason.trim(),
      location,
      conditionNotes,
      occurredAt,
      expectedSeq,
      signature,
      req
    });

    return res.json({
      success: true,
      message: 'Custody transfer rejected',
      event: rejected
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        code: err.code || 'BAD_REQUEST',
        message: err.message
      });
    }
    next(err);
  }
}

/**
 * POST /api/custody/:custodyId/cancel or /api/evidence/:id/custody/transfer/cancel
 * Cancel an outgoing custody transfer (by the initiator).
 */
async function cancelTransfer(req, res, next) {
  try {
    const custodyId = req.params.custodyId || req.body?.transferId;
    const ScopedCustody = scoped(CustodyEvent, req.user);

    let initiateEvent = null;
    if (custodyId) {
      initiateEvent = await ScopedCustody.findOne({
        custodyId,
        type: 'TRANSFER_INITIATED'
      }).lean();
    } else if (req.params.id) {
      const evidence = await findEvidence(req.params.id, req.user);
      if (evidence) {
        initiateEvent = await ScopedCustody.findOne({
          evidenceId: evidence.evidenceId,
          type: 'TRANSFER_INITIATED'
        }).sort({ seq: -1 }).lean();
      }
    }

    if (!initiateEvent) {
      return res.status(404).json({
        success: false,
        code: 'TRANSFER_NOT_FOUND',
        message: 'Pending transfer event not found'
      });
    }

    if (String(initiateEvent.actorUserId) !== String(req.user._id) && !['ADMIN', 'ORG_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'UNAUTHORIZED_INITIATOR',
        message: 'Only the initiator or an administrator can cancel this transfer'
      });
    }

    const {
      reason = 'Custody transfer cancelled by initiator',
      location,
      conditionNotes,
      occurredAt,
      expectedSeq,
      signature
    } = req.body;

    const cancelled = await recordCustodyEvent({
      evidenceId: initiateEvent.evidenceId,
      type: 'TRANSFER_CANCELLED',
      user: req.user,
      reason: reason || 'Transfer cancelled',
      location,
      conditionNotes,
      occurredAt,
      expectedSeq,
      signature,
      req
    });

    return res.json({
      success: true,
      message: 'Custody transfer cancelled',
      event: cancelled
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        code: err.code || 'BAD_REQUEST',
        message: err.message
      });
    }
    next(err);
  }
}

/**
 * GET /api/custody/my
 * Hub overview for the authenticated user.
 * Items currently held by me and pending incoming/outgoing transfers.
 */
async function getMyCustody(req, res, next) {
  try {
    const currentUserIdStr = String(req.user._id);
    const ScopedCustody = scoped(CustodyEvent, req.user);
    const ScopedEvidence = scoped(Evidence, req.user);

    // Fetch distinct evidence IDs involving the user as actor or recipient
    const relevantEvidenceIds = await ScopedCustody.distinct('evidenceId', {
      $or: [
        { actorUserId: req.user._id },
        { toUserId: req.user._id }
      ]
    });

    // Also include all active evidence if admin
    let targetIds = relevantEvidenceIds;
    if (['ADMIN', 'ORG_ADMIN'].includes(req.user.role)) {
      const allActive = await ScopedEvidence.distinct('evidenceId', { isDeleted: false });
      targetIds = Array.from(new Set([...relevantEvidenceIds, ...allActive]));
    }

    const evidenceList = await ScopedEvidence.find({
      evidenceId: { $in: targetIds },
      isDeleted: false
    }).lean();

    const evidenceMap = new Map();
    evidenceList.forEach(e => evidenceMap.set(e.evidenceId, e));

    const itemsInCustody = [];
    const pendingIncoming = [];
    const pendingOutgoing = [];

    // Evaluate each evidence chain
    for (const evId of targetIds) {
      const events = await ScopedCustody.find({ evidenceId: evId }).sort({ seq: 1 }).lean();
      if (events.length === 0) continue;

      const state = deriveCustodyState(events);
      const evMeta = evidenceMap.get(evId) || { evidenceId: evId };

      // 1. Items I hold
      if (state.currentCustodian && String(state.currentCustodian.userId) === currentUserIdStr && state.status !== 'RELEASED') {
        itemsInCustody.push({
          evidence: evMeta,
          currentCustodian: state.currentCustodian,
          status: state.status,
          totalEvents: events.length,
          lastEvent: events[events.length - 1],
          pendingTransfer: state.pendingTransfer
        });
      }

      // 2. Transfers pending MY acceptance (Incoming)
      if (state.pendingTransfer && String(state.pendingTransfer.toUserId) === currentUserIdStr) {
        pendingIncoming.push({
          evidence: evMeta,
          transfer: state.pendingTransfer,
          initiatedBy: state.pendingTransfer.fromUser,
          reason: state.pendingTransfer.reason,
          timestamp: state.pendingTransfer.timestamp
        });
      }

      // 3. Transfers initiated by ME pending recipient acceptance (Outgoing)
      if (state.pendingTransfer && String(state.pendingTransfer.fromUserId) === currentUserIdStr) {
        pendingOutgoing.push({
          evidence: evMeta,
          transfer: state.pendingTransfer,
          recipient: state.pendingTransfer.toUser,
          reason: state.pendingTransfer.reason,
          timestamp: state.pendingTransfer.timestamp
        });
      }
    }

    return res.json({
      success: true,
      counts: {
        held: itemsInCustody.length,
        incoming: pendingIncoming.length,
        outgoing: pendingOutgoing.length
      },
      itemsInCustody,
      pendingIncoming,
      pendingOutgoing
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/evidence/:id/custody/validate
 * Validates cryptographic chain integrity of custody events for an evidence.
 */
async function validateEvidenceCustody(req, res, next) {
  try {
    const evidence = await findEvidence(req.params.id, req.user);
    if (!evidence) {
      return res.status(404).json({
        success: false,
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence record not found'
      });
    }

    const validation = await validateCustodyChain(evidence.evidenceId, req.user);

    return res.json({
      success: true,
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      valid: validation.valid,
      message: validation.valid ? 'CUSTODY CHAIN INTEGRITY: VALID' : 'CUSTODY CHAIN INTEGRITY: INVALID',
      totalEvents: validation.totalEvents,
      eventsChecked: validation.totalEvents,
      issues: validation.issues
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/custody/officers
 * Fetch candidate officers (ORG_ADMIN, ADMIN, INVESTIGATOR, LAB_ANALYST) in user's org.
 */
async function getCustodyOfficers(req, res, next) {
  try {
    const ScopedUser = scoped(User, req.user);
    const officers = await ScopedUser.find({
      role: { $in: ['ORG_ADMIN', 'ADMIN', 'INVESTIGATOR', 'LAB_ANALYST'] },
      isActive: true
    })
      .select('_id name email role')
      .sort({ name: 1 })
      .lean();

    const currentUserIdStr = String(req.user._id);
    const formatted = officers.map(o => ({
      _id: o._id,
      name: o.name || o.email,
      email: o.email,
      role: o.role,
      isSelf: String(o._id) === currentUserIdStr
    }));

    return res.json({
      success: true,
      officers: formatted
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getEvidenceCustody,
  createEvidenceCustodyEvent,
  acceptTransfer,
  rejectTransfer,
  cancelTransfer,
  getMyCustody,
  validateEvidenceCustody,
  getCustodyOfficers
};
