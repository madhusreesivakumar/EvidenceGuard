'use strict';

const crypto = require('crypto');
const UserKey = require('../models/UserKey');
const KeyChallenge = require('../models/KeyChallenge');
const { validateJwk, computeFingerprint, verifySignature } = require('../services/keyService');
const { logEvent } = require('../services/auditService');

/**
 * GET /api/keys/challenge
 * Returns a single-use random nonce that expires in 5 minutes.
 */
const getChallenge = async (req, res, next) => {
  try {
    const challengeText = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await KeyChallenge.create({
      challengeText,
      userId: req.user ? req.user._id : null,
      expiresAt,
      used: false
    });

    return res.status(200).json({
      success: true,
      challenge: challengeText,
      expiresAt
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/keys
 * Registers a public key with proof-of-possession signature over the challenge.
 */
const registerKey = async (req, res, next) => {
  try {
    const { publicKeyJwk, label, signature, challenge } = req.body;

    // 1. Basic validation
    if (!label || typeof label !== 'string' || label.trim().length < 2 || label.trim().length > 60) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Key label must be between 2 and 60 characters.'
      });
    }

    if (!challenge || typeof challenge !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Challenge is required.'
      });
    }

    if (!signature || typeof signature !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Signature over challenge is required.'
      });
    }

    // 2. Validate Challenge / Nonce (Must exist, not expired, not used)
    const chRecord = await KeyChallenge.findOne({ challengeText: challenge });
    if (!chRecord) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_CHALLENGE',
        message: 'Challenge not found or invalid.'
      });
    }

    if (chRecord.used) {
      return res.status(400).json({
        success: false,
        code: 'CHALLENGE_REPLAYED',
        message: 'Challenge has already been used. Please request a fresh challenge.'
      });
    }

    if (new Date() > chRecord.expiresAt) {
      return res.status(400).json({
        success: false,
        code: 'CHALLENGE_EXPIRED',
        message: 'Challenge has expired. Please request a fresh challenge.'
      });
    }

    // Atomically mark challenge as used to prevent replay attacks
    chRecord.used = true;
    await chRecord.save();

    // 3. Validate JWK structure & curve
    const jwkValidation = validateJwk(publicKeyJwk);
    if (!jwkValidation.valid) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_JWK',
        message: jwkValidation.error
      });
    }

    // 4. Verify Proof of Possession (signature over challenge)
    const isSignatureValid = verifySignature(publicKeyJwk, challenge, signature);
    if (!isSignatureValid) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SIGNATURE',
        message: 'Cryptographic proof of possession failed. Signature does not verify.'
      });
    }

    // 5. Derive SPKI Fingerprint
    const { fingerprint } = computeFingerprint(publicKeyJwk);

    // 6. Check for duplicate key across the system
    const existing = await UserKey.findOne({ fingerprint });
    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_KEY',
        message: 'This key has already been registered in the system.'
      });
    }

    // 7. Enforce max 5 active keys per user
    const activeKeyCount = await UserKey.countDocuments({
      userId: req.user._id,
      status: 'active'
    });

    if (activeKeyCount >= 5) {
      return res.status(400).json({
        success: false,
        code: 'KEY_LIMIT_REACHED',
        message: 'Maximum limit of 5 active keys reached. Revoke an old key before adding a new one.'
      });
    }

    // 8. Create UserKey record
    const keyId = crypto.randomUUID();
    const newKey = await UserKey.create({
      keyId,
      userId: req.user._id,
      algorithm: 'ECDSA-P256-SHA256',
      publicKeyJwk: {
        kty: publicKeyJwk.kty,
        crv: publicKeyJwk.crv,
        x: publicKeyJwk.x,
        y: publicKeyJwk.y
      },
      fingerprint,
      label: label.trim(),
      status: 'active'
    });

    // 9. Audit event
    await logEvent({
      action: 'KEY_REGISTERED',
      user: req.user,
      description: `Cryptographic key registered: ${keyId} (${newKey.label}, fingerprint: ${fingerprint.substring(0, 16)}...)`,
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Key registered successfully',
      key: {
        keyId: newKey.keyId,
        fingerprint: newKey.fingerprint,
        label: newKey.label,
        algorithm: newKey.algorithm,
        status: newKey.status,
        createdAt: newKey.createdAt
      }
    });

  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/keys
 * Lists all keys belonging to the authenticated user.
 */
const listOwnKeys = async (req, res, next) => {
  try {
    const keys = await UserKey.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    const sanitized = keys.map(k => ({
      keyId: k.keyId,
      label: k.label,
      fingerprint: k.fingerprint,
      algorithm: k.algorithm,
      status: k.status,
      createdAt: k.createdAt,
      revokedAt: k.revokedAt,
      revokedReason: k.revokedReason
    }));

    return res.status(200).json({
      success: true,
      keys: sanitized
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/keys/:keyId/public
 * Returns public metadata of a key for any authenticated user.
 */
const getPublicKey = async (req, res, next) => {
  try {
    const key = await UserKey.findOne({ keyId: req.params.keyId }).lean();
    if (!key) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Key not found.'
      });
    }

    return res.status(200).json({
      success: true,
      key: {
        keyId: key.keyId,
        userId: key.userId,
        label: key.label,
        fingerprint: key.fingerprint,
        algorithm: key.algorithm,
        publicKeyJwk: key.publicKeyJwk,
        status: key.status,
        createdAt: key.createdAt,
        revokedAt: key.revokedAt
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/keys/:keyId/revoke
 * Revokes a key. Allowed for key owner or ADMIN.
 */
const revokeKey = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'A revocation reason (at least 3 characters) is required.'
      });
    }

    const key = await UserKey.findOne({ keyId: req.params.keyId });
    if (!key) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Key not found.'
      });
    }

    const isOwner = String(key.userId) === String(req.user._id);
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You are not authorized to revoke this key.'
      });
    }

    if (key.status === 'revoked') {
      return res.status(400).json({
        success: false,
        code: 'ALREADY_REVOKED',
        message: 'This key has already been revoked.'
      });
    }

    key.status = 'revoked';
    key.revokedAt = new Date();
    key.revokedReason = reason.trim();
    await key.save();

    await logEvent({
      action: 'KEY_REVOKED',
      user: req.user,
      description: `Cryptographic key revoked: ${key.keyId} (${key.label}) - Reason: ${key.revokedReason}`,
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Key revoked successfully.',
      keyId: key.keyId,
      status: key.status,
      revokedAt: key.revokedAt
    });

  } catch (err) {
    next(err);
  }
};

module.exports = {
  getChallenge,
  registerKey,
  listOwnKeys,
  getPublicKey,
  revokeKey
};
