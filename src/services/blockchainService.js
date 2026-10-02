'use strict';
/**
 * src/services/blockchainService.js
 * Blockchain-inspired hash-chain prototype.
 * Adds a new block linking to the previous block's hash.
 */
const Block  = require('../models/Block');
const { hashBlock, nextBlockNumber } = require('../utils/helpers');

const ZERO_HASH = '0'.repeat(64);

/**
 * Append a new block to the chain.
 * @param {string} evidenceId
 * @param {string} caseId
 * @param {string} evidenceHash  SHA-256 of the evidence file
 * @returns {Promise<Block>}     The saved block document
 */
async function addBlock(evidenceId, caseId, evidenceHash) {
  const bNum = await nextBlockNumber();

  // Previous hash: last block's currentHash, or zero-hash for genesis
  let previousHash = ZERO_HASH;
  if (bNum > 0) {
    const prev = await Block.findOne({ blockNumber: bNum - 1 }).lean();
    if (prev) previousHash = prev.currentHash;
  }

  const timestamp = new Date();
  const currentHash = hashBlock({
    blockNumber: bNum,
    evidenceId,
    caseId,
    evidenceHash,
    previousHash,
    timestamp: timestamp.toISOString()
  });

  return Block.create({ blockNumber: bNum, evidenceId, caseId, evidenceHash, previousHash, currentHash, timestamp });
}

/**
 * Validate the entire chain: recalculate every block's hash and verify
 * each block's previousHash matches the preceding block's currentHash.
 * @returns {{ valid: boolean, blocksChecked: number, invalidBlocks: number[] }}
 */
async function validateChain() {
  const blocks = await Block.find().sort({ blockNumber: 1 }).lean();
  if (!blocks.length) return { valid: true, blocksChecked: 0, invalidBlocks: [] };

  const invalidBlocks = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const recalc = hashBlock({
      blockNumber:  b.blockNumber,
      evidenceId:   b.evidenceId,
      caseId:       b.caseId,
      evidenceHash: b.evidenceHash,
      previousHash: b.previousHash,
      timestamp:    new Date(b.timestamp).toISOString()
    });

    const hashOk    = recalc === b.currentHash;
    const linkOk    = i === 0 || b.previousHash === blocks[i - 1].currentHash;

    if (!hashOk || !linkOk) invalidBlocks.push(b.blockNumber);
  }

  return { valid: invalidBlocks.length === 0, blocksChecked: blocks.length, invalidBlocks };
}

module.exports = { addBlock, validateChain, ZERO_HASH };
