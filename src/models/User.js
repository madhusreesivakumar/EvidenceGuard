'use strict';
/**
 * src/models/User.js
 */
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['admin', 'investigator', 'viewer'], default: 'viewer' },
  createdAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
