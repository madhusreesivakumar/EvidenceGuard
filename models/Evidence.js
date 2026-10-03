const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
  evidenceId: { type: String, required: true },
  orgId: { type: String, required: true, default: 'default', index: true },
  caseId: { type: String, required: true, index: true },
  name: String,
  type: { type: String, enum: ['Image', 'Video', 'Audio', 'Document', 'PDF', 'Other'] },
  description: String,
  fileName: String,
  fileSize: Number,
  mimeType: String,
  publicToken: { type: String },
  legacyPublic: { type: Boolean, default: false },
  storageKey: { type: String, select: false },
  storage: {
    driver: { type: String, default: 'local' },
    key: { type: String },
    encryption: {
      alg: { type: String, default: 'AES-256-GCM' },
      kekId: { type: String },
      wrappedDek: { type: String },
      chunkSize: { type: Number, default: 1048576 }
    },
    cipherSize: { type: Number },
    cipherSha256: { type: String }
  },
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

evidenceSchema.index({ orgId: 1, hash: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
evidenceSchema.index({ orgId: 1, evidenceId: 1 }, { unique: true });
evidenceSchema.index({ publicToken: 1 }, { unique: true, sparse: true });
evidenceSchema.index({ orgId: 1, caseId: 1 });
evidenceSchema.index({ orgId: 1, createdAt: -1 });
evidenceSchema.index({ orgId: 1, status: 1, createdAt: -1 });
evidenceSchema.index({ orgId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('Evidence', evidenceSchema);
