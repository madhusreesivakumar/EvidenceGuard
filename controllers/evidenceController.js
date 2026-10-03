const { validationResult } = require('express-validator');
const fs = require('fs');
const Evidence = require('../models/Evidence');
const hashService = require('../services/hashService');
const idService = require('../services/idService');
const storageService = require('../storage/storageService');
const { logEvent } = require('../services/auditService');
const { appendBlock } = require('../services/chainService');
const mongoose = require('mongoose');
const QRCode = require('qrcode');

const uploadEvidence = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Validation failed', details: errors.array() });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, code: 'NO_FILE', message: 'No file uploaded' });
  }

  const tempPath = req.file.path;
  let serverHash;

  try {
    serverHash = await hashService.sha256Stream(tempPath);
  } catch (err) {
    fs.unlink(tempPath, () => {});
    return res.status(500).json({ success: false, code: 'HASH_FAILURE', message: 'Could not compute the file hash.' });
  }

  const { clientHash, name, type, description, isDemo } = req.body;

  if (clientHash && clientHash.toLowerCase() !== serverHash) {
    fs.unlink(tempPath, () => {});
    return res.status(422).json({
      success: false,
      code: 'HASH_MISMATCH_UPLOAD',
      message: 'Hash mismatch: the file changed or was corrupted during upload',
      serverHash,
      clientHash: clientHash.toLowerCase()
    });
  }

  // Duplicate Check
  const existing = await Evidence.findOne({ hash: serverHash, isDeleted: false });
  if (existing) {
    fs.unlink(tempPath, () => {});
    await logEvent({
      action: 'UPLOAD',
      user: req.user,
      evidenceId: existing.evidenceId,
      caseId: existing.caseId,
      description: `Duplicate upload rejected (matches ${existing.evidenceId})`,
      req
    });
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_EVIDENCE',
      message: 'DUPLICATE EVIDENCE DETECTED',
      existing: {
        evidenceId: existing.evidenceId,
        caseId: existing.caseId,
        registeredAt: existing.createdAt
      }
    });
  }

  let evidenceId, caseId;
  try {
    evidenceId = await idService.nextEvidenceId();
    caseId = await idService.nextCaseId();
  } catch (err) {
    fs.unlink(tempPath, () => {});
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Failed to generate IDs' });
  }

  const randomSuffix = Math.round(Math.random() * 1E9).toString(16);
  const storageKey = `${evidenceId}-${randomSuffix}`;
  let storageResult;

  try {
    storageResult = await storageService.save(tempPath, storageKey);
  } catch (err) {
    fs.unlink(tempPath, () => {});
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Failed to save file to storage' });
  }

  const safeFileName = storageService.sanitizeFilename(req.file.originalname);

  const evidenceData = {
    evidenceId,
    caseId,
    name,
    type,
    description,
    fileName: safeFileName,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    hash: serverHash,
    storageKey,
    status: 'Pending',
    uploadedBy: req.user._id,
    blockNumber: null,
    isDemo: isDemo === true || isDemo === 'true' || false
  };

  let evidenceDoc;
  let blockDoc;

  try {
    if (global.TRANSACTIONS_SUPPORTED) {
      const session = await mongoose.startSession();
      await session.withTransaction(async () => {
        evidenceDoc = new Evidence(evidenceData);
        blockDoc = await appendBlock({ evidence: evidenceDoc, session });
        evidenceDoc.blockNumber = blockDoc.blockNumber;
        await evidenceDoc.save({ session });
      });
      session.endSession();
    } else {
      // Compensating Rollback Fallback
      evidenceDoc = new Evidence(evidenceData);
      
      // Try block first or evidence first? 
      // Insert evidence first so we can rollback evidence if block fails.
      await evidenceDoc.save();

      try {
        blockDoc = await appendBlock({ evidence: evidenceDoc, session: null });
        evidenceDoc.blockNumber = blockDoc.blockNumber;
        await evidenceDoc.save();
      } catch (blockErr) {
        // Rollback evidence and storage
        await Evidence.deleteOne({ _id: evidenceDoc._id });
        throw blockErr; // Handled in outer catch
      }
    }

    await logEvent({
      action: 'HASH_GENERATED',
      user: req.user,
      evidenceId,
      caseId,
      description: `Hash generated for evidence ${safeFileName}: ${serverHash}`,
      req
    });

    await logEvent({
      action: 'UPLOAD',
      user: req.user,
      evidenceId,
      caseId,
      description: `Uploaded evidence ${evidenceId}`,
      req
    });

    await logEvent({
      action: 'BLOCK_CREATED',
      user: req.user,
      evidenceId,
      caseId,
      description: `Block #${blockDoc.blockNumber} created for ${evidenceId}`,
      req
    });

    // Strip storageKey manually for return
    const evidenceObj = evidenceDoc.toObject();
    delete evidenceObj.storageKey;
    
    // Response from POST /api/evidence now includes blockNumber and the block's currentHash
    evidenceObj.blockNumber = blockDoc.blockNumber;
    evidenceObj.blockHash = blockDoc.currentHash;

    // Sprint 12: Chain of Custody initial COLLECTED event
    if (process.env.FEATURE_CUSTODY === 'true') {
      try {
        const { recordCustodyEvent } = require('../services/custodyService');
        await recordCustodyEvent({
          evidenceId,
          type: 'COLLECTED',
          user: req.user,
          reason: 'Initial digital evidence collection and intake registration',
          location: 'Digital Intake',
          auto: true,
          req
        });
      } catch (custodyErr) {
        console.error('[CUSTODY AUTO-COLLECT ERROR]', custodyErr.message);
      }
    }

    // Sprint 14: Forensic analysis auto-extraction (background, non-blocking)
    if (process.env.FEATURE_FORENSICS === 'true') {
      const filePath = storageService.getFilePath(storageKey);
      const { processForensicsForEvidence } = require('../services/forensics/forensicsService');
      setImmediate(async () => {
        try {
          await processForensicsForEvidence(evidenceDoc, filePath, {
            isRerun: false,
            actorUser: req.user,
            req
          });
        } catch (forensicsErr) {
          console.error('[FORENSICS AUTO-EXTRACT ERROR]', forensicsErr.message);
        }
      });
    }

    return res.status(201).json({ success: true, message: 'Evidence uploaded successfully', evidence: evidenceObj });
  } catch (err) {
    await storageService.remove(storageKey);
    
    if (err.status === 503) {
      return res.status(503).json({ success: false, code: 'LEDGER_BUSY', message: err.message });
    }

    // Catch Race Condition
    if (err.code === 11000 && err.keyPattern && err.keyPattern.hash) {
      const existing = await Evidence.findOne({ hash: serverHash, isDeleted: false });
      if (existing) {
        await logEvent({
          action: 'UPLOAD',
          user: req.user,
          evidenceId: existing.evidenceId,
          caseId: existing.caseId,
          description: `Duplicate upload rejected (matches ${existing.evidenceId})`,
          req
        });
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_EVIDENCE',
          message: 'DUPLICATE EVIDENCE DETECTED',
          existing: {
            evidenceId: existing.evidenceId,
            caseId: existing.caseId,
            registeredAt: existing.createdAt
          }
        });
      }
    }
    
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Database error while saving evidence record' });
  }
};

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const listEvidence = async (req, res, next) => {
  try {
    const { q, type, status, dateFrom, dateTo, sortBy, sortOrder, page, limit } = req.query;
    
    let query = { isDeleted: false };
    
    if (q) {
      if (typeof q !== 'string') return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid query parameter q' });
      const qTrimmed = q.trim();
      if (qTrimmed.length > 100) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Query too long' });
      
      const safeQ = escapeRegex(qTrimmed);
      query.$or = [
        { evidenceId: { $regex: `^${safeQ}`, $options: 'i' } },
        { caseId: { $regex: `^${safeQ}`, $options: 'i' } },
        { hash: { $regex: `^${safeQ}`, $options: 'i' } },
        { name: { $regex: safeQ, $options: 'i' } },
        { fileName: { $regex: safeQ, $options: 'i' } }
      ];
    }
    
    if (type) {
      if (typeof type !== 'string') return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid type parameter' });
      query.type = type;
    }
    
    if (status) {
      if (typeof status !== 'string' || !['Pending', 'Verified', 'Tampered'].includes(status)) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid status parameter' });
      }
      query.status = status;
    }
    
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) {
        if (typeof dateFrom !== 'string' || isNaN(Date.parse(dateFrom))) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid dateFrom' });
        query.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        if (typeof dateTo !== 'string' || isNaN(Date.parse(dateTo))) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid dateTo' });
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = toDate;
      }
      if (query.createdAt.$gte && query.createdAt.$lte && query.createdAt.$gte > query.createdAt.$lte) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'dateFrom cannot be after dateTo' });
      }
    }
    
    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const skip = (pageNum - 1) * limitNum;
    
    const allowedSorts = ['createdAt', 'evidenceId', 'name', 'type', 'status'];
    const sortField = allowedSorts.includes(sortBy) ? sortBy : 'createdAt';
    const sortDir = sortOrder === 'asc' ? 1 : -1;
    
    const [items, total] = await Promise.all([
      Evidence.find(query)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limitNum)
        .populate('uploadedBy', 'name -_id')
        .select('-storageKey')
        .lean(),
      Evidence.countDocuments(query)
    ]);
    
    const formattedItems = items.map(item => {
      const uploadedByName = item.uploadedBy ? item.uploadedBy.name : null;
      delete item.uploadedBy;
      return {
        ...item,
        uploadedByName
      };
    });
    
    res.json({
      success: true,
      items: formattedItems,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (err) {
    next(err);
  }
};

const getEvidenceDetails = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    if (!identifier || typeof identifier !== 'string') {
      return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'Invalid identifier format' });
    }
    
    const isEvId = /^EV-\d{4}$/.test(identifier);
    const isCaseId = /^EG-\d{4}-\d{4}$/.test(identifier);
    
    if (!isEvId && !isCaseId) {
      return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'Invalid identifier format. Must be EV-0000 or EG-0000-0000' });
    }
    
    const query = { isDeleted: false };
    if (isEvId) query.evidenceId = identifier;
    else query.caseId = identifier;
    
    const evidence = await Evidence.findOne(query)
      .populate('uploadedBy', 'name -_id')
      .select('-storageKey')
      .lean();
      
    if (!evidence) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Evidence not found' });
    }
    
    evidence.uploadedByName = evidence.uploadedBy ? evidence.uploadedBy.name : null;
    delete evidence.uploadedBy;
    
    if (evidence.blockNumber != null) {
      const Block = require('../models/Block');
      const block = await Block.findOne({ blockNumber: evidence.blockNumber }).lean();
      if (block) {
        evidence.block = {
          blockNumber: block.blockNumber,
          previousHash: block.previousHash,
          currentHash: block.currentHash,
          timestamp: block.timestamp
        };
      }
    }
    
    const Verification = require('../models/Verification');
    const [totalVerifications, lastVerification] = await Promise.all([
      Verification.countDocuments({ evidenceId: evidence.evidenceId }),
      Verification.findOne({ evidenceId: evidence.evidenceId }).sort({ verifiedAt: -1 }).lean()
    ]);
    
    evidence.verificationSummary = {
      totalVerifications,
      lastResult: lastVerification ? lastVerification.result : null,
      lastVerifiedAt: lastVerification ? lastVerification.verifiedAt : null
    };
    
    res.json({ success: true, data: evidence });
  } catch (err) {
    next(err);
  }
};

