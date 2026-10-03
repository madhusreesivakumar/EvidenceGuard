'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Evidence = require('../models/Evidence');
const { unscoped } = require('../services/tenantScope');

// Rate limiter for public verification: 60 requests per 15 min per IP
const publicVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many verification requests, please try again later.' })
});

// Helper to format safe public payload
function formatPublicPayload(evidence) {
  return {
    caseId: evidence.caseId,
    evidenceId: evidence.evidenceId,
    type: evidence.type,
    hash: evidence.hash,
    registeredAt: evidence.createdAt,
    status: evidence.status,
    statusAsOf: evidence.verifiedAt || null,
    isDemo: evidence.isDemo || false,
    note: 'Status shows the result of the most recent verification. It is not a live check of any file.'
  };
}

// GET /api/public/verify (query parameter style: ?t=<token> or ?caseId=<caseId>)
router.get('/verify', publicVerifyLimiter, async (req, res, next) => {
  try {
    const { t: token, caseId } = req.query;
    res.set('Cache-Control', 'no-store');

    if (token) {
      const evidence = await unscoped(Evidence).findOne({ publicToken: token, isDeleted: false });
      if (!evidence) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Evidence record not found' });
      }
      return res.json(formatPublicPayload(evidence));
    }

    if (caseId) {
      if (typeof caseId !== 'string' || !/^EG-\d{4}-\d{4}$/.test(caseId)) {
        return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'Invalid Case ID format. Must be EG-YYYY-NNNN' });
      }
      const evidence = await unscoped(Evidence).findOne({ caseId, isDeleted: false, legacyPublic: true });
      if (!evidence) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Evidence record not found' });
      }
      return res.json(formatPublicPayload(evidence));
    }

    return res.status(400).json({ success: false, code: 'MISSING_PARAM', message: 'Query parameter "t" or "caseId" required' });
  } catch (err) {
    next(err);
  }
});

// GET /api/public/verify/:identifier
// Resolves by publicToken, or by caseId ONLY if flagged legacyPublic
router.get('/verify/:identifier', publicVerifyLimiter, async (req, res, next) => {
  try {
    const identifier = req.params.identifier;
    res.set('Cache-Control', 'no-store');

    // Case ID format: EG-YYYY-NNNN
    if (/^EG-\d{4}-\d{4}$/.test(identifier)) {
      const evidence = await unscoped(Evidence).findOne({ caseId: identifier, isDeleted: false, legacyPublic: true });
      if (!evidence) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Evidence record not found' });
      }
      return res.json(formatPublicPayload(evidence));
    }

    // Try finding by publicToken
    const evidenceByToken = await unscoped(Evidence).findOne({ publicToken: identifier, isDeleted: false });
    if (evidenceByToken) {
      return res.json(formatPublicPayload(evidenceByToken));
    }

    // Check if identifier is an invalid Case ID format attempt
    if (identifier.startsWith('EG-') || identifier.includes('-')) {
      return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'Invalid Case ID format. Must be EG-YYYY-NNNN' });
    }

    return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Evidence record not found' });
  } catch (err) {
    next(err);
  }
});

// GET /api/public/stats (Genuine counts for landing page)
router.get('/stats', publicVerifyLimiter, async (req, res, next) => {
  try {
    const Block = require('../models/Block');
    const [evidenceCount, verifiedCount, blockCount] = await Promise.all([
      unscoped(Evidence).countDocuments({ isDeleted: false }),
      unscoped(Evidence).countDocuments({ isDeleted: false, status: 'Verified' }),
      unscoped(Block).countDocuments()
    ]);
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      stats: {
        evidenceCount,
        verifiedCount,
        blockCount,
        systemStatus: 'ONLINE'
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
