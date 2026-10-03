'use strict';

/**
 * routes/kmsRoutes.js
 * Sprint 16B: KMS / HSM Administration Routes
 *
 * All routes require authentication + ADMIN (ORG_ADMIN) or SUPER_ADMIN role.
 * Feature-gated behind FEATURE_KMS=true.
 */

const express        = require('express');
const router         = express.Router();
const rateLimit      = require('express-rate-limit');
const { authenticate, authorizeAction } = require('../middleware/auth');
const kmsController  = require('../controllers/kmsController');

// Feature flag guard
router.use((req, res, next) => {
  if (process.env.FEATURE_KMS !== 'true') {
    return res.status(403).json({
      success: false,
      code:    'FEATURE_DISABLED',
      message: 'KMS / HSM feature is not enabled (FEATURE_KMS=true required).'
    });
  }
  next();
});

// Rate limit: 30 sensitive operations per 15 minutes
const kmsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  handler: (req, res) => res.status(429).json({
    success: false,
    code:    'RATE_LIMITED',
    message: 'Too many KMS requests, please try again later.'
  })
});

router.use(authenticate);
router.use(authorizeAction('admin:kms'));
router.use(kmsLimiter);

// GET /api/kms/health — KMS provider health check
router.get('/health', kmsController.health);

// GET /api/kms/keys/:keyId/versions — list key versions
router.get('/keys/:keyId/versions', kmsController.listVersions);

// GET /api/kms/keys/:keyId/public — export public key (asymmetric keys only)
router.get('/keys/:keyId/public', kmsController.getPublicKey);

// POST /api/kms/keys/:keyId/rotate — rotate a key (generates new version)
router.post('/keys/:keyId/rotate', kmsController.rotate);

module.exports = router;
