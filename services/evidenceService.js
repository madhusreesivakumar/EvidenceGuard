'use strict';

const fs = require('fs');
const mongoose = require('mongoose');
const Evidence = require('../models/Evidence');
const hashService = require('./hashService');
const idService = require('./idService');
const storageService = require('../storage/storageService');
const { logEvent } = require('./auditService');
const { appendBlock } = require('./chainService');
const AppError = require('../utils/AppError');

/**
 * Real Evidence Registration Service
 * Executes full production path: SHA-256 stream, duplicate check, ID generation,
 * storage persistence, blockchain block append, and audit logging.
 */
async function createEvidenceRecord({ file, body = {}, user, req, ip }) {
  if (!file || !file.path) {
    throw new AppError('No file provided', 'NO_FILE', 400);
  }

  const tempPath = file.path;
  let serverHash;
  try {
    serverHash = await hashService.sha256Stream(tempPath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw new AppError('Could not compute the file hash.', 'HASH_FAILURE', 500);
  }

  const { clientHash, name, type, description, isDemo } = body;
  if (clientHash && clientHash.toLowerCase() !== serverHash) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    const err = new AppError('Hash mismatch: the file changed or was corrupted during upload', 'HASH_MISMATCH_UPLOAD', 422);
    err.serverHash = serverHash;
    err.clientHash = clientHash.toLowerCase();
    throw err;
  }

  // Duplicate Check
  const existing = await Evidence.findOne({ hash: serverHash, isDeleted: false });
  if (existing) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    await logEvent({
      action: 'UPLOAD',
      user,
      evidenceId: existing.evidenceId,
      caseId: existing.caseId,
      description: `Duplicate upload rejected (matches ${existing.evidenceId})`,
      req
    });
    const dupErr = new AppError('DUPLICATE EVIDENCE DETECTED', 'DUPLICATE_EVIDENCE', 409);
    dupErr.existing = {
      evidenceId: existing.evidenceId,
      caseId: existing.caseId,
      registeredAt: existing.createdAt
    };
    throw dupErr;
  }

  let evidenceId, caseId;
  try {
    evidenceId = await idService.nextEvidenceId();
    caseId = await idService.nextCaseId();
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw new AppError('Failed to generate IDs', 'SERVER_ERROR', 500);
  }

  const randomSuffix = Math.round(Math.random() * 1E9).toString(16);
  const storageKey = `${evidenceId}-${randomSuffix}`;

  try {
    await storageService.save(tempPath, storageKey);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw new AppError('Failed to save file to storage', 'SERVER_ERROR', 500);
  }

  const safeFileName = storageService.sanitizeFilename(file.originalname || 'evidence.bin');

  const evidenceData = {
    evidenceId,
    caseId,
    name: name || 'Untitled Evidence',
    type: type || 'Other',
    description: description || '',
    fileName: safeFileName,
    fileSize: file.size,
    mimeType: file.mimetype || 'application/octet-stream',
    hash: serverHash,
    storageKey,
    status: 'Pending',
    uploadedBy: user ? (user._id || user.id) : null,
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
      evidenceDoc = new Evidence(evidenceData);
      await evidenceDoc.save();

      try {
        blockDoc = await appendBlock({ evidence: evidenceDoc, session: null });
        evidenceDoc.blockNumber = blockDoc.blockNumber;
        await evidenceDoc.save();
      } catch (blockErr) {
        await Evidence.deleteOne({ _id: evidenceDoc._id });
        throw blockErr;
      }
    }

    await logEvent({
      action: 'HASH_GENERATED',
      user,
      evidenceId,
      caseId,
      description: `Hash generated for evidence ${safeFileName}: ${serverHash}`,
      req
    });

    await logEvent({
      action: 'UPLOAD',
      user,
      evidenceId,
      caseId,
      description: `Uploaded evidence ${evidenceId}`,
      req
    });

    await logEvent({
      action: 'BLOCK_CREATED',
      user,
      evidenceId,
      caseId,
      description: `Block #${blockDoc.blockNumber} created for ${evidenceId}`,
      req
    });

    const evidenceObj = evidenceDoc.toObject();
    delete evidenceObj.storageKey;
    evidenceObj.blockNumber = blockDoc.blockNumber;
    evidenceObj.blockHash = blockDoc.currentHash;

    return { evidence: evidenceObj, evidenceDoc, blockDoc };
  } catch (err) {
    await storageService.remove(storageKey);
    throw err;
  }
}

module.exports = {
  createEvidenceRecord
};
