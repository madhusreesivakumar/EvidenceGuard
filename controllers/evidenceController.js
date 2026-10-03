const { validationResult } = require('express-validator');
const fs = require('fs');
const crypto = require('crypto');
const Evidence = require('../models/Evidence');
const hashService = require('../services/hashService');
const idService = require('../services/idService');
const storageService = require('../storage/storageService');
const { logEvent } = require('../services/auditService');
const { appendBlock } = require('../services/chainService');
const { scoped } = require('../services/tenantScope');
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

  const orgId = req.user?.orgId || 'default';
  const ScopedEvidence = scoped(Evidence, req.user);

  // Duplicate Check per organization
  const existing = await ScopedEvidence.findOne({ hash: serverHash, isDeleted: false });
  if (existing) {
    fs.unlink(tempPath, () => {});
    await logEvent({
      action: 'UPLOAD',
      user: req.user,
      evidenceId: existing.evidenceId,
      caseId: existing.caseId,
      description: `Duplicate upload rejected (matches ${existing.evidenceId})`,
      orgId,
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
    evidenceId = await idService.nextEvidenceId(orgId);
    caseId = await idService.nextCaseId(orgId);
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
  const publicToken = crypto.randomBytes(16).toString('base64url');

  const evidenceData = {
    evidenceId,
    orgId,
    caseId,
    name,
    type,
    description,
    fileName: safeFileName,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    publicToken,
    legacyPublic: false,
    hash: serverHash,
    storageKey,
    storage: {
      driver: storageResult.driver || 'local',
      key: storageKey,
      encryption: storageResult.encryption || null,
      cipherSize: storageResult.cipherSize || req.file.size,
      cipherSha256: storageResult.cipherSha256 || null
    },
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
        evidenceDoc = new ScopedEvidence(evidenceData);
        blockDoc = await appendBlock({ evidence: evidenceDoc, orgId, session });
        evidenceDoc.blockNumber = blockDoc.blockNumber;
        await evidenceDoc.save({ session });
      });
      session.endSession();
    } else {
      // Compensating Rollback Fallback
      evidenceDoc = new ScopedEvidence(evidenceData);
      await evidenceDoc.save();

      try {
        blockDoc = await appendBlock({ evidence: evidenceDoc, orgId, session: null });
        evidenceDoc.blockNumber = blockDoc.blockNumber;
        await evidenceDoc.save();
      } catch (blockErr) {
        // Rollback evidence and storage
        await ScopedEvidence.deleteOne({ _id: evidenceDoc._id });
        await storageService.remove(storageKey);
        throw blockErr;
      }
    }

    // Success Audit Events
    await logEvent({
      action: 'HASH_GENERATED',
      user: req.user,
      evidenceId,
      caseId,
      description: `Hash generated for evidence ${safeFileName}: ${serverHash}`,
      orgId,
      req
    });

    await logEvent({
      action: 'UPLOAD',
      user: req.user,
      evidenceId,
      caseId,
      description: `Uploaded evidence ${evidenceId}`,
      orgId,
      req
    });

    await logEvent({
      action: 'BLOCK_CREATED',
      user: req.user,
      evidenceId,
      caseId,
      description: `Block #${blockDoc.blockNumber} created for ${evidenceId}`,
      orgId,
      req
    });

    const evidenceObj = evidenceDoc.toObject();
    delete evidenceObj.storageKey;

    evidenceObj.blockNumber = blockDoc.blockNumber;
    evidenceObj.blockHash = blockDoc.currentHash;

    // Sprint 12: Chain of Custody automatic COLLECTED intake event
    if (process.env.FEATURE_CUSTODY === 'true') {
      try {
        const { recordCustodyEvent } = require('../services/custodyService');
        await recordCustodyEvent({
          evidenceId,
          type: 'COLLECTED',
          user: req.user,
          reason: 'Initial digital evidence collection and intake registration',
          location: 'Evidence Intake Facility',
          auto: true,
          req
        });
      } catch (custodyErr) {
        console.warn('[CUSTODY AUTO-INTAKE WARNING]', custodyErr.message);
      }
    }

    // Sprint 14A: Asynchronous Forensic Metadata Extraction
    if (process.env.FEATURE_FORENSICS === 'true') {
      const { processForensicsForEvidence } = require('../services/forensics/forensicsService');
      const filePath = storageService.getFilePath ? storageService.getFilePath(storageKey) : tempPath;
      setTimeout(async () => {
        try {
          await processForensicsForEvidence(evidenceDoc, filePath, {
            originalName: safeFileName,
            mimeType: req.file.mimetype,
            size: req.file.size
          });
        } catch (fErr) {
          console.error('[FORENSICS AUTO-EXTRACTION ERROR]', fErr.message);
        }
      }, 0);
    }

    return res.status(201).json({ success: true, message: 'Evidence uploaded successfully', evidence: evidenceObj });
  } catch (err) {
    await storageService.remove(storageKey);
    
    if (err.status === 503) {
      return res.status(503).json({ success: false, code: 'LEDGER_BUSY', message: err.message });
    }

    // Catch Race Condition
    if (err.code === 11000 && err.keyPattern && err.keyPattern.hash) {
      const existing = await ScopedEvidence.findOne({ hash: serverHash, isDeleted: false });
      if (existing) {
        await logEvent({
          action: 'UPLOAD',
          user: req.user,
          evidenceId: existing.evidenceId,
          caseId: existing.caseId,
          description: `Duplicate upload rejected (matches ${existing.evidenceId})`,
          orgId,
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
    const ScopedEvidence = scoped(Evidence, req.user);
    
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
      ScopedEvidence.find(query)
        .populate('uploadedBy', 'name -_id')
        .select('-storageKey')
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ScopedEvidence.countDocuments(query)
    ]);
    
    const formattedItems = items.map(item => {
      const uName = item.uploadedBy ? item.uploadedBy.name : null;
      const { uploadedBy, ...rest } = item;
      return { ...rest, uploadedByName: uName };
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
    
    const ScopedEvidence = scoped(Evidence, req.user);
    const evidence = await ScopedEvidence.findOne(query)
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
      const ScopedBlock = scoped(Block, req.user);
      const block = await ScopedBlock.findOne({ blockNumber: evidence.blockNumber }).lean();
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
    const ScopedVerification = scoped(Verification, req.user);
    const [totalVerifications, lastVerification] = await Promise.all([
      ScopedVerification.countDocuments({ evidenceId: evidence.evidenceId }),
      ScopedVerification.findOne({ evidenceId: evidence.evidenceId }).sort({ verifiedAt: -1 }).lean()
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
    const ScopedEvidence = scoped(Evidence, req.user);

    // Atomic update matching isDeleted false
    const evidence = await ScopedEvidence.findOneAndUpdate(
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
        console.error(`[STORAGE REMOVAL FAILURE] Could not delete file ${evidence.storageKey}: ${err.message}`);
      }
    }

    // Append-only audit logging: DELETE action
    await logEvent({
      action: 'DELETE',
      user: req.user,
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      description: `Soft deleted evidence ${evidence.evidenceId}: ${trimmedReason}`,
      orgId: req.user.orgId,
      req
    });

    return res.json({
      success: true,
      message: 'Evidence soft deleted successfully and storage removed',
      evidenceId: evidence.evidenceId,
      deletedAt: evidence.deletedAt
    });
  } catch (err) {
    next(err);
  }
};

const generateQr = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    const { resolveEvidence } = require('../services/verificationService');
    const evidence = await resolveEvidence(identifier, req.user);

    if (!evidence.publicToken) {
      evidence.publicToken = crypto.randomBytes(16).toString('base64url');
    }
    // Regenerating QR moves a record to token links
    evidence.legacyPublic = false;
    await evidence.save();

    const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const targetUrl = `${publicBaseUrl}/verify.html?t=${encodeURIComponent(evidence.publicToken)}`;

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
      orgId: req.user.orgId,
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

    const ScopedEvidence = scoped(Evidence, req.user);
    const evidence = await ScopedEvidence.findOne(query).select('+storageKey');
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

    const stream = await storageService.getStream(evidence.storageKey, {
      driver: evidence.storage?.driver,
      encryption: evidence.storage?.encryption
    });
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
