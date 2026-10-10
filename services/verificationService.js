'use strict';

const crypto = require('crypto');
const Evidence = require('../models/Evidence');
const Block = require('../models/Block');
const Counter = require('../models/Counter');
const Verification = require('../models/Verification');
const { scoped, unscoped } = require('./tenantScope');
const { logEvent } = require('./auditService');
const { sha256Stream } = require('./hashService');
const { getNextSequence } = require('./idService');
const AppError = require('../utils/AppError');

const resolveEvidence = async (identifier, userOrOrgId = null) => {
  if (!identifier) {
    const error = new Error('Identifier is required');
    error.status = 400;
    error.code = 'INVALID_ID';
    throw error;
  }

  const rawId = String(identifier).trim();
  const cleanId = rawId.replace(/^EV[\s_]+/i, 'EV-').replace(/^EG[\s_]+/i, 'EG-');

  const isEvId = /^EV-[A-Za-z0-9_-]+$/i.test(cleanId);
  const isCaseId = /^EG-[A-Za-z0-9_-]+$/i.test(cleanId);
  const isMongoId = /^[0-9a-fA-F]{24}$/.test(rawId);

  if (!isEvId && !isCaseId && !isMongoId) {
    const error = new Error('Invalid identifier format. Must be EV-0000, EG-0000-0000 or valid ID');
    error.status = 400;
    error.code = 'INVALID_ID';
    throw error;
  }

  const query = { isDeleted: false };
  if (isEvId) {
    query.$or = [{ evidenceId: cleanId }, { evidenceId: new RegExp(`^${cleanId}$`, 'i') }, { evidenceId: rawId }];
  } else if (isCaseId) {
    query.$or = [{ caseId: cleanId }, { caseId: new RegExp(`^${cleanId}$`, 'i') }, { caseId: rawId }];
  } else {
    query._id = rawId;
  }

  const EvidenceModel = userOrOrgId ? scoped(Evidence, userOrOrgId) : unscoped(Evidence);
  const ev = await EvidenceModel.findOne(query);
  if (!ev) {
    const error = new Error('Evidence not found');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  return ev;
};

const compareHashes = (originalHash, submittedHash) => {
  const isHex = (str) => typeof str === 'string' && /^[0-9a-fA-F]{64}$/.test(str);
  
  if (!isHex(originalHash) || !isHex(submittedHash)) {
    const error = new Error('Could not compute the file hash.');
    error.status = 500;
    error.code = 'HASH_FAILURE';
    throw error;
  }

  try {
    const origBuf = Buffer.from(originalHash.toLowerCase(), 'hex');
    const subBuf = Buffer.from(submittedHash.toLowerCase(), 'hex');
    return crypto.timingSafeEqual(origBuf, subBuf);
  } catch (err) {
    const error = new Error('Hash failure: Comparison error');
    error.status = 500;
    throw error;
  }
};

const checkChainConsistency = async (evidence) => {
  if (evidence.blockNumber == null) return false;

  const orgId = evidence.orgId || 'default';
  const block = await scoped(Block, orgId).findOne({ blockNumber: evidence.blockNumber });
  if (!block) return false;

  if (block.evidenceId !== evidence.evidenceId) return false;
  if (block.evidenceHash !== evidence.hash) return false;

  return true;
};

const executeVerification = async ({ identifier, filePath, originalname, fileSize, clientHash, user, req, ip }) => {
  const orgId = user?.orgId || 'default';
  const evidence = await resolveEvidence(identifier, orgId);

  let serverHash;
  try {
    serverHash = await sha256Stream(filePath);
  } catch (err) {
    throw new AppError('Could not compute the file hash.', 'HASH_FAILURE', 500);
  }

  if (clientHash && clientHash.toLowerCase() !== serverHash) {
    const mismatchErr = new AppError('Hash mismatch: the file changed or was corrupted during upload', 'HASH_MISMATCH_UPLOAD', 422);
    mismatchErr.serverHash = serverHash;
    mismatchErr.clientHash = clientHash.toLowerCase();
    throw mismatchErr;
  }

  let isMatch = false;
  try {
    isMatch = compareHashes(evidence.hash, serverHash);
  } catch (err) {
    throw new AppError(err.message, 'VERIFICATION_FAILED', 500);
  }

  const resultEnum = isMatch ? 'VERIFIED' : 'TAMPERED';
  const chainConsistent = await checkChainConsistency(evidence);

  const seq = await getNextSequence('verificationId', orgId);
  const verId = `VER-${String(seq).padStart(6, '0')}`;

  const userName = user ? (user.name || 'System') : 'System';
  const userId = user ? (user._id || user.id) : null;
  const clientIp = ip || (req ? (req.ip || req.connection?.remoteAddress) : '127.0.0.1');

  const ScopedVerification = scoped(Verification, orgId);
  const verification = new ScopedVerification({
    verificationId: verId,
    orgId,
    evidenceId: evidence.evidenceId,
    caseId: evidence.caseId,
    originalHash: evidence.hash,
    submittedHash: serverHash,
    result: resultEnum,
    chainConsistent,
    submittedFileName: originalname || 'verified_file.bin',
    submittedFileSize: fileSize || 0,
    verifiedBy: userId,
    verifiedByName: userName,
    ipAddress: clientIp,
    isDemo: evidence.isDemo || false
  });

  await verification.save();

  const ScopedEvidence = scoped(Evidence, orgId);
  await ScopedEvidence.findOneAndUpdate(
    { evidenceId: evidence.evidenceId },
    {
      $set: {
        status: resultEnum === 'VERIFIED' ? 'Verified' : 'Tampered',
        verifiedAt: new Date()
      }
    }
  );

  await logEvent({
    action: resultEnum === 'VERIFIED' ? 'VERIFY' : 'TAMPER_DETECTED',
    user: user || { _id: userId, name: userName, role: user?.role || 'SYSTEM', orgId },
    evidenceId: evidence.evidenceId,
    caseId: evidence.caseId,
    description: `Evidence ${evidence.evidenceId} verification completed: ${resultEnum} (Chain: ${chainConsistent ? 'Consistent' : 'Broken'})`,
    orgId,
    req
  });

  if (process.env.FEATURE_NOTIFICATIONS === 'true') {
    try {
      const { emitNotificationEvent } = require('./notificationDispatcher');
      emitNotificationEvent({
        action: resultEnum === 'VERIFIED' ? 'VERIFY' : 'TAMPER_DETECTED',
        user: user || { _id: userId, name: userName, role: user?.role || 'SYSTEM', orgId },
        evidenceId: evidence.evidenceId,
        caseId: evidence.caseId,
        result: resultEnum,
        chainConsistent,
        orgId
      });
    } catch (e) {
      // Non-blocking
    }
  }

  return {
    verificationId: verId,
    evidenceId: evidence.evidenceId,
    caseId: evidence.caseId,
    originalHash: evidence.hash,
    submittedHash: serverHash,
    result: resultEnum,
    chainConsistent,
    verifiedAt: verification.verifiedAt || new Date(),
    verifiedByName: userName,
    submittedFileName: originalname || 'verified_file.bin',
    submittedFileSize: fileSize || 0
  };
};

module.exports = {
  resolveEvidence,
  compareHashes,
  checkChainConsistency,
  executeVerification
};
