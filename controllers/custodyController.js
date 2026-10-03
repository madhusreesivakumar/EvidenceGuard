'use strict';

const CustodyEvent = require('../models/CustodyEvent');
const Evidence = require('../models/Evidence');
const User = require('../models/User');
const {
  deriveCustodyState,
  validateCustodyChain,
  recordCustodyEvent
} = require('../services/custodyService');

/**
 * Helper to ensure evidence exists.
 */
async function findEvidence(id) {
  return await Evidence.findOne({
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
    const evidence = await findEvidence(req.params.id);
    if (!evidence) {
      return res.status(404).json({
        success: false,
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence record not found'
      });
    }

    const events = await CustodyEvent.find({ evidenceId: evidence.evidenceId })
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
 * Record a new custody event (TRANSFER_INITIATED, ANALYZED, STORED, RELEASED, RETURNED).
 */
async function createEvidenceCustodyEvent(req, res, next) {
  try {
    const evidence = await findEvidence(req.params.id);
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
      conditionNotes,
      occurredAt,
      expectedSeq,
      signature,
      req
    });

    return res.status(201).json({
      success: true,
      message: `Custody event [${type}] successfully recorded`,
      event
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
 * POST /api/custody/:custodyId/accept
 * Accept a pending custody transfer.
 */
async function acceptTransfer(req, res, next) {
  try {
    const { custodyId } = req.params;
    const initiateEvent = await CustodyEvent.findOne({
      custodyId,
      type: 'TRANSFER_INITIATED'
    }).lean();

    if (!initiateEvent) {
      return res.status(404).json({
        success: false,
        code: 'TRANSFER_NOT_FOUND',
        message: 'Pending transfer event not found'
      });
    }

    const {
      reason = 'Custody transfer accepted and physical custody assumed',
      location,
      conditionNotes,
      occurredAt,
      expectedSeq
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
 * POST /api/custody/:custodyId/reject
 * Reject a pending custody transfer.
 */
async function rejectTransfer(req, res, next) {
  try {
    const { custodyId } = req.params;
    const initiateEvent = await CustodyEvent.findOne({
      custodyId,
      type: 'TRANSFER_INITIATED'
    }).lean();

    if (!initiateEvent) {
      return res.status(404).json({
        success: false,
        code: 'TRANSFER_NOT_FOUND',
        message: 'Pending transfer event not found'
      });
    }

    const {
      reason,
      location,
      conditionNotes,
      occurredAt,
      expectedSeq
    } = req.body;

    if (!reason || reason.trim().length < 5) {
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
 * POST /api/custody/:custodyId/cancel
 * Cancel an outgoing pending custody transfer.
 */
async function cancelTransfer(req, res, next) {
  try {
    const { custodyId } = req.params;
    const initiateEvent = await CustodyEvent.findOne({
      custodyId,
      type: 'TRANSFER_INITIATED'
    }).lean();

    if (!initiateEvent) {
      return res.status(404).json({
        success: false,
        code: 'TRANSFER_NOT_FOUND',
        message: 'Pending transfer event not found'
      });
    }

    const {
      reason = 'Custody transfer cancelled by initiator',
      location,
      conditionNotes,
      occurredAt,
      expectedSeq
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
 * GET /api/custody/mine
 * Items currently held by me and pending incoming/outgoing transfers.
 */
async function getMyCustody(req, res, next) {
  try {
    const currentUserIdStr = String(req.user._id);

    // Fetch distinct evidence IDs involving the user as actor or recipient
    const relevantEvidenceIds = await CustodyEvent.distinct('evidenceId', {
      $or: [
        { actorUserId: req.user._id },
        { toUserId: req.user._id }
      ]
    });

    // Also include all active evidence if admin
    let targetIds = relevantEvidenceIds;
    if (req.user.role === 'ADMIN') {
      const allActive = await Evidence.distinct('evidenceId', { isDeleted: false });
      targetIds = Array.from(new Set([...relevantEvidenceIds, ...allActive]));
    }

    const evidenceList = await Evidence.find({
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
      const events = await CustodyEvent.find({ evidenceId: evId }).sort({ seq: 1 }).lean();
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

      // 2. Incoming pending transfers
      if (state.pendingTransfer && !state.pendingTransfer.isExpired) {
        if (String(state.pendingTransfer.toUserId) === currentUserIdStr) {
          pendingIncoming.push({
            evidence: evMeta,
            transfer: state.pendingTransfer,
            totalEvents: events.length
          });
        }
        // 3. Outgoing pending transfers
        if (String(state.pendingTransfer.fromUserId) === currentUserIdStr) {
          pendingOutgoing.push({
            evidence: evMeta,
            transfer: state.pendingTransfer,
            totalEvents: events.length
          });
        }
      }
    }

    return res.json({
      success: true,
      itemsInCustody,
      pendingIncoming,
      pendingOutgoing,
      counts: {
        held: itemsInCustody.length,
        incoming: pendingIncoming.length,
        outgoing: pendingOutgoing.length
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/evidence/:id/custody/validate
 * Validate cryptographic integrity and legal transitions of the custody chain.
 */
async function validateEvidenceCustody(req, res, next) {
  try {
    const evidence = await findEvidence(req.params.id);
    if (!evidence) {
      return res.status(404).json({
        success: false,
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence record not found'
      });
    }

    const validationResult = await validateCustodyChain(evidence.evidenceId);

    return res.json({
      success: true,
      evidenceId: evidence.evidenceId,
      ...validationResult
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/custody/officers
 * Fetch candidate officers (ADMIN and INVESTIGATOR) for custody transfers.
 */
async function getCustodyOfficers(req, res, next) {
  try {
    const officers = await User.find({
      role: { $in: ['ADMIN', 'INVESTIGATOR'] },
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
