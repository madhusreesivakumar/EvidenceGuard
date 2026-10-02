'use strict';
/**
 * src/routes/index.js
 * Central API router — mounts all sub-routers under /api.
 */
const router = require('express').Router();
const { authLimiter, apiLimiter } = require('../middleware/rateLimiter');

// Apply general rate limit to all /api routes
router.use(apiLimiter);

// Mount sub-routers
router.use('/health',     require('./health'));
router.use('/auth',       authLimiter, require('./auth'));    // stricter limit on auth
router.use('/stats',      require('./stats'));
router.use('/evidence',   require('./evidence'));
router.use('/blockchain', require('./blockchain'));
router.use('/audit',      require('./audit'));
router.use('/users',      require('./users'));

module.exports = router;
