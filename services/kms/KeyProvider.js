'use strict';

/**
 * services/kms/KeyProvider.js
 * Sprint 16A: Cryptographic KeyProvider Interface & Circuit Breaker
 *
 * Invariants:
 * - Abstract base interface for all KMS and HSM providers.
 * - Enforces contextual AAD binding on wrapped keys.
 * - Built-in timeout enforcement and circuit breaker pattern.
 * - Maps all provider errors to standard KMS_UNAVAILABLE (HTTP 503).
 * - Zero key material or PINs leaked into logs or stack traces.
 */

class KeyProvider {
  /**
   * @param {Object} options
   * @param {number} [options.timeoutMs=5000] - Operation timeout in milliseconds
   * @param {number} [options.failureThreshold=3] - Consecutive failures before opening circuit
   * @param {number} [options.recoveryTimeoutMs=10000] - Duration to stay in OPEN state
   */
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 5000;
    this.failureThreshold = options.failureThreshold || 3;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs || 10000;

    this.circuitState = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
  }

  /**
   * Encrypts/wraps a plaintext key binding context as Additional Authenticated Data (AAD).
   * @param {string} keyId - Key Encryption Key (KEK) identifier
   * @param {Buffer|string} plaintext - Plaintext data key to wrap
   * @param {Object} [context={}] - Contextual AAD (e.g. { orgId, evidenceId })
   * @returns {Promise<{ wrappedKey: string, keyId: string, version: string, algorithm: string }>}
   */
  async wrap(keyId, plaintext, context = {}) {
    throw new Error('wrap() must be implemented by KeyProvider subclass');
  }

  /**
   * Decrypts/unwraps a wrapped key validating the bound contextual AAD.
   * @param {string} keyId - Key Encryption Key (KEK) identifier
   * @param {string|Object} wrapped - Wrapped key payload
   * @param {Object} [context={}] - Contextual AAD matching wrap context
   * @returns {Promise<Buffer>} Plaintext key material
   */
  async unwrap(keyId, wrapped, context = {}) {
    throw new Error('unwrap() must be implemented by KeyProvider subclass');
  }

  /**
   * Signs a digest using an asymmetric key inside the KMS/HSM.
   * @param {string} keyId - Signing key identifier
   * @param {Buffer} digest - Hash digest to sign (e.g. SHA-256)
   * @returns {Promise<{ signature: string, algorithm: string, keyId: string, version: string }>}
   */
  async sign(keyId, digest) {
    throw new Error('sign() must be implemented by KeyProvider subclass');
  }

  /**
   * Retrieves the public key for an asymmetric key pair.
   * @param {string} keyId - Key identifier
   * @param {string} [version] - Optional key version (defaults to latest)
   * @returns {Promise<{ publicKeyPem: string, algorithm: string, keyId: string, version: string }>}
   */
  async getPublicKey(keyId, version) {
    throw new Error('getPublicKey() must be implemented by KeyProvider subclass');
  }

  /**
   * Computes an HMAC over data using a key inside the KMS/HSM.
   * @param {string} keyId - HMAC key identifier
   * @param {Buffer|string} data - Data to authenticate
   * @returns {Promise<string>} Hex or base64 HMAC
   */
  async hmac(keyId, data) {
    throw new Error('hmac() must be implemented by KeyProvider subclass');
  }

  /**
   * Rotates a key to a new version.
   * @param {string} keyId - Key identifier to rotate
   * @returns {Promise<{ keyId: string, newVersion: string, previousVersion: string }>}
   */
  async rotate(keyId) {
    throw new Error('rotate() must be implemented by KeyProvider subclass');
  }

  /**
   * Lists available versions of a key.
   * @param {string} keyId - Key identifier
   * @returns {Promise<Array<{ version: string, status: string, createdAt: Date }>>}
   */
  async listVersions(keyId) {
    throw new Error('listVersions() must be implemented by KeyProvider subclass');
  }

  /**
   * Checks connectivity and operational status of the KMS/HSM.
   * @returns {Promise<{ status: 'HEALTHY'|'DEGRADED'|'UNHEALTHY', provider: string, latencyMs: number }>}
   */
  async health() {
    throw new Error('health() must be implemented by KeyProvider subclass');
  }

  /**
   * Deterministically canonicalizes context object into sorted JSON string for AAD.
   * Guarantees identical AAD generation regardless of JavaScript object key ordering.
   * @param {Object} context
   * @returns {Buffer} Canonical UTF-8 buffer
   */
  canonicalizeContext(context = {}) {
    if (!context || typeof context !== 'object') {
      return Buffer.from('');
    }
    const sortedKeys = Object.keys(context).sort();
    const sortedObj = {};
    for (const k of sortedKeys) {
      if (context[k] !== undefined) {
        sortedObj[k] = String(context[k]);
      }
    }
    return Buffer.from(JSON.stringify(sortedObj), 'utf8');
  }

  /**
   * Executes an asynchronous operation wrapped with circuit breaker and timeout enforcement.
   * Maps internal exceptions to standard KMS_UNAVAILABLE (503).
   * @param {string} operationName
   * @param {Function} fn
   * @returns {Promise<any>}
   */
  async execute(operationName, fn) {
    const now = Date.now();

    // Check circuit breaker state
    if (this.circuitState === 'OPEN') {
      if (now - this.lastFailureTime > this.recoveryTimeoutMs) {
        this.circuitState = 'HALF_OPEN';
      } else {
        const err = new Error(`KMS circuit breaker is OPEN for [${operationName}]. Service temporarily unavailable.`);
        err.status = 503;
        err.code = 'KMS_UNAVAILABLE';
        throw err;
      }
    }

    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const err = new Error(`KMS operation [${operationName}] timed out after ${this.timeoutMs}ms`);
        err.status = 503;
        err.code = 'KMS_UNAVAILABLE';
        reject(err);
      }, this.timeoutMs);
    });

    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      clearTimeout(timeoutHandle);

      // Successful operation resets circuit breaker
      this.consecutiveFailures = 0;
      this.circuitState = 'CLOSED';
      return result;
    } catch (err) {
      clearTimeout(timeoutHandle);
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();

      if (this.consecutiveFailures >= this.failureThreshold) {
        this.circuitState = 'OPEN';
      }

      // If already mapped to 503/400 (e.g. authentication/context verification mismatch), rethrow
      if (err.status && err.code) {
        throw err;
      }

      // Wrap unknown or network/hardware errors as KMS_UNAVAILABLE
      const sanitizedMsg = this.sanitizeErrorMessage(err.message || 'KMS provider communication error');
      const kmsErr = new Error(`KMS provider error during [${operationName}]: ${sanitizedMsg}`);
      kmsErr.status = 503;
      kmsErr.code = 'KMS_UNAVAILABLE';
      throw kmsErr;
    }
  }

  /**
   * Sanitizes error message to guarantee no key material, hex dumps, or PINs leak.
   * @param {string} msg
   * @returns {string}
   */
  sanitizeErrorMessage(msg) {
    if (!msg || typeof msg !== 'string') return 'Unknown KMS failure';
    return msg
      .replace(/pin\s*[:=]\s*[^\s,]+/gi, 'pin=***')
      .replace(/key\s*[:=]\s*[^\s,]+/gi, 'key=***')
      .replace(/[0-9a-fA-F]{64,}/g, '[REDACTED_HEX_KEY]');
  }
}

module.exports = KeyProvider;
