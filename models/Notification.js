'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  notificationId: {
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
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  channel: {
    type: String,
    enum: ['IN_APP', 'EMAIL', 'SMS'],
    required: true
  },
  type: {
    type: String,
    required: true,
    index: true
  },
  severity: {
    type: String,
    enum: ['INFO', 'WARNING', 'CRITICAL'],
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  body: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  link: {
    type: String,
    default: null
  },
  evidenceId: {
    type: String,
    default: null,
    index: true
  },
  caseId: {
    type: String,
    default: null
  },
  dedupeKey: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'],
    default: 'QUEUED',
    index: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  nextAttemptAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  leaseUntil: {
    type: Date,
    default: null,
    index: true
  },
  lastError: {
    type: String,
    default: null,
    maxlength: 500
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  sentAt: {
    type: Date,
    default: null
  },
  readAt: {
    type: Date,
    default: null,
    index: true
  }
}, {
  timestamps: false
});

// Compound unique index for strict deduplication & coalescing
notificationSchema.index({ orgId: 1, notificationId: 1 }, { unique: true });
notificationSchema.index({ dedupeKey: 1, userId: 1, channel: 1 }, { unique: true });

// Compound index for high-efficiency worker polling & lease claiming
notificationSchema.index({ orgId: 1, status: 1, nextAttemptAt: 1, leaseUntil: 1 });

// Compound index for user notification center queries
notificationSchema.index({ orgId: 1, userId: 1, channel: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
