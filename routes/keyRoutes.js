'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const keyController = require('../controllers/keyController');

// Feature Flag Middleware: Rejects all requests if FEATURE_SIGNATURES is not true
const featureFlagGuard = (req, res, next) => {
  if (process.env.FEATURE_SIGNATURES !== 'true') {
    return res.status(403).json({
      success: false,
      code: 'FEATURE_DISABLED',
      message: 'Digital signatures feature is not enabled.'
    });
  }
  next();
};

const keyActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  handler: (req, res) => res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many key management requests, please try again later.'
  })
});

router.use(featureFlagGuard);
router.use(authenticate);
router.use(keyActionLimiter);

// GET /api/keys/challenge - Single-use nonce for proof of possession
router.get('/challenge', keyController.getChallenge);

// POST /api/keys - Register new public key with challenge signature
router.post('/', keyController.registerKey);

// GET /api/keys - List authenticated user's own keys
router.get('/', keyController.listOwnKeys);

// GET /api/keys/:keyId/public - Retrieve public key data (any authenticated user)
router.get('/:keyId/public', keyController.getPublicKey);

// POST /api/keys/:keyId/revoke - Revoke a key (owner or ADMIN)
router.post('/:keyId/revoke', keyController.revokeKey);

module.exports = router;
