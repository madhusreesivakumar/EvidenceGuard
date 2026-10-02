'use strict';
/**
 * src/utils/helpers.js
 * Pure utility functions shared across services and routes.
 */
const crypto = require('crypto');
const Evidence = require('../models/Evidence');
const Block    = require('../models/Block');

/** Generate the next sequential Evidence ID: EV-001, EV-002 … */
async function nextEvidenceId() {
  const count = await Evidence.countDocuments();
  return `EV-${String(count + 1).padStart(3, '0')}`;
}

/** Generate a random Case ID when none is supplied. */
function makeCaseId() {
  const year = new Date().getFullYear();
  const seq  = String(Math.floor(Math.random() * 9000) + 1000);
  return `EG-${year}-${seq}`;
}

/**
 * Compute SHA-256 of a blockchain block's payload.
 * The payload is deterministically serialised from these six fields —
 * never change field order or names without re-validating all stored blocks.
 */
function hashBlock({ blockNumber, evidenceId, caseId, evidenceHash, previousHash, timestamp }) {
  const payload = JSON.stringify({ blockNumber, evidenceId, caseId, evidenceHash, previousHash, timestamp });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/** Get the next block number (last blockNumber + 1, or 0 for genesis). */
async function nextBlockNumber() {
  const last = await Block.findOne().sort({ blockNumber: -1 }).lean();
  return last ? last.blockNumber + 1 : 0;
}

/**
 * Compute SHA-256 of a Buffer (used for uploaded file hashing).
 * Returns lowercase hex string.
 */
function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { nextEvidenceId, makeCaseId, hashBlock, nextBlockNumber, sha256Buffer };
