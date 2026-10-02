const fs = require('fs');
const { resolveEvidence, compareHashes, checkChainConsistency } = require('../services/verificationService');
const { sha256Stream } = require('../services/hashService');
const Verification = require('../models/Verification');
const Evidence = require('../models/Evidence');
const Counter = require('../models/Counter');
const { logEvent } = require('../services/auditService');

const lookupEvidence = async (req, res, next) => {
  try {
    const identifier = req.query.evidenceId || req.query.caseId;
    if (!identifier) {
      return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'Missing evidenceId or caseId' });
    }
    const evidence = await resolveEvidence(identifier);
    
    // safe fields only
    res.json({
      success: true,
      evidence: {
        evidenceId: evidence.evidenceId,
        caseId: evidence.caseId,
        name: evidence.name,
        type: evidence.type,
        fileName: evidence.fileName,
        status: evidence.status,
        createdAt: evidence.createdAt,
        isDemo: evidence.isDemo || false
      }
    });
  } catch (err) {
    next(err);
  }
};

const verifyEvidence = async (req, res, next) => {
  let serverHash = null;
  let fileDeleted = false;
  
  try {
    const identifier = req.params.id;
    const clientHash = req.body.clientHash;
    const file = req.file;

    let evidence;
    try {
      evidence = await resolveEvidence(identifier);
    } catch(err) {
      if (file) fs.unlinkSync(file.path);
      if (err.status === 400) return res.status(400).json({ success: false, code: err.code || 'INVALID_ID', message: err.message });
      if (err.status === 404) return res.status(404).json({ success: false, code: err.code || 'NOT_FOUND', message: err.message });
      return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Internal error' });
    }

    if (!file) {
      return res.status(400).json({ success: false, code: 'NO_FILE', message: 'No file uploaded' });
    }

    serverHash = await sha256Stream(file.path);
    fs.unlinkSync(file.path);
    fileDeleted = true;

    if (clientHash && clientHash !== serverHash) {
      return res.status(422).json({
        success: false,
        code: 'HASH_MISMATCH_UPLOAD',
        message: 'Hash mismatch: the file changed or was corrupted during upload'
      });
    }

    let isMatch = false;
    try {
      isMatch = compareHashes(evidence.hash, serverHash);
    } catch (err) {
      return res.status(500).json({ success: false, code: 'VERIFICATION_FAILED', message: err.message });
    }

    const resultEnum = isMatch ? 'VERIFIED' : 'TAMPERED';
    const chainConsistent = await checkChainConsistency(evidence);

    const counter = await Counter.findByIdAndUpdate(
      { _id: 'verificationId' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const verId = `VER-${String(counter.seq).padStart(6, '0')}`;

    const verification = new Verification({
      verificationId: verId,
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      originalHash: evidence.hash,
      submittedHash: serverHash,
      result: resultEnum,
      chainConsistent: chainConsistent,
      submittedFileName: file.originalname,
      submittedFileSize: file.size,
      verifiedBy: req.user._id,
      verifiedByName: req.user.name,
      ipAddress: req.ip,
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
      user: req.user,
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      description: `Verification result: ${resultEnum} for ${evidence.evidenceId}`,
      req
    });

    if (resultEnum === 'TAMPERED') {
      await logEvent({
        action: 'TAMPER_DETECTED',
        user: req.user,
        evidenceId: evidence.evidenceId,
        caseId: evidence.caseId,
        description: `Tamper detected on ${evidence.evidenceId}. Orig: ${evidence.hash.substring(0, 12)} Sub: ${serverHash.substring(0, 12)}`,
        req
      });
    }

    const responsePayload = {
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
      verifiedBy: req.user.name
    };

    if (resultEnum === 'VERIFIED' && !chainConsistent) {
      responsePayload.chainWarning = "Ledger record does not match this evidence. Run blockchain validation.";
    }

    res.status(200).json(responsePayload);

  } catch (err) {
    if (!fileDeleted && req.file) {
      try { fs.unlinkSync(req.file.path); } catch(e){}
    }
    next(err);
  }
};

const getVerifications = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    const evidence = await resolveEvidence(identifier);

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip = (page - 1) * limit;

    const query = { evidenceId: evidence.evidenceId };
    
    const verifications = await Verification.find(query)
      .sort({ verifiedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('verificationId result submittedHash submittedFileName submittedFileSize verifiedByName verifiedAt chainConsistent isDemo -_id')
      .lean();

    res.json({
      success: true,
      data: verifications
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  lookupEvidence,
  verifyEvidence,
  getVerifications
};
