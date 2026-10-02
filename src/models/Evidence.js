'use strict';
/**
 * src/models/Evidence.js
 */
const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
  evidenceId:  { type: String, required: true, unique: true },
  caseId:      { type: String, required: true },
  name:        { type: String, required: true, trim: true },
  type:        { type: String, required: true, enum: ['Image','Video','Audio','Document','PDF','Other'] },
  description: { type: String, default: '' },
  fileName:    { type: String, required: true },
  fileSize:    { type: Number, default: 0 },
  filePath:    { type: String, default: '' },
  hash:        { type: String, required: true },
  status:      { type: String, enum: ['Pending','Verified','Tampered'], default: 'Pending' },
  uploadedBy:  {
    id:    { type: mongoose.Schema.Types.ObjectId },
    name:  { type: String },
    email: { type: String }
  },
  createdAt:   { type: Date, default: Date.now },
  verifiedAt:  { type: Date, default: null },
  blockNumber: { type: Number, default: null }
});

// Secondary indexes (unique:true above handles evidenceId index automatically)
evidenceSchema.index({ caseId: 1 });
evidenceSchema.index({ hash: 1 });
evidenceSchema.index({ createdAt: -1 });
evidenceSchema.index({ status: 1 });

module.exports = mongoose.model('Evidence', evidenceSchema);
