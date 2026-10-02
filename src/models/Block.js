'use strict';
/**
 * src/models/Block.js
 * One document per blockchain hash-chain block.
 */
const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
  blockNumber:  { type: Number, required: true, unique: true },
  evidenceId:   { type: String, required: true },
  caseId:       { type: String, required: true },
  evidenceHash: { type: String, required: true },
  previousHash: { type: String, required: true },
  currentHash:  { type: String, required: true },
  timestamp:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('Block', blockSchema);
