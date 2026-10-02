'use strict';

const express = require('express');
const { param, query, body } = require('express-validator');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { authenticate, authorizeAction } = require('../middleware/auth');
const userController = require('../controllers/userController');

const router = express.Router();

const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  handler: (req, res) => res.status(429).json({ success: false, message: 'Too many requests' })
});

/** Validates that :id is a MongoDB ObjectId */
const validateObjectId = [
  param('id')
    .custom(v => mongoose.Types.ObjectId.isValid(v))
    .withMessage('Invalid user ID')
];

// All user-management routes require authentication + manageUsers permission
router.use(authenticate, authorizeAction('manageUsers'), userLimiter);

// GET /api/users
router.get('/', [
  query('q')
    .optional()
    .custom(v => typeof v === 'string').withMessage('q must be a string')
    .isLength({ max: 100 }).withMessage('q must be at most 100 characters'),
  query('role')
    .optional()
    .isIn(['ADMIN', 'INVESTIGATOR', 'VIEWER']).withMessage('role must be ADMIN, INVESTIGATOR or VIEWER'),
  query('status')
    .optional()
    .isIn(['active', 'inactive', 'all']).withMessage('status must be active, inactive or all'),
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  query('sortBy')
    .optional()
    .isIn(['name', 'email', 'role', 'createdAt']).withMessage('sortBy must be name, email, role or createdAt'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc']).withMessage('sortOrder must be asc or desc')
], userController.listUsers);

// POST /api/users
router.post('/', [
  body('name')
    .isString().withMessage('name must be a string')
    .trim()
    .isLength({ min: 2, max: 60 }).withMessage('name must be between 2 and 60 characters'),
  body('email')
    .isEmail().withMessage('Valid email required')
    .normalizeEmail(),
  body('password')
    .isString().withMessage('password must be a string')
    .isLength({ min: 8 }).withMessage('password must be at least 8 characters')
    .matches(/[a-zA-Z]/).withMessage('password must contain at least one letter')
    .matches(/[0-9]/).withMessage('password must contain at least one number'),
  body('role')
    .isIn(['ADMIN', 'INVESTIGATOR', 'VIEWER']).withMessage('role must be ADMIN, INVESTIGATOR or VIEWER')
], userController.createUser);

// PATCH /api/users/:id/role
router.patch('/:id/role', [
  ...validateObjectId,
  body('role')
    .isIn(['ADMIN', 'INVESTIGATOR', 'VIEWER']).withMessage('role must be ADMIN, INVESTIGATOR or VIEWER')
], userController.changeRole);

// DELETE /api/users/:id  (soft-deactivate)
router.delete('/:id', validateObjectId, userController.deactivateUser);

module.exports = router;
