'use strict';

/**
 * models/Anchor.js
 * Sprint 10 / 15A – Ethereum Blockchain Anchor Model with Multi-Org Scoping
 */

const mongoose = require('mongoose');

const anchorSchema = new mongoose.Schema({
  anchorId: {
    type: String,
    required: true
  },
  orgId: {
    type: String,
    required: true,
    index: true
  },
  fromBlock: {
    type: Number,
    required: true
  },
  toBlock: {
    type: Number,
    required: true
  },
  leafCount: {
    type: Number,
    required: true
  },
  merkleRoot: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'MISMATCH'],
    default: 'PENDING',
    required: true
  },
  txHash: {
    type: String,
    default: null
  },
  chainId: {
    type: Number,
    default: null
  },
  contractAddress: {
    type: String,
    default: null
  },
  onChainAnchorId: {
    type: Number,
    default: null
  },
  ethBlockNumber: {
    type: Number,
    default: null
  },
  confirmations: {
    type: Number,
    default: 0
  },
  submittedAt: {
    type: Date,
    default: null
  },
  confirmedAt: {
    type: Date,
    default: null
  },
  attempts: {
    type: Number,
    default: 0
  },
  errorMessage: {
    type: String,
    default: null
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

anchorSchema.index({ orgId: 1, fromBlock: 1, toBlock: 1 }, { unique: true });
anchorSchema.index({ orgId: 1, anchorId: 1 }, { unique: true });

module.exports = mongoose.model('Anchor', anchorSchema);
