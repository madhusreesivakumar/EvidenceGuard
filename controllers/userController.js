'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const { logEvent } = require('../services/auditService');
const { scoped, unscoped } = require('../services/tenantScope');

// --- helpers ------------------------------------------------------------------

/** Escape regex special chars so user input is never used raw in $regex */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip passwordHash from a lean() result */
function stripPassword(doc) {
  if (!doc) return doc;
  const { passwordHash, ...safe } = doc;  // eslint-disable-line no-unused-vars
  return safe;
}

const SAFE_PROJECTION = { passwordHash: 0 };

const ALLOWED_ROLES = [
  'SUPER_ADMIN',
  'ORG_ADMIN',
  'ADMIN',
  'INVESTIGATOR',
  'LAB_ANALYST',
  'COURT_OFFICER',
  'AUDITOR',
  'VIEWER'
];

// --- GET /api/users -----------------------------------------------------------

exports.listUsers = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Validation failed', details: errors.array() });
  }

  try {
    const {
      q,
      role,
      status = 'active',
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip     = (pageNum - 1) * limitNum;

    const ALLOWED_SORT = ['name', 'email', 'role', 'createdAt'];
    const safeSortBy    = ALLOWED_SORT.includes(sortBy) ? sortBy : 'createdAt';
    const safeSortOrder = sortOrder === 'asc' ? 1 : -1;

    const ScopedUser = scoped(User, req.user);
    const filter = {};

    // Status filter
    if (status === 'active')        filter.isActive = true;
    else if (status === 'inactive') filter.isActive = false;

    // Role filter
    if (role !== undefined) {
      if (typeof role !== 'string') {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid role parameter' });
      }
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid role filter' });
      }
      filter.role = role;
    }

    // Text search – regex-escaped, contains match on name or email
    if (q !== undefined) {
      if (typeof q !== 'string') {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid q parameter' });
      }
      const safe = escapeRegex(q.trim());
      if (safe.length > 0) {
        filter.$or = [
          { name:  { $regex: safe, $options: 'i' } },
          { email: { $regex: safe, $options: 'i' } }
        ];
      }
    }

    const [users, total] = await Promise.all([
      ScopedUser.find(filter, SAFE_PROJECTION)
        .sort({ [safeSortBy]: safeSortOrder })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ScopedUser.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
      users
    });
  } catch (error) {
    next(error);
  }
};

// --- POST /api/users ----------------------------------------------------------

exports.createUser = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Validation failed', details: errors.array() });
  }

  const { name, email, password, role } = req.body;
  const normalizedEmail = email.toLowerCase();
  const ScopedUser = scoped(User, req.user);

  try {
    // Unique email globally
    const existing = await unscoped(User).findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ success: false, code: 'DUPLICATE_RESOURCE', message: 'Email is already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const assignedRole = role === 'ADMIN' ? 'ORG_ADMIN' : role;
    const user = new ScopedUser({ 
      name, 
      email: normalizedEmail, 
      passwordHash, 
      role: assignedRole,
      orgId: req.user.orgId || 'default'
    });
    await user.save();

    await logEvent({
      action: 'USER_CREATED',
      user: req.user,
      description: `Admin created user ${user.email} with role ${assignedRole}`,
      orgId: req.user.orgId,
      req
    });

    res.status(201).json({ success: true, message: 'User created', user: user.toJSON() });
  } catch (error) {
    next(error);
  }
};

// --- PATCH /api/users/:id/role ------------------------------------------------

exports.changeRole = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Validation failed', details: errors.array() });
  }

  const { id } = req.params;
  const { role } = req.body;
  const ScopedUser = scoped(User, req.user);

  try {
    const target = await ScopedUser.findById(id, SAFE_PROJECTION);
    if (!target) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'User not found' });
    }

    const targetIsAdmin = ['ADMIN', 'ORG_ADMIN'].includes(target.role);
    const newIsAdmin = ['ADMIN', 'ORG_ADMIN'].includes(role);

    // Race-safe per-organization guard: if demoting from admin, ensure at least one other active admin remains in this org
    if (targetIsAdmin && !newIsAdmin) {
      const activeAdminCount = await ScopedUser.countDocuments({
        _id: { $ne: target._id },
        role: { $in: ['ADMIN', 'ORG_ADMIN'] },
        isActive: true
      });
      if (activeAdminCount < 1) {
        return res.status(409).json({ success: false, code: 'FORBIDDEN', message: 'Cannot demote the last active admin' });
      }
    }

    const oldRole = target.role;
    target.role = role === 'ADMIN' ? 'ORG_ADMIN' : role;
    await target.save();

    await logEvent({
      action: 'ROLE_CHANGED',
      user: req.user,
      description: `Admin changed role of ${target.email} from ${oldRole} to ${target.role}`,
      orgId: req.user.orgId,
      req
    });

    try {
      const eventBus = require('../services/eventBus');
      eventBus.emit('ROLE_CHANGED', {
        user: target,
        oldRole,
        newRole: target.role,
        actorUser: req.user,
        orgId: req.user.orgId,
        req
      });
    } catch (busErr) {
      console.error('[EVENT_BUS ERROR]', busErr);
    }

    res.status(200).json({ success: true, message: 'Role updated', user: target.toJSON() });
  } catch (error) {
    next(error);
  }
};

// --- DELETE /api/users/:id  (soft-deactivate) ---------------------------------

exports.deactivateUser = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Validation failed', details: errors.array() });
  }

  const { id } = req.params;
  const ScopedUser = scoped(User, req.user);

  try {
    // Prevent self-deactivation
    if (String(req.user._id) === id) {
      return res.status(409).json({ success: false, code: 'FORBIDDEN', message: 'You cannot deactivate your own account' });
    }

    const target = await ScopedUser.findById(id, SAFE_PROJECTION);
    if (!target) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'User not found' });
    }

    if (!target.isActive) {
      return res.status(409).json({ success: false, code: 'VALIDATION_ERROR', message: 'User is already inactive' });
    }

    // Race-safe per-organization last-admin guard
    if (['ADMIN', 'ORG_ADMIN'].includes(target.role)) {
      const activeAdminCount = await ScopedUser.countDocuments({
        _id: { $ne: target._id },
        role: { $in: ['ADMIN', 'ORG_ADMIN'] },
        isActive: true
      });
      if (activeAdminCount < 1) {
        return res.status(409).json({ success: false, code: 'FORBIDDEN', message: 'Cannot deactivate the last active admin' });
      }
    }

    // Atomic update: only matches if still active (guards against double-click race)
    const updated = await ScopedUser.findOneAndUpdate(
      { _id: id, isActive: true },
      {
        $set: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: req.user._id
        }
      },
      { new: true, projection: SAFE_PROJECTION }
    );

    if (!updated) {
      return res.status(409).json({ success: false, code: 'VALIDATION_ERROR', message: 'User is already inactive' });
    }

    await logEvent({
      action: 'USER_DEACTIVATED',
      user: req.user,
      description: `Admin deactivated user ${updated.email}`,
      orgId: req.user.orgId,
      req
    });

    try {
      const eventBus = require('../services/eventBus');
      eventBus.emit('USER_DEACTIVATED', {
        user: updated,
        actorUser: req.user,
        orgId: req.user.orgId,
        req
      });
    } catch (busErr) {
      console.error('[EVENT_BUS ERROR]', busErr);
    }

    res.status(200).json({ success: true, message: 'User deactivated', user: updated.toJSON() });
  } catch (error) {
    next(error);
  }
};
