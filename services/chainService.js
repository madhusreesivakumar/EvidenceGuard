'use strict';

const Block = require('../models/Block');
const { computeBlockHash } = require('./chainHash');
const { logEvent } = require('./auditService');
const { unscoped } = require('./tenantScope');

const ensureGenesis = async (orgId = 'default') => {
  try {
    const existingGenesis = await unscoped(Block).findOne({ orgId, blockNumber: 0 });
    if (existingGenesis) return existingGenesis;

    const genesisData = {
      blockNumber: 0,
      orgId,
      evidenceId: null,
      caseId: null,
      evidenceHash: null,
      previousHash: '0000000000000000',
      timestamp: new Date()
    };

    const currentHash = computeBlockHash(genesisData);
    
    const genesisBlock = new (unscoped(Block))({
      ...genesisData,
      currentHash
    });

    await genesisBlock.save();

    await logEvent({
      action: 'BLOCK_CREATED',
      user: { _id: null, orgId }, // System user
      description: `Genesis block created for organization ${orgId}`,
      orgId,
      req: null
    });

    return genesisBlock;
  } catch (err) {
    if (err.code === 11000) {
      // Concurrent startup race condition caught successfully
      return await unscoped(Block).findOne({ orgId, blockNumber: 0 });
    }
    throw err;
  }
};

const getLatestBlock = async (orgId = 'default', session = null) => {
  return await unscoped(Block).findOne({ orgId }).sort({ blockNumber: -1 }).session(session);
};

const appendBlock = async ({ evidence, orgId, session }) => {
  const targetOrgId = orgId || evidence.orgId || 'default';
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      let latest = await getLatestBlock(targetOrgId, session);
      if (!latest) {
        latest = await ensureGenesis(targetOrgId);
      }
      const newBlockNumber = latest.blockNumber + 1;
      
      const blockData = {
        blockNumber: newBlockNumber,
        orgId: targetOrgId,
        evidenceId: evidence.evidenceId,
        caseId: evidence.caseId,
        evidenceHash: evidence.hash,
        previousHash: latest.currentHash,
        timestamp: new Date(),
        createdBy: evidence.uploadedBy
      };

      const currentHash = computeBlockHash(blockData);
      
      const newBlock = new (unscoped(Block))({
        ...blockData,
        currentHash
      });

      await newBlock.save({ session });
      
      return newBlock;
    } catch (err) {
      if (err.code === 11000) {
        if (attempts >= maxAttempts) {
          const error = new Error('Ledger busy, please retry');
          error.status = 503;
          throw error;
        }
        // Short random backoff
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
        continue;
      }
      throw err;
    }
  }
};

module.exports = {
  ensureGenesis,
  getLatestBlock,
  appendBlock
};
