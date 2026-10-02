const express = require('express');
const router = express.Router();
const { authenticate, authorizeAction } = require('../middleware/auth');
const dashboardController = require('../controllers/dashboardController');

// GET /api/dashboard/stats (authenticate + authorizeAction("view"))
router.get('/stats',
  authenticate,
  authorizeAction('view'),
  dashboardController.getDashboardStats
);

module.exports = router;