const deleteEvidence = async (req, res, next) => {
  try {
    const evidenceId = req.params.id;
    if (!evidenceId || typeof evidenceId !== 'string' || !/^EV-\d{4}$/.test(evidenceId)) {
      return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'Invalid evidence ID format. Must be EV-0000' });
    }

    const { reason } = req.body;
    if (!reason || typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 300) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Reason is required (5 to 300 characters)' });
    }

    const trimmedReason = reason.trim();

    // Atomic update matching isDeleted false
    const evidence = await Evidence.findOneAndUpdate(
      { evidenceId, isDeleted: false },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: req.user._id,
          deletedByName: req.user.name,
          deletedReason: trimmedReason
        }
      },
      { returnDocument: 'after' }
    ).select('+storageKey');

    if (!evidence) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Evidence not found or already deleted' });
    }

    // Remove the stored file through storageService.remove
    if (evidence.storageKey) {
      try {
        await storageService.remove(evidence.storageKey);
      } catch (err) {
        console.warn(`[STORAGE WARNING] Failed to remove stored file for ${evidenceId}:`, err.message);
        await Evidence.updateOne({ _id: evidence._id }, { $set: { storageRemoved: false } });
      }
    }

    // Audit DELETE with evidenceId, caseId, and the reason in the description
    await logEvent({
      action: 'DELETE',
      user: req.user,
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      description: `Evidence deleted: ${trimmedReason}`,
      req
    });

    return res.json({
      success: true,
      message: 'Evidence deleted successfully',
      evidenceId: evidence.evidenceId
    });
  } catch (err) {
    next(err);
  }
};

