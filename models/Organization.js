'use strict';

/**
 * models/Organization.js
 * Sprint 15A – Multi-Organization Tenant Model
 */

const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  orgId: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9_-]+$/
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  type: {
    type: String,
    enum: ['INVESTIGATION_AGENCY', 'LABORATORY', 'COURT', 'OTHER'],
    default: 'INVESTIGATION_AGENCY',
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    default: 'active',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

module.exports = mongoose.model('Organization', organizationSchema);
