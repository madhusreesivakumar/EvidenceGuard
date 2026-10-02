'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, authorizeAction } = require('../middleware/auth');
const auditController = require('../controllers/auditController');

// GET /api/audit/filters (Must be registered before parameterized routes)
router.get('/filters',
  authenticate,
  authorizeAction('viewAudit'),
  auditController.getAuditFilters
);

// POST /api/audit/validate (ADMIN only)
router.post('/validate',
  authenticate,
  authorizeAction('validateAudit'),
  auditController.validateAuditChain
);

// GET /api/audit
router.get('/',
  authenticate,
  authorizeAction('viewAudit'),
  auditController.getAuditLogs
);

module.exports = router;
