const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate, authorizeAction } = require('../middleware/auth');
const uploadMiddleware = require('../middleware/uploadMiddleware');
const evidenceController = require('../controllers/evidenceController');

// GET /api/evidence
router.get('/',
  authenticate,
  authorizeAction('view'),
  evidenceController.listEvidence
);

// POST /api/evidence
router.post('/',
  authenticate,
  authorizeAction('upload'),
  uploadMiddleware,
  [
    body('name').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Name must be between 2 and 120 characters'),
    body('type').isIn(['Image', 'Video', 'Audio', 'Document', 'PDF', 'Other']).withMessage('Invalid evidence type'),
    body('description').optional().isString().trim().isLength({ max: 1000 }).withMessage('Description too long'),
    body('clientHash').optional().isString().trim().isLength({ min: 64, max: 64 }).withMessage('Hash must be 64 characters long')
  ],
  evidenceController.uploadEvidence
);
const rateLimit = require('express-rate-limit');
const verificationController = require('../controllers/verificationController');

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  handler: (req, res) => res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many verification attempts, please try again later.' })
});

// GET /api/evidence/lookup (Must be before /:id)
router.get('/lookup',
  authenticate,
  authorizeAction('view'),
  verificationController.lookupEvidence
);

// POST /api/evidence/:id/verify
router.post('/:id/verify',
  authenticate,
  authorizeAction('verify'),
  verifyLimiter,
  uploadMiddleware,
  verificationController.verifyEvidence
);

// GET /api/evidence/:id/verifications
router.get('/:id/verifications',
  authenticate,
  authorizeAction('view'),
  verificationController.getVerifications
);

const qrLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  validate: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  handler: (req, res) => res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many QR generation requests, please try again later.' })
});

// GET /api/evidence/:id/qr
router.get('/:id/qr',
  authenticate,
  authorizeAction('view'),
  qrLimiter,
  evidenceController.generateQr
);

// ─── Sprint 12: Chain of Custody Sub-Routes ─────────────────────────────────
const custodyController = require('../controllers/custodyController');
const { requireCustodyFeature, requireCustodyRole, custodyLimiter } = require('./custodyRoutes');

// GET /api/evidence/:id/custody
router.get('/:id/custody',
  requireCustodyFeature,
  authenticate,
  requireCustodyRole,
  custodyLimiter,
  custodyController.getEvidenceCustody
);

// POST /api/evidence/:id/custody
router.post('/:id/custody',
  requireCustodyFeature,
  authenticate,
  requireCustodyRole,
  custodyLimiter,
  custodyController.createEvidenceCustodyEvent
);

// POST /api/evidence/:id/custody/validate
router.post('/:id/custody/validate',
  requireCustodyFeature,
  authenticate,
  requireCustodyRole,
  custodyLimiter,
  custodyController.validateEvidenceCustody
);

// ─── Sprint 14: Forensics Sub-Routes ────────────────────────────────────────
const forensicsController = require('../controllers/forensicsController');
const { requireForensicsFeature, requireForensicsRerunRole, forensicsLimiter } = require('./forensicsRoutes');

// POST /api/evidence/:id/forensics/rerun
router.post('/:id/forensics/rerun',
  requireForensicsFeature,
  authenticate,
  requireForensicsRerunRole,
  forensicsLimiter,
  forensicsController.rerunForensics
);

// GET /api/evidence/:id/forensics/history
router.get('/:id/forensics/history',
  requireForensicsFeature,
  authenticate,
  authorizeAction('view'),
  forensicsLimiter,
  forensicsController.getForensicsHistory
);

// GET /api/evidence/:id/forensics
router.get('/:id/forensics',
  requireForensicsFeature,
  authenticate,
  authorizeAction('view'),
  forensicsLimiter,
  forensicsController.getForensicsReport
);

// GET /api/evidence/:id/download
router.get('/:id/download',
  authenticate,
  authorizeAction('view'),
  evidenceController.downloadEvidence
);

// GET /api/evidence/:id (Must be after lookup and sub-paths)
router.get('/:id',
  authenticate,
  authorizeAction('view'),
  evidenceController.getEvidenceDetails
);

// DELETE /api/evidence/:id
router.delete('/:id',
  authenticate,
  authorizeAction('delete'),
  evidenceController.deleteEvidence
);

module.exports = router;

