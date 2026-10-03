'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const custodyController = require('../controllers/custodyController');

const requireCustodyFeature = (req, res, next) => {
  if (process.env.FEATURE_CUSTODY !== 'true') {
    return res.status(404).json({
      success: false,
      code: 'FEATURE_DISABLED',
      message: 'Chain of custody feature is disabled'
    });
  }
  next();
};

const requireCustodyRole = (req, res, next) => {
  if (req.user.role !== 'ADMIN' && req.user.role !== 'INVESTIGATOR') {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Custody access is restricted to ADMIN and INVESTIGATOR roles'
    });
  }
  next();
};

const custodyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  validate: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  handler: (req, res) => res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many custody requests, please try again later.'
  })
});

// GET /api/custody/mine
router.get(
  '/mine',
  requireCustodyFeature,
  authenticate,
  requireCustodyRole,
  custodyLimiter,
  custodyController.getMyCustody
);

// GET /api/custody/officers
router.get(
  '/officers',
  requireCustodyFeature,
  authenticate,
  requireCustodyRole,
  custodyLimiter,
  custodyController.getCustodyOfficers
);

// POST /api/custody/:custodyId/accept
router.post(
  '/:custodyId/accept',
  requireCustodyFeature,
  authenticate,
  requireCustodyRole,
  custodyLimiter,
  custodyController.acceptTransfer
);

// POST /api/custody/:custodyId/reject
router.post(
  '/:custodyId/reject',
  requireCustodyFeature,
  authenticate,
  requireCustodyRole,
  custodyLimiter,
  custodyController.rejectTransfer
);

// POST /api/custody/:custodyId/cancel
router.post(
  '/:custodyId/cancel',
  requireCustodyFeature,
  authenticate,
  requireCustodyRole,
  custodyLimiter,
  custodyController.cancelTransfer
);

module.exports = {
  custodyRouter: router,
  requireCustodyFeature,
  requireCustodyRole,
  custodyLimiter
};
