'use strict';
/**
 * src/routes/blockchain.js
 * GET  /api/blockchain           paginated block list
 * POST /api/blockchain/validate  full chain validation
 */
const router   = require('express').Router();
const Block    = require('../models/Block');
const { auth } = require('../middleware/auth');
const { validateChain } = require('../services/blockchainService');
const { audit }         = require('../services/auditService');

// ── GET /api/blockchain ───────────────────────────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    const lim   = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const page  = Math.max(parseInt(req.query.page,  10) || 1, 1);
    const skip  = (page - 1) * lim;
    const total = await Block.countDocuments();
    const pages = Math.ceil(total / lim) || 1;
    const blocks = await Block.find().sort({ blockNumber: 1 }).skip(skip).limit(lim).lean();
    res.json({ success: true, message: 'OK', data: { blocks, total, page, pages } });
  } catch (err) { next(err); }
});

// ── POST /api/blockchain/validate ────────────────────────────────
router.post('/validate', auth, async (req, res, next) => {
  try {
    const { valid, blocksChecked, invalidBlocks } = await validateChain();

    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'BLOCKCHAIN_VALIDATED',
      description: `Chain validated: ${valid ? 'VALID' : 'INVALID'} (${blocksChecked} blocks checked)`,
      ip: req.ip });

    res.json({
      success: true,
      message: valid
        ? `Blockchain-inspired hash-chain is VALID — all ${blocksChecked} block(s) verified.`
        : `Hash-chain integrity BROKEN — ${invalidBlocks.length} block(s) failed: #${invalidBlocks.join(', #')}.`,
      data: { valid, blocksChecked, invalidBlocks }
    });
  } catch (err) { next(err); }
});

module.exports = router;
