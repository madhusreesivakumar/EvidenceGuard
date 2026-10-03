const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, match: /.+@.+\..+/ },
  passwordHash: { type: String, required: true, select: false },
  orgId: { type: String, default: 'default', trim: true, index: true },
  role: { 
    type: String, 
    enum: ['SUPER_ADMIN', 'ORG_ADMIN', 'ADMIN', 'INVESTIGATOR', 'LAB_ANALYST', 'COURT_OFFICER', 'AUDITOR', 'VIEWER'], 
    default: 'VIEWER' 
  },
  isActive: { type: Boolean, default: true },
  deactivatedAt: { type: Date, default: null },
  deactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  lastLoginAt: { type: Date, default: null }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: false },
  toJSON: {
    transform: (doc, ret) => {
      delete ret.passwordHash;
      return ret;
    }
  }
});

module.exports = mongoose.model('User', userSchema);
