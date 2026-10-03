const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  orgId: { type: String, required: true, default: 'default', index: true },
  seq: { type: Number },
  prevHash: { type: String },
  entryHash: { type: String },
  userId: String,
  userName: String,
  role: String,
  action: { 
    type: String, 
    enum: [
      'REGISTER', 'LOGIN', 'LOGOUT', 'UPLOAD', 'HASH_GENERATED',
      'VERIFY', 'TAMPER_DETECTED', 'DELETE', 'BLOCK_CREATED',
      'BLOCKCHAIN_VALIDATED', 'USER_CREATED', 'ROLE_CHANGED', 'QR_GENERATED',
      'USER_DEACTIVATED', 'KEY_REGISTERED', 'KEY_REVOKED',
      'CUSTODY_EVENT', 'CUSTODY_TRANSFER',
      'NOTIFICATION_FAILED', 'PREFERENCES_CHANGED',
      'FORENSICS_EXTRACTED',
      'CHAIN_ANCHORED', 'ANCHOR_FAILED', 'ANCHOR_VERIFIED',
      'ORG_CREATED', 'ORG_STATUS_CHANGED', 'INVITATION_SENT', 'INVITATION_ACCEPTED'
    ] 
  },
  evidenceId: String,
  caseId: String,
  description: String,
  timestamp: { type: Date, required: true, index: true },
  ipAddress: String
}, { timestamps: false });

auditLogSchema.index({ orgId: 1, eventId: 1 }, { unique: true });
auditLogSchema.index({ orgId: 1, seq: 1 }, { unique: true, sparse: true });
auditLogSchema.index({ orgId: 1, entryHash: 1 }, { unique: true, sparse: true });
auditLogSchema.index({ orgId: 1, timestamp: -1 });

const throwAppendOnlyError = function(next) {
  const err = new Error("Audit logs are append-only. Updates and deletions are strictly prohibited.");
  if (typeof next === 'function') {
    return next(err);
  }
  throw err;
};

auditLogSchema.pre('updateOne', throwAppendOnlyError);
auditLogSchema.pre('updateMany', throwAppendOnlyError);
auditLogSchema.pre('findOneAndUpdate', throwAppendOnlyError);
auditLogSchema.pre('deleteOne', throwAppendOnlyError);
auditLogSchema.pre('deleteMany', throwAppendOnlyError);
auditLogSchema.pre('findOneAndDelete', throwAppendOnlyError);
auditLogSchema.pre('findOneAndReplace', throwAppendOnlyError);
auditLogSchema.pre('remove', { document: true, query: true }, throwAppendOnlyError);

module.exports = mongoose.model('AuditLog', auditLogSchema);
