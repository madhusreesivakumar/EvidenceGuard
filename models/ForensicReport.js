'use strict';

/**
 * models/ForensicReport.js
 * Sprint 14A – Append-Only Forensic Analysis Report Model
 */

const mongoose = require('mongoose');

const forensicReportSchema = new mongoose.Schema({
  evidenceId: {
    type: String,
    required: true,
    index: true
  },
  version: {
    type: Number,
    required: true,
    default: 1
  },
  extractorVersion: {
    type: String,
    default: '1.0.0'
  },
  extractedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  fileSignature: {
    detected: {
      type: String,
      default: 'unknown'
    },
    declared: {
      type: String,
      default: 'unknown'
    },
    match: {
      type: Boolean,
      default: false
    }
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  anomalies: [
    {
      ruleId: { type: String, required: true },
      severity: { type: String, enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH'], required: true },
      explanation: { type: String, required: true },
      fields: [{ type: String }]
    }
  ],
  metadataHash: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['COMPLETED', 'EXTRACTION_FAILED'],
    default: 'COMPLETED',
    index: true
  },
  error: {
    type: String,
    default: null
  },
  diffFromPrevious: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  disclaimer: {
    type: String,
    default: 'These are indicators for examiner review. Metadata is easy to edit, and the absence of flags proves nothing.'
  }
}, {
  timestamps: false
});

// Compound unique index ensuring version numbers for an evidenceId are strictly unique
forensicReportSchema.index({ evidenceId: 1, version: 1 }, { unique: true });

// Compound index for querying latest report
forensicReportSchema.index({ evidenceId: 1, version: -1 });

// Append-only constraint: prevent updates and deletions
const throwAppendOnlyError = function(next) {
  const err = new Error('Forensic reports are append-only. Updates and deletions are strictly prohibited.');
  if (typeof next === 'function') {
    return next(err);
  }
  throw err;
};

forensicReportSchema.pre('updateOne', throwAppendOnlyError);
forensicReportSchema.pre('updateMany', throwAppendOnlyError);
forensicReportSchema.pre('findOneAndUpdate', throwAppendOnlyError);
forensicReportSchema.pre('deleteOne', throwAppendOnlyError);
forensicReportSchema.pre('deleteMany', throwAppendOnlyError);
forensicReportSchema.pre('findOneAndDelete', throwAppendOnlyError);
forensicReportSchema.pre('findOneAndReplace', throwAppendOnlyError);

module.exports = mongoose.model('ForensicReport', forensicReportSchema);
