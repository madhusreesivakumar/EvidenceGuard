const Block = require('../models/Block');
const { computeBlockHash } = require('./chainHash');
const { logEvent } = require('./auditService');

const ensureGenesis = async () => {
  try {
    const existingGenesis = await Block.findOne({ blockNumber: 0 });
    if (existingGenesis) return existingGenesis;

    const genesisData = {
      blockNumber: 0,
      evidenceId: null,
      caseId: null,
      evidenceHash: null,
      previousHash: '0000000000000000',
      timestamp: new Date()
    };

    const currentHash = computeBlockHash(genesisData);
    
    const genesisBlock = new Block({
      ...genesisData,
      currentHash
    });

    await genesisBlock.save();

    await logEvent({
      action: 'BLOCK_CREATED',
      user: { _id: null }, // System user
      description: 'Genesis block created',
      req: null
    });

    return genesisBlock;
  } catch (err) {
    if (err.code === 11000) {
      // Concurrent startup race condition caught successfully
      return await Block.findOne({ blockNumber: 0 });
    }
    throw err;
  }
};

const getLatestBlock = async (session = null) => {
  return await Block.findOne().sort({ blockNumber: -1 }).session(session);
};

const appendBlock = async ({ evidence, session }) => {
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const latest = await getLatestBlock(session);
      const newBlockNumber = latest.blockNumber + 1;
      
      const blockData = {
        blockNumber: newBlockNumber,
        evidenceId: evidence.evidenceId,
        caseId: evidence.caseId,
        evidenceHash: evidence.hash,
        previousHash: latest.currentHash,
        timestamp: new Date(),
        createdBy: evidence.uploadedBy
      };

      const currentHash = computeBlockHash(blockData);
      
      const newBlock = new Block({
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
