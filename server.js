'use strict';

// ── Step 1: validate environment before anything else ────────────────────────
const cfg = require('./config/env');

const express        = require('express');
const helmet         = require('helmet');
const cors           = require('cors');
const path           = require('path');
const mongoose       = require('mongoose');
const cookieParser   = require('cookie-parser');
const rateLimit      = require('express-rate-limit');
const noSqlSanitizer = require('./middleware/noSqlSanitizer');
const connectDB      = require('./config/db');
const { ensureGenesis } = require('./services/chainService');

const app = express();

// ── Ensure upload directories exist ──────────────────────────────────────────
const fs = require('fs');
const UPLOADS_DIR     = path.join(__dirname, 'uploads');
const UPLOADS_TMP_DIR = path.join(__dirname, 'uploads', 'tmp');
if (!fs.existsSync(UPLOADS_DIR))     fs.mkdirSync(UPLOADS_DIR,     { recursive: true });
if (!fs.existsSync(UPLOADS_TMP_DIR)) fs.mkdirSync(UPLOADS_TMP_DIR, { recursive: true });

// ── Security headers (helmet with strict CSP) ─────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'"],
      styleSrc:        ["'self'", "'unsafe-inline'"],   // inline style="" used widely; tracked as known limitation
      imgSrc:          ["'self'", 'data:', 'blob:'],
      mediaSrc:        ["'self'", 'blob:'],
      fontSrc:         ["'self'"],
      connectSrc:      ["'self'"],
      objectSrc:       ["'none'"],
      baseUri:         ["'self'"],
      formAction:      ["'self'"],
      frameAncestors:  ["'none'"]
    }
  },
  // HSTS only in production
  hsts: cfg.isProduction
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  referrerPolicy: { policy: 'no-referrer' },
  // Disable X-Powered-By
  hidePoweredBy: true
}));

// Permissions-Policy
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── Cache-Control: no-store on every /api response ────────────────────────────
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
if (cfg.clientOrigin) {
  app.use(cors({
    origin: cfg.clientOrigin,
    credentials: true
  }));
} else {
  // Same-origin: no CORS headers (browser default)
  app.use(cors({ origin: false }));
}

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const dbCheck        = require('./middleware/dbCheck');
const { errorHandler } = require('./middleware/errorHandler');

// ── Content-Type guard (415 for wrong types on JSON-expecting routes) ─────────
app.use('/api', (req, res, next) => {
  // Only enforce on routes that send a body (non-GET, non-HEAD, non-OPTIONS)
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const ct = req.headers['content-type'] || '';
    // Allow multipart (file upload) and JSON
    if (!ct.includes('application/json') && !ct.includes('multipart/form-data')) {
      // Don't block empty-body requests (content-length 0 or missing)
      const cl = parseInt(req.headers['content-length'] || '0', 10);
      if (cl > 0) {
        return res.status(415).json({
          success: false,
          code: 'INVALID_FILE_TYPE',
          message: 'Unsupported Media Type'
        });
      }
    }
  }
  next();
});

// ── Global NoSQL injection guard ──────────────────────────────────────────────
app.use(noSqlSanitizer);

// ── Global rate limiter (belt-and-suspenders) ─────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  handler: (req, res) => res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests, please try again later.'
  })
});
app.use('/api/', apiLimiter);

// ── Health endpoint ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  if (!isConnected) {
    return res.status(503).json({
      success: false,
      code: 'DB_UNAVAILABLE',
      message: 'MongoDB connection failed. Please try again shortly.',
      database: 'disconnected',
      uptime: process.uptime()
    });
  }
  res.status(200).json({
    success: true,
    message: 'EvidenceGuard API running',
    database: 'connected',
    uptime: process.uptime()
  });
});

// ── Database readiness check for DB-backed API endpoints ──────────────────────
app.use('/api', dbCheck);

// ── Static files ──────────────────────────────────────────────────────────────
// Uploads directory is NOT served publicly
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────────────────
const authRoutes       = require('./routes/authRoutes');
const evidenceRoutes   = require('./routes/evidenceRoutes');
const blockchainRoutes = require('./routes/blockchainRoutes');
const publicRoutes     = require('./routes/publicRoutes');
const dashboardRoutes  = require('./routes/dashboardRoutes');
const auditRoutes      = require('./routes/auditRoutes');
const userRoutes       = require('./routes/userRoutes');
const keyRoutes        = require('./routes/keyRoutes');
const { custodyRouter } = require('./routes/custodyRoutes');

app.use('/api/auth',       authRoutes);
app.use('/api/evidence',   evidenceRoutes);
app.use('/api/blockchain', blockchainRoutes);
app.use('/api/public',     publicRoutes);
app.use('/api/dashboard',  dashboardRoutes);
app.use('/api/audit',      auditRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/keys',       keyRoutes);
app.use('/api/custody',    custodyRouter);

// ── 404 for unknown /api routes ───────────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: 'API endpoint not found'
  });
});

// ── Central error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ── Process-level safety: exit non-zero on uncaught exceptions / rejections ───
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

// ── Sprint 13: Initialize Notification Dispatcher ───────────────────────────
const { initNotificationDispatcher } = require('./services/notificationDispatcher');
initNotificationDispatcher();

// ── Start server ──────────────────────────────────────────────────────────────
if (require.main === module) {
  connectDB()
    .then(async () => {
      try {
        await ensureGenesis();
      } catch (err) {
        console.error('FATAL: Failed to initialize Genesis Block', err);
        process.exit(1);
      }

      // Sprint 13: Notification Worker & SMTP verification
      if (process.env.FEATURE_NOTIFICATIONS === 'true') {
        const { verifySmtpConnection } = require('./services/emailService');
        const { startNotificationWorker } = require('./services/notificationWorker');
        verifySmtpConnection().catch(() => {});
        startNotificationWorker();
      }

      const server = app.listen(cfg.port, () => {
        console.log(`[Server] EvidenceGuard listening on port ${cfg.port} (${cfg.isProduction ? 'production' : 'development'})`);
      });

      process.on('SIGINT', async () => {
        console.log('\n[Server] SIGINT received. Shutting down...');
        if (process.env.FEATURE_NOTIFICATIONS === 'true') {
          const { stopNotificationWorker } = require('./services/notificationWorker');
          stopNotificationWorker();
        }
        await mongoose.connection.close();
        server.close(() => {
          console.log('[Server] Closed.');
          process.exit(0);
        });
      });
    })
    .catch((err) => {
      console.error('FATAL: Database connection failed:', err);
      process.exit(1);
    });
}

module.exports = app;