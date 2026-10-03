'use strict';

const mongoose = require('mongoose');

const custodyEventSchema = new mongoose.Schema({
  custodyId: {
    type: String,
    required: true,
    index: true
  },
  orgId: {
    type: String,
    required: true,
    default: 'default',
    index: true
  },
  evidenceId: {
    type: String,
    required: true,
    index: true
  },
  seq: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'COLLECTED',
      'TRANSFER_INITIATED',
      'TRANSFER_ACCEPTED',
      'TRANSFER_REJECTED',
      'TRANSFER_CANCELLED',
      'ACCESSED',
      'ANALYZED',
      'STORED',
      'RELEASED',
      'RETURNED'
    ]
  },
  actorUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  actorName: {
    type: String,
    default: ''
  },
  toUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  toUserName: {
    type: String,
    default: ''
  },
  externalParty: {
    name: { type: String, default: null },
    organization: { type: String, default: null }
  },
  reason: {
    type: String,
    required: true,
    minlength: 5,
    maxlength: 500,
    trim: true
  },
  location: {
    type: String,
    maxlength: 120,
    trim: true,
    default: ''
  },
  conditionNotes: {
    type: String,
    maxlength: 500,
    trim: true,
    default: ''
  },
  occurredAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  recordedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: null
  },
  auto: {
    type: Boolean,
    default: false
  },
  backfilled: {
    type: Boolean,
    default: false
  },
  prevHash: {
    type: String,
    required: true
  },
  entryHash: {
    type: String,
    required: true
  },
  signature: {
    keyId: String,
    fingerprint: String,
    algorithm: String,
    value: String,
    signedAt: Date
  }
}, {
  timestamps: false
});

// Enforce unique sequential ordering per evidence chain
custodyEventSchema.index({ orgId: 1, custodyId: 1 }, { unique: true });
custodyEventSchema.index({ orgId: 1, evidenceId: 1, seq: 1 }, { unique: true });
custodyEventSchema.index({ orgId: 1, actorUserId: 1, type: 1 });
custodyEventSchema.index({ orgId: 1, toUserId: 1, type: 1 });

const throwAppendOnlyError = function(next) {
  const err = new Error('Custody events are append-only. Updates and deletions are strictly prohibited.');
  if (typeof next === 'function') {
    return next(err);
  }
  throw err;
};

custodyEventSchema.pre('updateOne', throwAppendOnlyError);
custodyEventSchema.pre('updateMany', throwAppendOnlyError);
custodyEventSchema.pre('findOneAndUpdate', throwAppendOnlyError);
custodyEventSchema.pre('deleteOne', throwAppendOnlyError);
custodyEventSchema.pre('deleteMany', throwAppendOnlyError);
custodyEventSchema.pre('findOneAndDelete', throwAppendOnlyError);
custodyEventSchema.pre('findOneAndReplace', throwAppendOnlyError);
custodyEventSchema.pre('remove', { document: true, query: true }, throwAppendOnlyError);

module.exports = mongoose.model('CustodyEvent', custodyEventSchema);
