'use strict';
/**
 * src/routes/audit.js
 * GET /api/audit  (admin or investigator only)
 */
const router   = require('express').Router();
const AuditLog = require('../models/AuditLog');
const { auth, authorize } = require('../middleware/auth');

router.get('/', auth, authorize('admin','investigator'), async (req, res, next) => {
  try {
    const { page = 1, limit = 20, action, userId, from, to } = req.query;
    const q = {};

    if (action) q.action  = { $regex: action, $options: 'i' };
    if (userId) q.userId  = userId;
    if (from || to) {
      q.timestamp = {};
      if (from) q.timestamp.$gte = new Date(from);
      if (to)   q.timestamp.$lte = new Date(to);
    }

    const lim   = Math.min(parseInt(limit, 10) || 20, 100);
    const skip  = (Math.max(parseInt(page,  10), 1) - 1) * lim;
    const total = await AuditLog.countDocuments(q);
    const pages = Math.ceil(total / lim) || 1;
    const logs  = await AuditLog.find(q).sort({ timestamp: -1 }).skip(skip).limit(lim).lean();

    res.json({ success: true, message: 'OK', data: { logs, total, page: +page, pages } });
  } catch (err) { next(err); }
});

module.exports = router;