const generateQr = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    const { resolveEvidence } = require('../services/verificationService');
    const evidence = await resolveEvidence(identifier);

    const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const targetUrl = `${publicBaseUrl}/verify.html?caseId=${encodeURIComponent(evidence.caseId)}`;

    const [pngDataUrl, svg] = await Promise.all([
      QRCode.toDataURL(targetUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320
      }),
      QRCode.toString(targetUrl, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320
      })
    ]);

    await logEvent({
      action: 'QR_GENERATED',
      user: req.user,
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      description: `Generated QR code for ${evidence.evidenceId} (Case ${evidence.caseId})`,
      req
    });

    return res.json({
      success: true,
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      url: targetUrl,
      pngDataUrl,
      svg
    });
  } catch (err) {
    next(err);
  }
};

const downloadEvidence = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    const isEvId = /^EV-\d{4}$/.test(identifier);
    const isCaseId = /^EG-\d{4}-\d{4}$/.test(identifier);

    let query = { isDeleted: false };
    if (isEvId) {
      query.evidenceId = identifier;
    } else if (isCaseId) {
      query.caseId = identifier;
    } else if (/^[0-9a-fA-F]{24}$/.test(identifier)) {
      query._id = identifier;
    } else {
      return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'Invalid evidence identifier' });
    }

    const evidence = await Evidence.findOne(query).select('+storageKey');
    if (!evidence) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Evidence not found' });
    }

    if (!evidence.storageKey) {
      return res.status(404).json({ success: false, code: 'FILE_NOT_FOUND', message: 'Evidence file storage key not found' });
    }

    // Sprint 12: Chain of Custody automatic ACCESSED event
    if (process.env.FEATURE_CUSTODY === 'true') {
      try {
        const { recordCustodyEvent } = require('../services/custodyService');
        await recordCustodyEvent({
          evidenceId: evidence.evidenceId,
          type: 'ACCESSED',
          user: req.user,
          reason: 'Evidence file downloaded',
          location: 'Evidence Storage',
          auto: true,
          req
        });
      } catch (custodyErr) {
        console.warn('[CUSTODY AUTO-DOWNLOAD WARNING]', custodyErr.message);
      }
    }

    const stream = storageService.getStream(evidence.storageKey);
    res.setHeader('Content-Type', evidence.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(evidence.fileName || 'evidence')}"`);
    if (evidence.fileSize) {
      res.setHeader('Content-Length', evidence.fileSize);
    }
    return stream.pipe(res);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  uploadEvidence,
  listEvidence,
  getEvidenceDetails,
  deleteEvidence,
  generateQr,
  downloadEvidence
};


