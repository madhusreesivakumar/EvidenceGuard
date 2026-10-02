const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
  evidenceId: { type: String, required: true, unique: true },
  caseId: { type: String, required: true, index: true },
  name: String,
  type: { type: String, enum: ['Image', 'Video', 'Audio', 'Document', 'PDF', 'Other'] },
  description: String,
  fileName: String,
  fileSize: Number,
  mimeType: String,
  storageKey: { type: String, select: false },
  hash: { 
    type: String, 
    required: true, 
    lowercase: true,
    validate: {
      validator: function(v) { return /^[a-f0-9]{64}$/.test(v); },
      message: props => `${props.value} is not a valid 64-char lowercase hex hash!`
    }
  },
  status: { type: String, enum: ['Pending', 'Verified', 'Tampered'], default: 'Pending' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: Date,
  blockNumber: Number,
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedByName: String,
  deletedReason: String,
  storageRemoved: { type: Boolean, default: true },
  isDemo: { type: Boolean, default: false }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

evidenceSchema.index({ hash: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
evidenceSchema.index({ createdAt: -1 });
evidenceSchema.index({ status: 1, createdAt: -1 });
evidenceSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Evidence', evidenceSchema);
