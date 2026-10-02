const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, match: /.+@.+\..+/ },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['ADMIN', 'INVESTIGATOR', 'VIEWER'], default: 'VIEWER' },
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
