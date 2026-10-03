'use strict';

const Block = require('../models/Block');
const Evidence = require('../models/Evidence');
const SystemStatus = require('../models/SystemStatus');
const chainValidator = require('../services/chainValidator');
const { logEvent } = require('../services/auditService');
const { scoped } = require('../services/tenantScope');

const getBlocks = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const order = req.query.order === 'desc' ? -1 : 1;
    const skip = (page - 1) * limit;

    const ScopedBlock = scoped(Block, req.user);
    const ScopedEvidence = scoped(Evidence, req.user);

    const total = await ScopedBlock.countDocuments();
    const blocks = await ScopedBlock.find()
      .sort({ blockNumber: order })
      .skip(skip)
      .limit(limit)
      .lean();

    const head = await ScopedBlock.findOne().sort({ blockNumber: -1 }).lean();

    const evidenceIds = blocks.map(b => b.evidenceId).filter(Boolean);
    const deletedEvidence = await ScopedEvidence.find({ evidenceId: { $in: evidenceIds }, isDeleted: true }).select('evidenceId').lean();
    const deletedSet = new Set(deletedEvidence.map(e => e.evidenceId));

    const blocksWithFlag = blocks.map(b => ({
      ...b,
      evidenceDeleted: b.evidenceId ? deletedSet.has(b.evidenceId) : false
    }));

    res.json({
      success: true,
      data: blocksWithFlag,
      meta: {
        total,
        page,
        limit,
        head: head ? { blockNumber: head.blockNumber, hash: head.currentHash } : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Failed to fetch blocks' });
  }
};

const validateBlockchain = async (req, res, next) => {
  try {
    const orgId = req.user?.orgId || 'default';
    const result = await chainValidator.validateChain(orgId);
    const validatedAt = new Date().toISOString();
    
    await logEvent({
      action: 'BLOCKCHAIN_VALIDATED',
      user: req.user,
      description: `Blockchain validation: ${result.message} (${result.blocksChecked} blocks checked)`,
      orgId,
      req
    });

    await SystemStatus.findOneAndUpdate(
      { key: `chainValidation_${orgId}` },
      {
        $set: {
          value: {
            valid: result.valid,
            blocksChecked: result.blocksChecked,
            validatedAt,
            validatedByName: req.user.name,
            firstBrokenBlock: result.firstBrokenBlock
          },
          updatedAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    if (!result.valid) {
      try {
        const eventBus = require('../services/eventBus');
        eventBus.emit('CHAIN_INVALID', {
          chainType: 'BLOCKCHAIN',
          issues: result.issues,
          firstBrokenBlock: result.firstBrokenBlock,
          actorUser: req.user,
          orgId,
          req
        });
      } catch (busErr) {
        console.error('[EVENT_BUS ERROR]', busErr);
      }
    }

    res.json({
      success: true,
      valid: result.valid,
      blocksChecked: result.blocksChecked,
      message: result.message,
      firstBrokenBlock: result.firstBrokenBlock,
      issues: result.issues,
      validatedAt,
      validatedBy: req.user._id
    });
  } catch (err) {
    console.error('[VALIDATE BLOCKCHAIN ERROR]', err);
    res.status(500).json({ success: false, code: 'CHAIN_VALIDATION_FAILED', message: 'Failed to run blockchain validation' });
  }
};

module.exports = {
  getBlocks,
  validateBlockchain
};
