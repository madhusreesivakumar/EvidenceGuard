const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  seq: { type: Number, unique: true, sparse: true },
  prevHash: { type: String },
  entryHash: { type: String, unique: true, sparse: true },
  userId: String,
  userName: String,
  role: String,
  action: { 
    type: String, 
    enum: [
      'REGISTER', 'LOGIN', 'LOGOUT', 'UPLOAD', 'HASH_GENERATED',
      'VERIFY', 'TAMPER_DETECTED', 'DELETE', 'BLOCK_CREATED',
      'BLOCKCHAIN_VALIDATED', 'USER_CREATED', 'ROLE_CHANGED', 'QR_GENERATED',
      'USER_DEACTIVATED'
    ] 
  },
  evidenceId: String,
  caseId: String,
  description: String,
  timestamp: { type: Date, required: true, index: true },
  ipAddress: String
}, { timestamps: false });

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
