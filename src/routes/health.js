'use strict';
/**
 * src/routes/health.js
 * GET /api/health — liveness probe, returns DB connection state.
 */
const router   = require('express').Router();
const mongoose = require('mongoose');

const STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

router.get('/', (_req, res) => {
  const state = STATES[mongoose.connection.readyState] || 'unknown';
  const ok    = mongoose.connection.readyState === 1;
  res.status(ok ? 200 : 503).json({
    success: ok,
    message: ok ? 'EvidenceGuard API is healthy.' : 'Database is not connected.',
    data: {
      status:    ok ? 'healthy' : 'degraded',
      db:        state,
      timestamp: new Date().toISOString(),
      uptime:    `${Math.floor(process.uptime())}s`
    }
  });
});

module.exports = router;
