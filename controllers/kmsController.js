'use strict';

/**
 * controllers/kmsController.js
 * Sprint 16B: KMS Administration REST API
 *
 * Routes:
 *   GET  /api/kms/health                 - Provider health check (ADMIN)
 *   GET  /api/kms/keys/:keyId/versions   - List key versions (ADMIN)
 *   POST /api/kms/keys/:keyId/rotate     - Rotate a key (SUPER_ADMIN / ADMIN)
 *   GET  /api/kms/keys/:keyId/public     - Get public key PEM/JWK (ADMIN)
 *
 * Security:
 *   - All routes require ADMIN (ORG_ADMIN) or SUPER_ADMIN role.
 *   - No key material is ever returned in responses.
 *   - Rotation events are recorded in the audit log.
 *   - keyId is validated against an allowlist to prevent arbitrary key access.
 */

const { getKeyProvider, healthCheck } = require('../services/kms/index');
const { logEvent }                    = require('../services/auditService');

/** Allowlisted key identifiers that can be managed via this API */
const ALLOWED_KEY_IDS = new Set([
  'STORAGE_KEK',
  'JWT_KEY',
  'NOTARY_KEY'
]);

function validateKeyId(keyId, res) {
  if (!keyId || !ALLOWED_KEY_IDS.has(keyId)) {
    res.status(404).json({
      success: false,
      code:    'KEY_NOT_FOUND',
      message: `Key [${keyId}] is not a managed key identifier.`,
      allowedKeys: [...ALLOWED_KEY_IDS]
    });
    return false;
  }
  return true;
}

// GET /api/kms/health
exports.health = async (req, res, next) => {
  try {
    const result = await healthCheck();
    const statusCode = result.status === 'HEALTHY' ? 200 : 503;
    res.status(statusCode).json({ success: result.status === 'HEALTHY', kms: result });
  } catch (err) {
    next(err);
  }
};

// GET /api/kms/keys/:keyId/versions
exports.listVersions = async (req, res, next) => {
  const { keyId } = req.params;
  if (!validateKeyId(keyId, res)) return;

  try {
    const provider  = getKeyProvider();
    const versions  = await provider.listVersions(keyId);
    res.status(200).json({
      success: true,
      keyId,
      provider: provider.name || (process.env.KMS_PROVIDER || 'local'),
      versions
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/kms/keys/:keyId/rotate
exports.rotate = async (req, res, next) => {
  const { keyId } = req.params;
  if (!validateKeyId(keyId, res)) return;

  try {
    const provider = getKeyProvider();
    const result   = await provider.rotate(keyId);

    // Invalidate JWT public key cache on JWT_KEY rotation
    if (keyId === 'JWT_KEY') {
      try {
        const { _invalidatePublicKeyCache } = require('../services/tokenService');
        _invalidatePublicKeyCache();
      } catch (_) {}
    }

    await logEvent({
      action:      'KMS_KEY_ROTATED',
      user:        req.user,
      description: `KMS key [${keyId}] rotated: ${result.previousVersion} → ${result.newVersion}`,
      req
    });

    res.status(200).json({
      success: true,
      message: `Key [${keyId}] rotated successfully.`,
      keyId:           result.keyId,
      newVersion:      result.newVersion,
      previousVersion: result.previousVersion
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/kms/keys/:keyId/public
exports.getPublicKey = async (req, res, next) => {
  const { keyId }  = req.params;
  const { version } = req.query;

  if (!validateKeyId(keyId, res)) return;

  // Only asymmetric keys have a public key
  const asymmetricKeys = new Set(['JWT_KEY', 'NOTARY_KEY']);
  if (!asymmetricKeys.has(keyId)) {
    return res.status(400).json({
      success: false,
      code:    'SYMMETRIC_KEY',
      message: `Key [${keyId}] is a symmetric key and has no public key to export.`
    });
  }

  try {
    const provider = getKeyProvider();
    const result   = await provider.getPublicKey(keyId, version || undefined);

    res.status(200).json({
      success:       true,
      keyId:         result.keyId,
      version:       result.version,
      algorithm:     result.algorithm,
      publicKeyPem:  result.publicKeyPem,
      publicKeyJwk:  result.publicKeyJwk
    });
  } catch (err) {
    next(err);
  }
};
