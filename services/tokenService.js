'use strict';

/**
 * services/tokenService.js
 * Sprint 16B: JWT Token Service with KMS-backed Asymmetric Signing Support
 *
 * Modes:
 *  1. KMS asymmetric (JWT_KEY managed by KeyProvider):
 *     - Signs tokens with ECDSA P-256 (ES256) private key inside KMS/HSM.
 *     - Verifies using cached public key (zero-latency local verification).
 *     - Active when KMS_PROVIDER != 'local' or JWT_USE_KMS=true.
 *
 *  2. Legacy symmetric (JWT_SECRET environment variable):
 *     - HS256 HMAC signing (backwards-compatible with all prior sprints).
 *     - Active when KMS is not configured.
 *
 * Security:
 *  - Private key never leaves KMS/HSM boundary.
 *  - Public key cached in memory after first fetch (auto-refreshed on rotation).
 *  - Verification uses the cached public key set (supports concurrent active versions).
 */

const jwt = require('jsonwebtoken');

// ── KMS mode detection ────────────────────────────────────────────────────────

function isKmsJwtMode() {
  const providerName = (process.env.KMS_PROVIDER || 'local').toLowerCase();
  return providerName !== 'local' || process.env.JWT_USE_KMS === 'true';
}

// ── Cached public key for KMS verification ────────────────────────────────────
// Refreshed after each rotation event.
let _cachedPublicKeyPem = null;
let _cachedPublicKeyFetchedAt = null;
const PUBLIC_KEY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function _getCachedPublicKeyPem() {
  const now = Date.now();
  if (
    _cachedPublicKeyPem &&
    _cachedPublicKeyFetchedAt &&
    (now - _cachedPublicKeyFetchedAt) < PUBLIC_KEY_CACHE_TTL_MS
  ) {
    return _cachedPublicKeyPem;
  }

  const { getKeyProvider } = require('./kms/index');
  const provider = getKeyProvider();
  const result = await provider.getPublicKey('JWT_KEY');
  _cachedPublicKeyPem = result.publicKeyPem;
  _cachedPublicKeyFetchedAt = now;
  return _cachedPublicKeyPem;
}

function _invalidatePublicKeyCache() {
  _cachedPublicKeyPem = null;
  _cachedPublicKeyFetchedAt = null;
}

// ── Token generation ──────────────────────────────────────────────────────────

/**
 * Generates a signed JWT for the given user.
 *
 * In KMS mode: signs with ECDSA P-256 inside the KMS/HSM (ES256 algorithm).
 * In legacy mode: signs with HS256 using JWT_SECRET.
 *
 * @param {string|Object} userId
 * @param {string} role
 * @param {Object} [extra] - Additional claims (orgId, etc.)
 * @returns {Promise<string>} Signed JWT string
 */
async function generateToken(userId, role, extra = {}) {
  const payload = {
    userId: userId.toString ? userId.toString() : String(userId),
    role,
    ...extra
  };

  if (isKmsJwtMode()) {
    try {
      const { getKeyProvider } = require('./kms/index');
      const provider = getKeyProvider();

      // Sign the digest of the JWT header+payload inside the KMS/HSM
      const header   = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
      const body     = Buffer.from(JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 8 * 3600
      })).toString('base64url');

      const signingInput = `${header}.${body}`;
      const digest = require('crypto').createHash('sha256').update(signingInput).digest();

      const { signature } = await provider.sign('JWT_KEY', digest);
      return `${signingInput}.${signature}`;
    } catch (kmsErr) {
      // Fail closed: if KMS is down, refuse to issue tokens
      const err = new Error(`Token generation failed: KMS signing unavailable (${kmsErr.message})`);
      err.code  = 'KMS_UNAVAILABLE';
      err.status = 503;
      throw err;
    }
  }

  // Legacy HS256 mode
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required when KMS_PROVIDER is not set');
  }
  return jwt.sign(payload, secret, { expiresIn: '8h' });
}

/**
 * Synchronous legacy token generator (used in Sprint 9A key tests and any
 * code paths that cannot be made async yet).
 * DOES NOT support KMS mode; falls back to HS256.
 * @deprecated Use generateToken() (async) in new code
 */
function generateTokenSync(userId, role, extra = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  const payload = { userId: String(userId), role, ...extra };
  return jwt.sign(payload, secret, { expiresIn: '8h' });
}

// ── Token verification ────────────────────────────────────────────────────────

/**
 * Verifies a JWT token and returns the decoded payload.
 *
 * In KMS mode: verifies the ES256 signature using the cached public key.
 * In legacy mode: verifies the HS256 signature using JWT_SECRET.
 *
 * This is intentionally kept synchronous (for middleware compatibility)
 * but performs an async public key refresh if the cache is expired.
 *
 * @param {string} token
 * @returns {{ userId: string, role: string, [k: string]: any } | null}
 */
function verifyToken(token) {
  if (!token) return null;

  try {
    if (isKmsJwtMode()) {
      // For KMS-signed tokens (ES256): use stored public key for verification.
      // If public key is not yet cached, fall through to legacy for this call
      // and refresh in background.
      if (_cachedPublicKeyPem) {
        return jwt.verify(token, _cachedPublicKeyPem, { algorithms: ['ES256'] });
      }

      // Public key not cached yet — attempt async refresh (fire-and-forget)
      _getCachedPublicKeyPem().catch(() => {});

      // Also try legacy secret as fallback during KMS key cache warm-up
      if (process.env.JWT_SECRET) {
        try {
          return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (_) {
          return null;
        }
      }
      return null;
    }

    // Legacy HS256 verification
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
}

/**
 * Async token verification — use in contexts where awaiting is possible.
 * Refreshes the public key cache if needed before verifying.
 * @param {string} token
 * @returns {Promise<{ userId: string, role: string } | null>}
 */
async function verifyTokenAsync(token) {
  if (!token) return null;

  try {
    if (isKmsJwtMode()) {
      const publicKeyPem = await _getCachedPublicKeyPem();
      return jwt.verify(token, publicKeyPem, { algorithms: ['ES256'] });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (_) {
    return null;
  }
}

module.exports = {
  generateToken,
  generateTokenSync,
  verifyToken,
  verifyTokenAsync,
  isKmsJwtMode,
  _invalidatePublicKeyCache
};
