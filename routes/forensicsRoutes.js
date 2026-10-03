'use strict';

/**
 * routes/forensicsRoutes.js
 * Sprint 14A – Forensic Analysis & Safe Extraction Routes
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticate, authorizeAction } = require('../middleware/auth');
const forensicsController = require('../controllers/forensicsController');

const requireForensicsFeature = (req, res, next) => {
  if (process.env.FEATURE_FORENSICS !== 'true') {
    return res.status(404).json({
      success: false,
      code: 'FEATURE_DISABLED',
      message: 'Forensic analysis feature is disabled'
    });
  }
  next();
};

const requireForensicsRerunRole = (req, res, next) => {
  if (req.user.role !== 'ADMIN' && req.user.role !== 'INVESTIGATOR') {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Forensic rerun is restricted to ADMIN and INVESTIGATOR roles'
    });
  }
  next();
};

const forensicsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  validate: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  handler: (req, res) => res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many forensics requests, please try again later.'
  })
});

module.exports = {
  forensicsRouter: router,
  requireForensicsFeature,
  requireForensicsRerunRole,
  forensicsLimiter
};
