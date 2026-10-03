'use strict';

const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const SystemStatus = require('../models/SystemStatus');
const { computeAuditHash, validateAuditChain: runAuditValidation } = require('../services/auditHash');
const { logEvent } = require('../services/auditService');

const ALLOWED_ACTIONS = [
  'REGISTER', 'LOGIN', 'LOGOUT', 'UPLOAD', 'HASH_GENERATED',
  'VERIFY', 'TAMPER_DETECTED', 'DELETE', 'BLOCK_CREATED',
  'BLOCKCHAIN_VALIDATED', 'USER_CREATED', 'ROLE_CHANGED', 'QR_GENERATED',
  'USER_DEACTIVATED', 'KEY_REGISTERED', 'KEY_REVOKED',
  'CUSTODY_EVENT', 'CUSTODY_TRANSFER'
];

const ALLOWED_SORT_FIELDS = ['timestamp', 'action', 'userName', 'evidenceId', 'seq'];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GET /api/audit
 * Authenticated + authorizeAction("viewAudit")
 */
const getAuditLogs = async (req, res, next) => {
  try {
    const {
      q,
      action,
      user,
      evidenceId,
      caseId,
      dateFrom,
      dateTo,
      sortBy = 'timestamp',
      sortOrder = 'desc',
      page = 1,
      limit = 25
    } = req.query;

    const filter = {};

    // 1. Text Search Query 'q'
    if (q !== undefined) {
      if (typeof q !== 'string') {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid search parameter q' });
      }
      const trimmedQ = q.trim();
      if (trimmedQ.length > 100) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Search parameter q cannot exceed 100 characters' });
      }
      if (trimmedQ.length > 0) {
        const escaped = escapeRegex(trimmedQ);
        filter.$or = [
          { description: { $regex: escaped, $options: 'i' } },
          { userName: { $regex: escaped, $options: 'i' } },
          { evidenceId: { $regex: '^' + escaped, $options: 'i' } },
          { caseId: { $regex: '^' + escaped, $options: 'i' } }
        ];
      }
    }

    // 2. Action filter
    if (action !== undefined) {
      if (typeof action !== 'string' || !ALLOWED_ACTIONS.includes(action)) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid action filter' });
      }
      filter.action = action;
    }

    // 3. User filter (ObjectId or exact userName)
    if (user !== undefined) {
      if (typeof user !== 'string') {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid user parameter' });
      }
      const trimmedUser = user.trim();
      if (trimmedUser.length > 0) {
        if (mongoose.Types.ObjectId.isValid(trimmedUser) && trimmedUser.length === 24) {
          filter.$or = filter.$or ? [
            ...filter.$or,
            { userId: trimmedUser },
            { userName: trimmedUser }
          ] : [
            { userId: trimmedUser },
            { userName: trimmedUser }
          ];
        } else {
          filter.userName = trimmedUser;
        }
      }
    }

    // 4. Evidence ID filter
    if (evidenceId !== undefined) {
      if (typeof evidenceId !== 'string' || !/^EV-\d{4,}$/i.test(evidenceId.trim())) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid evidenceId format (expected EV-0000)' });
      }
      filter.evidenceId = new RegExp('^' + escapeRegex(evidenceId.trim()) + '$', 'i');
    }

    // 5. Case ID filter
    if (caseId !== undefined) {
      if (typeof caseId !== 'string' || !/^EG-\d{4}-\d{4,}$/i.test(caseId.trim())) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid caseId format (expected EG-YYYY-0000)' });
      }
      filter.caseId = new RegExp('^' + escapeRegex(caseId.trim()) + '$', 'i');
    }

    // 6. Date range filter
    if (dateFrom !== undefined || dateTo !== undefined) {
      const dateFilter = {};
      if (dateFrom !== undefined) {
        if (typeof dateFrom !== 'string' || isNaN(Date.parse(dateFrom))) {
          return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid dateFrom format' });
        }
        dateFilter.$gte = new Date(dateFrom);
      }
      if (dateTo !== undefined) {
        if (typeof dateTo !== 'string' || isNaN(Date.parse(dateTo))) {
          return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid dateTo format' });
        }
        const toDate = new Date(dateTo);
        toDate.setUTCHours(23, 59, 59, 999);
        dateFilter.$lte = toDate;
      }
      if (dateFilter.$gte && dateFilter.$lte && dateFilter.$gte > dateFilter.$lte) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'dateFrom cannot be after dateTo' });
      }
      filter.timestamp = dateFilter;
    }

    // 7. Pagination and sorting
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const sortField = ALLOWED_SORT_FIELDS.includes(sortBy) ? sortBy : 'timestamp';
    const sortDirection = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
    const skip = (pageNum - 1) * limitNum;

    const [total, docs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter)
        .sort({ [sortField]: sortDirection, _id: sortDirection })
        .skip(skip)
        .limit(limitNum)
        .lean()
    ]);

    const isAdmin = req.user && req.user.role === 'ADMIN';

    const items = docs.map(doc => ({
      eventId: doc.eventId,
      seq: doc.seq !== undefined ? doc.seq : null,
      userName: doc.userName || 'System',
      role: doc.role || 'SYSTEM',
      action: doc.action,
      evidenceId: doc.evidenceId || null,
      caseId: doc.caseId || null,
      description: doc.description || null,
      timestamp: doc.timestamp,
      ipAddress: isAdmin ? (doc.ipAddress || null) : null
    }));

    return res.json({
      success: true,
      items,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1
    });
  } catch (err) {
    console.error('[AUDIT GET ERROR]', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Failed to fetch audit records' });
  }
};

/**
 * GET /api/audit/filters
 * Authenticated + authorizeAction("viewAudit")
 */
const getAuditFilters = async (req, res, next) => {
  try {
    const rawUsers = await AuditLog.distinct('userName', { userName: { $ne: null, $nin: ['', 'System'] } });
    const users = rawUsers
      .filter(Boolean)
      .map(u => String(u).trim())
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 200);

    return res.json({
      success: true,
      actions: ALLOWED_ACTIONS,
      users
    });
  } catch (err) {
    console.error('[AUDIT FILTERS ERROR]', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Failed to fetch audit filters' });
  }
};

/**
 * POST /api/audit/validate
 * Authenticated + authorizeAction("validateAudit") (ADMIN only)
 */
const validateAuditChain = async (req, res, next) => {
  try {
    const result = await runAuditValidation();
    const { valid, entriesChecked, message, firstBrokenSeq, validatedAt, head, issues } = result;

    // Upsert into SystemStatus singleton
    await SystemStatus.findOneAndUpdate(
      { key: 'auditValidation' },
      {
        $set: {
          value: {
            valid,
            entriesChecked,
            message,
            firstBrokenSeq,
            validatedAt,
            validatedByName: req.user.name || 'Admin'
          },
          updatedAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    // Audit the validation itself
    await logEvent({
      user: req.user,
      action: 'BLOCKCHAIN_VALIDATED',
      description: `Audit chain validated: ${valid ? 'VALID' : 'INVALID'} (${entriesChecked} entries)`,
      req
    });

    return res.json({
      success: true,
      valid,
      entriesChecked,
      message,
      firstBrokenSeq,
      issues,
      head,
      validatedAt
    });
  } catch (err) {
    console.error('[AUDIT VALIDATE ERROR]', err);
    return res.status(500).json({ success: false, code: 'CHAIN_VALIDATION_FAILED', message: 'Failed to validate audit chain' });
  }
};

module.exports = {
  getAuditLogs,
  getAuditFilters,
  validateAuditChain
};
