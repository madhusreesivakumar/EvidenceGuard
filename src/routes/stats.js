'use strict';
/**
 * src/routes/stats.js
 * GET /api/stats — dashboard statistics (live counts from DB)
 */
const router   = require('express').Router();
const { auth } = require('../middleware/auth');
const Evidence = require('../models/Evidence');
const User     = require('../models/User');
const Block    = require('../models/Block');
const AuditLog = require('../models/AuditLog');

router.get('/', auth, async (req, res, next) => {
  try {
    const [total, verified, pending, tampered, users, auditEvents, blockchainBlocks] =
      await Promise.all([
        Evidence.countDocuments(),
        Evidence.countDocuments({ status: 'Verified' }),
        Evidence.countDocuments({ status: 'Pending' }),
        Evidence.countDocuments({ status: 'Tampered' }),
        User.countDocuments(),
        AuditLog.countDocuments(),
        Block.countDocuments()
      ]);

    res.json({
      success: true,
      message: 'OK',
      data: { total, verified, pending, tampered, users, auditEvents, blockchainBlocks }
    });
  } catch (err) { next(err); }
});

module.exports = router;
