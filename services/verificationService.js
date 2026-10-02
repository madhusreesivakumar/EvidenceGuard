const crypto = require('crypto');
const Evidence = require('../models/Evidence');
const Block = require('../models/Block');

const resolveEvidence = async (identifier) => {
  if (!identifier || typeof identifier !== 'string') {
    const error = new Error('Invalid identifier format');
    error.status = 400;
    error.code = 'INVALID_ID';
    throw error;
  }

  const isEvId = /^EV-\d{4}$/.test(identifier);
  const isCaseId = /^EG-\d{4}-\d{4}$/.test(identifier);

  if (!isEvId && !isCaseId) {
    const error = new Error('Invalid identifier format. Must be EV-0000 or EG-0000-0000');
    error.status = 400;
    error.code = 'INVALID_ID';
    throw error;
  }

  let query = { isDeleted: false };
  if (isEvId) {
    query.evidenceId = identifier;
  } else {
    query.caseId = identifier;
  }

  const ev = await Evidence.findOne(query);
  if (!ev) {
    const error = new Error('Evidence not found');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  return ev;
};

const compareHashes = (originalHash, submittedHash) => {
  const isHex = (str) => typeof str === 'string' && /^[0-9a-f]{64}$/.test(str);
  
  if (!isHex(originalHash) || !isHex(submittedHash)) {
    const error = new Error('Could not compute the file hash.');
    error.status = 500;
    error.code = 'HASH_FAILURE';
    throw error;
  }

  try {
    const origBuf = Buffer.from(originalHash, 'hex');
    const subBuf = Buffer.from(submittedHash, 'hex');
    return crypto.timingSafeEqual(origBuf, subBuf);
  } catch (err) {
    const error = new Error('Hash failure: Comparison error');
    error.status = 500;
    throw error;
  }
};

const checkChainConsistency = async (evidence) => {
  if (evidence.blockNumber == null) return false;

  const block = await Block.findOne({ blockNumber: evidence.blockNumber });
  if (!block) return false;

  if (block.evidenceId !== evidence.evidenceId) return false;
  if (block.evidenceHash !== evidence.hash) return false;

  return true;
};

const Counter = require('../models/Counter');
const Verification = require('../models/Verification');
const { logEvent } = require('./auditService');
const { sha256Stream } = require('./hashService');
const AppError = require('../utils/AppError');

const executeVerification = async ({ identifier, filePath, originalname, fileSize, clientHash, user, req, ip }) => {
  const evidence = await resolveEvidence(identifier);

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

  const counter = await Counter.findByIdAndUpdate(
    { _id: 'verificationId' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const verId = `VER-${String(counter.seq).padStart(6, '0')}`;

  const userName = user ? (user.name || 'System') : 'System';
  const userId = user ? (user._id || user.id) : null;
  const clientIp = ip || (req ? (req.ip || req.connection?.remoteAddress) : '127.0.0.1');

  const verification = new Verification({
    verificationId: verId,
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

  await Evidence.findOneAndUpdate(
    { evidenceId: evidence.evidenceId },
    {
      $set: {
        status: resultEnum === 'VERIFIED' ? 'Verified' : 'Tampered',
        verifiedAt: new Date()
      }
    }
  );

  await logEvent({
    action: 'VERIFY',
    user,
    evidenceId: evidence.evidenceId,
    caseId: evidence.caseId,
    description: `Verification result: ${resultEnum} for ${evidence.evidenceId}`,
    req
  });

  if (resultEnum === 'TAMPERED') {
    await logEvent({
      action: 'TAMPER_DETECTED',
      user,
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      description: `Tamper detected on ${evidence.evidenceId}. Orig: ${evidence.hash.substring(0, 12)} Sub: ${serverHash.substring(0, 12)}`,
      req
    });
  }

  return {
    success: true,
    result: resultEnum,
    message: resultEnum === 'VERIFIED' ? 'Evidence integrity confirmed.' : 'Evidence hash does not match the registered hash.',
    evidenceId: evidence.evidenceId,
    caseId: evidence.caseId,
    originalHash: evidence.hash,
    currentHash: serverHash,
    chainConsistent,
    verificationId: verId,
    verifiedAt: verification.verifiedAt,
    verifiedBy: userName,
    isDemo: evidence.isDemo || false
  };
};

module.exports = {
  resolveEvidence,
  compareHashes,
  checkChainConsistency,
  executeVerification
};
