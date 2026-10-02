const Block = require('../models/Block');
const Evidence = require('../models/Evidence');
const { computeBlockHash } = require('./chainHash');

const validateChain = async () => {
  const issues = [];
  let firstBrokenBlock = null;
  let blocksChecked = 0;
  let expectedBlockNumber = 0;
  let previousHashState = "0000000000000000";

  const addIssue = (blockNumber, check, expected, actual) => {
    if (firstBrokenBlock === null) firstBrokenBlock = blockNumber;
    if (issues.length < 50) {
      issues.push({ blockNumber, check, expected, actual });
    }
  };

  const cursor = Block.find().sort({ blockNumber: 1 }).cursor();

  for await (const block of cursor) {
    blocksChecked++;

    if (firstBrokenBlock !== null) {
      // Everything after the first broken block is reported as "downstream of a break" without flooding the list.
      continue;
    }

    if (block.blockNumber !== expectedBlockNumber) {
      addIssue(block.blockNumber, 'Contiguous Block Number', String(expectedBlockNumber), String(block.blockNumber));
      break; 
    }

    if (block.blockNumber === 0 && block.previousHash !== "0000000000000000") {
      addIssue(block.blockNumber, 'Genesis Previous Hash', "0000000000000000", block.previousHash);
    }

    if (block.blockNumber > 0 && block.previousHash !== previousHashState) {
      addIssue(block.blockNumber, 'Chain Link (previousHash)', previousHashState, block.previousHash);
    }

    const recomputedHash = computeBlockHash(block);
    if (block.currentHash !== recomputedHash) {
      addIssue(block.blockNumber, 'Self Hash Integrity', recomputedHash, block.currentHash);
    }

    if (block.evidenceId) {
      const ev = await Evidence.findOne({ evidenceId: block.evidenceId });
      if (ev && ev.hash !== block.evidenceHash) {
        addIssue(block.blockNumber, 'Evidence Hash Sync', ev.hash, block.evidenceHash);
      }
    }

    previousHashState = block.currentHash;
    expectedBlockNumber++;
  }

  // 6. every non-deleted Evidence record has a matching block
  if (firstBrokenBlock === null) {
    const missingBlockEvidence = await Evidence.findOne({ isDeleted: false, blockNumber: null });
    if (missingBlockEvidence) {
      addIssue('N/A', 'Evidence Missing Block', 'Not Null', 'Null (Evidence ID: ' + missingBlockEvidence.evidenceId + ')');
    }
  }

  const valid = issues.length === 0;
  
  return {
    valid,
    blocksChecked,
    message: valid ? "BLOCKCHAIN INTEGRITY: VALID" : "BLOCKCHAIN INTEGRITY: INVALID",
    firstBrokenBlock,
    issues
  };
};

module.exports = {
  validateChain
};
