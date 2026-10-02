const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Evidence = require('../models/Evidence');

// Rate limiter for public verification: 60 requests per 15 min per IP
const publicVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many verification requests, please try again later.' })
});

// GET /api/public/verify/:caseId
router.get('/verify/:caseId', publicVerifyLimiter, async (req, res, next) => {
  try {
    const caseId = req.params.caseId;

    // Validate caseId format: EG-YYYY-NNNN (EG-0000-0000)
    if (!caseId || typeof caseId !== 'string' || !/^EG-\d{4}-\d{4}$/.test(caseId)) {
      return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'Invalid Case ID format. Must be EG-YYYY-NNNN' });
    }

    // Query non-deleted evidence only
    const evidence = await Evidence.findOne({ caseId, isDeleted: false });
    if (!evidence) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Evidence record not found' });
    }

    // Response header Cache-Control: no-store
    res.set('Cache-Control', 'no-store');

    // Return ONLY the whitelisted safe fields. Never strip fields; construct explicitly.
    const publicData = {
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

    // Standard non-audit logging
    console.log(`[PUBLIC VERIFY] Case ID ${caseId} queried from IP ${req.ip}`);

    return res.json(publicData);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/stats (Genuine counts for landing page)
router.get('/stats', publicVerifyLimiter, async (req, res, next) => {
  try {
    const Block = require('../models/Block');
    const [evidenceCount, verifiedCount, blockCount] = await Promise.all([
      Evidence.countDocuments({ isDeleted: false }),
      Evidence.countDocuments({ isDeleted: false, status: 'Verified' }),
      Block.countDocuments()
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
