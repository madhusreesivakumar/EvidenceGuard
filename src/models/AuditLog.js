'use strict';
/**
 * src/models/AuditLog.js
 * Immutable audit event log. Never updated, only inserted.
 */
const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, default: null },
  userName:    { type: String, default: 'System' },
  role:        { type: String, default: 'system' },
  action:      { type: String, required: true },
  evidenceId:  { type: String, default: null },
  caseId:      { type: String, default: null },
  description: { type: String, required: true },
  timestamp:   { type: Date, default: Date.now },
  ipAddress:   { type: String, default: '' }
});

auditSchema.index({ timestamp: -1 });
auditSchema.index({ action: 1 });
auditSchema.index({ userId: 1 });

// Prevent updates — audit logs are append-only
auditSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Audit logs are immutable.'));
  next();
});

module.exports = mongoose.model('AuditLog', auditSchema);
