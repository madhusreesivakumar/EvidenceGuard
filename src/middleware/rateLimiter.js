'use strict';
/**
 * src/middleware/rateLimiter.js
 * express-rate-limit configurations per endpoint type.
 */
const rateLimit = require('express-rate-limit');

/** Strict limiter for auth endpoints (login, register). */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' }
});

/** General API limiter for all other /api/* routes. */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' }
});

module.exports = { authLimiter, apiLimiter };
