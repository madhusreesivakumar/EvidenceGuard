'use strict';

const crypto = require('crypto');

/**
 * Validates that an incoming JWK is a valid, well-formed ECDSA P-256 public key.
 */
function validateJwk(jwk) {
  if (!jwk || typeof jwk !== 'object') {
    return { valid: false, error: 'Public key JWK must be an object' };
  }
  if (jwk.kty !== 'EC') {
    return { valid: false, error: `Invalid key type: expected 'EC', got '${jwk.kty}'` };
  }
  if (jwk.crv !== 'P-256') {
    return { valid: false, error: `Invalid curve: expected 'P-256', got '${jwk.crv}'` };
  }
  if (!jwk.x || typeof jwk.x !== 'string' || !jwk.y || typeof jwk.y !== 'string') {
    return { valid: false, error: 'JWK missing EC coordinates x or y' };
  }

  try {
    const xBuf = Buffer.from(jwk.x, 'base64url');
    const yBuf = Buffer.from(jwk.y, 'base64url');
    if (xBuf.length !== 32 || yBuf.length !== 32) {
      return { valid: false, error: 'Invalid coordinate lengths for P-256 curve (must be 32 bytes)' };
    }
  } catch (err) {
    return { valid: false, error: 'Malformed base64url coordinates in JWK' };
  }

  // Attempt to parse with Node.js crypto
  try {
    const keyObj = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    if (keyObj.asymmetricKeyType !== 'ec') {
      return { valid: false, error: 'Key is not an elliptic curve key' };
    }
    return { valid: true, keyObj };
  } catch (err) {
    return { valid: false, error: 'Failed to import public key JWK: ' + err.message };
  }
}

/**
 * Derives the canonical SHA-256 fingerprint (hex) of the SubjectPublicKeyInfo (SPKI) DER bytes.
 */
function computeFingerprint(publicKeyJwk) {
  const { valid, error, keyObj } = validateJwk(publicKeyJwk);
  if (!valid) throw new Error(error);

  const spkiDer = keyObj.export({ type: 'spki', format: 'der' });
  const fingerprint = crypto.createHash('sha256').update(spkiDer).digest('hex');
  return { fingerprint, spkiDer, keyObj };
}

/**
 * Verifies an IEEE P1363 ECDSA P-256 SHA-256 signature over a challenge string.
 */
function verifySignature(publicKeyJwk, dataStringOrBuffer, signatureBase64) {
  try {
    const { valid, error, keyObj } = validateJwk(publicKeyJwk);
    if (!valid) return false;

    const dataBuf = Buffer.isBuffer(dataStringOrBuffer)
      ? dataStringOrBuffer
      : Buffer.from(dataStringOrBuffer, 'utf8');

    const sigBuf = Buffer.from(signatureBase64, 'base64');
    // Web Crypto P-256 signatures in IEEE P1363 format are strictly 64 bytes (r: 32 bytes, s: 32 bytes)
    if (sigBuf.length !== 64) {
      return false;
    }

    const verifier = crypto.createVerify('SHA256');
    verifier.update(dataBuf);
    verifier.end();

    return verifier.verify(
      {
        key: keyObj,
        dsaEncoding: 'ieee-p1363'
      },
      sigBuf
    );
  } catch (err) {
    return false;
  }
}

module.exports = {
  validateJwk,
  computeFingerprint,
  verifySignature
};
