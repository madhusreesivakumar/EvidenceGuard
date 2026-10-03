'use strict';

const mongoose = require('mongoose');

const UserKeySchema = new mongoose.Schema({
  keyId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  orgId: {
    type: String,
    required: true,
    default: 'default',
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  algorithm: {
    type: String,
    required: true,
    default: 'ECDSA-P256-SHA256'
  },
  publicKeyJwk: {
    type: Object,
    required: true
  },
  fingerprint: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  label: {
    type: String,
    required: true,
    trim: true,
    maxlength: 60
  },
  status: {
    type: String,
    enum: ['active', 'revoked'],
    default: 'active',
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  revokedAt: {
    type: Date,
    default: null
  },
  revokedReason: {
    type: String,
    trim: true,
    default: null
  }
}, {
  timestamps: false,
  collection: 'userkeys'
});

UserKeySchema.index({ orgId: 1, keyId: 1 }, { unique: true });
UserKeySchema.index({ orgId: 1, fingerprint: 1 }, { unique: true });
UserKeySchema.index({ orgId: 1, userId: 1, status: 1 });

module.exports = mongoose.model('UserKey', UserKeySchema);
