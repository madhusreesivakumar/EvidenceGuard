'use strict';
/**
 * middleware/dbCheck.js
 * Ensures that if MongoDB is down, every DB-backed /api endpoint returns
 * { success: false, code: 'DB_UNAVAILABLE', message: 'MongoDB connection failed. Please try again shortly.' }
 * with HTTP 503 without crashing or hanging.
 */

const mongoose = require('mongoose');

const dbCheck = (req, res, next) => {
  // Allow health endpoint to run its own logic
  if (req.path === '/health') {
    return next();
  }

  // 1 = connected
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      code: 'DB_UNAVAILABLE',
      message: 'MongoDB connection failed. Please try again shortly.'
    });
  }

  next();
};

module.exports = dbCheck;
