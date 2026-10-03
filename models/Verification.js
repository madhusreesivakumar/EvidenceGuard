const mongoose = require('mongoose');

const verificationSchema = new mongoose.Schema({
  verificationId: { type: String, required: true },
  orgId: { type: String, required: true, default: 'default', index: true },
  evidenceId: { type: String, required: true },
  caseId: { type: String },
  originalHash: { type: String, required: true },
  submittedHash: { type: String, required: true },
  result: { type: String, enum: ['VERIFIED', 'TAMPERED'], required: true },
  chainConsistent: { type: Boolean, required: true },
  submittedFileName: { type: String },
  submittedFileSize: { type: Number },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedByName: { type: String },
  verifiedAt: { type: Date, default: Date.now },
  ipAddress: { type: String },
  isDemo: { type: Boolean, default: false }
});

verificationSchema.index({ orgId: 1, verificationId: 1 }, { unique: true });
verificationSchema.index({ orgId: 1, evidenceId: 1, verifiedAt: -1 });
verificationSchema.index({ orgId: 1, caseId: 1 });

const rejectModification = function () {
  throw new Error('Verifications are append-only. Updates and deletions are forbidden.');
};

verificationSchema.pre('updateOne', rejectModification);
verificationSchema.pre('updateMany', rejectModification);
verificationSchema.pre('findOneAndUpdate', rejectModification);
verificationSchema.pre('deleteOne', rejectModification);
verificationSchema.pre('deleteMany', rejectModification);
verificationSchema.pre('findOneAndDelete', rejectModification);
verificationSchema.pre('remove', rejectModification);

module.exports = mongoose.model('Verification', verificationSchema);
