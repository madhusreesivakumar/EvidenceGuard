'use strict';

const mongoose = require('mongoose');

const KeyChallengeSchema = new mongoose.Schema({
  challengeText: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // MongoDB TTL index automatically cleans up expired records
  },
  used: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  collection: 'keychallenges'
});

module.exports = mongoose.model('KeyChallenge', KeyChallengeSchema);
