'use strict';

/**
 * storage/keyWrapper.js
 * Sprint 16B – Envelope Encryption Key Wrapper with KMS Integration
 *
 * Wraps and unwraps 256-bit Data Encryption Keys (DEKs).
 *
 * Modes:
 *  - KMS mode  (KMS_PROVIDER != 'local' OR STORAGE_USE_KMS=true):
 *      Uses services/kms KeyProvider.wrap() / .unwrap() with contextual AAD
 *      (evidenceId, orgId) bound as Additional Authenticated Data.
 *  - Legacy mode (backwards-compatible):
 *      Direct AES-256-GCM with STORAGE_MASTER_KEY.
 *      Still used in dev and when upgrading incrementally.
 *
 * Security:
 *  - Key material is NEVER logged.
 *  - Sprint 16 wrapped format prefix: 'eg-kms:' or 'eg-hsm:'
 *  - Legacy format is auto-detected on unwrap for backwards compatibility.
 */

const crypto = require('crypto');

// ── Legacy Software KeyWrapper (used when KMS is not active) ──────────────────

class KeyWrapper {
  constructor(masterKeyBase64, kekId = 'master-v1') {
    this.kekId = kekId;
    this._masterKey = this._validateAndLoadKey(masterKeyBase64);
  }

  _validateAndLoadKey(keyBase64) {
    if (!keyBase64 || typeof keyBase64 !== 'string') {
      const err = new Error('STORAGE_MASTER_KEY is required when storage encryption is enabled.');
      err.code = 'INVALID_MASTER_KEY';
      throw err;
    }

    let keyBuf;
    try {
      keyBuf = Buffer.from(keyBase64, 'base64');
    } catch (_) {
      const err = new Error('STORAGE_MASTER_KEY must be a valid base64-encoded string.');
      err.code = 'INVALID_MASTER_KEY';
      throw err;
    }

    if (keyBuf.length !== 32) {
      const err = new Error(`STORAGE_MASTER_KEY must decode to exactly 32 bytes (got ${keyBuf.length} bytes).`);
      err.code = 'INVALID_MASTER_KEY_LENGTH';
      throw err;
    }

    return keyBuf;
  }

  getKekId() {
    return this.kekId;
  }

  /**
   * Wraps a 256-bit DEK using AES-256-GCM.
   * Format: IV (12B) + AuthTag (16B) + Ciphertext (32B) → Base64
   */
  wrapKey(dekBuffer) {
    if (!Buffer.isBuffer(dekBuffer) || dekBuffer.length !== 32) {
      throw new Error('DEK to wrap must be a 32-byte Buffer');
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._masterKey, iv);
    cipher.setAAD(Buffer.from(this.kekId, 'utf8'));

    const ciphertext = Buffer.concat([cipher.update(dekBuffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    const packed = Buffer.concat([iv, tag, ciphertext]);
    return packed.toString('base64');
  }

  /**
   * Unwraps a legacy-format wrapped DEK.
   * Returns original 32-byte DEK Buffer.
   */
  unwrapKey(wrappedDekBase64) {
    if (!wrappedDekBase64 || typeof wrappedDekBase64 !== 'string') {
      throw new Error('wrappedDek must be a valid base64 string');
    }

    const packed = Buffer.from(wrappedDekBase64, 'base64');
    if (packed.length < 28) {
      throw new Error('Invalid wrapped DEK payload length');
    }

    const iv         = packed.subarray(0, 12);
    const tag        = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this._masterKey, iv);
    decipher.setAAD(Buffer.from(this.kekId, 'utf8'));
    decipher.setAuthTag(tag);

    try {
      const dek = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (dek.length !== 32) throw new Error('Unwrapped DEK length mismatch');
      return dek;
    } catch (err) {
      throw new Error('Failed to unwrap DEK: authentication verification failed or key is invalid');
    }
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `[KeyWrapper: kekId=${this.kekId}, key=[REDACTED]]`;
  }

  toJSON() {
    return { kekId: this.kekId, status: 'CONFIGURED' };
  }
}

// ── KMS-backed KeyWrapper (Sprint 16B) ────────────────────────────────────────

/**
 * KmsKeyWrapper: async wrap/unwrap delegated to the active KeyProvider.
 * Contextual AAD (evidenceId, orgId) is passed through on each call.
 */
class KmsKeyWrapper {
  constructor(provider, kekId = 'STORAGE_KEK') {
    this._provider = provider;
    this._kekId    = kekId;
  }

  getKekId() {
    return this._kekId;
  }

  /**
   * Async: wraps a DEK using the KMS provider with optional context binding.
   * @param {Buffer} dekBuffer - 32-byte DEK
   * @param {Object} [context] - { evidenceId, orgId } bound as AAD
   * @returns {Promise<string>} Serialized wrapped key string
   */
  async wrapKey(dekBuffer, context = {}) {
    const result = await this._provider.wrap(this._kekId, dekBuffer, context);
    return result.wrappedKey;
  }

  /**
   * Async: unwraps a KMS-wrapped DEK.
   * @param {string} wrappedKey
   * @param {Object} [context] - Must match the context used at wrap time
   * @returns {Promise<Buffer>} Plaintext 32-byte DEK
   */
  async unwrapKey(wrappedKey, context = {}) {
    return this._provider.unwrap(this._kekId, wrappedKey, context);
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `[KmsKeyWrapper: kekId=${this._kekId}, provider=${this._provider.name || 'kms'}]`;
  }

  toJSON() {
    return { kekId: this._kekId, provider: this._provider.name || 'kms', status: 'CONFIGURED' };
  }
}

// ── Singleton Factory ─────────────────────────────────────────────────────────

let _defaultWrapper = null;

/**
 * Returns the configured key wrapper singleton.
 *
 * If KMS is active (KMS_PROVIDER is set to something other than 'local',
 * or STORAGE_USE_KMS=true), returns a KmsKeyWrapper backed by the KMS provider.
 * Otherwise falls back to the legacy software KeyWrapper using STORAGE_MASTER_KEY.
 *
 * NOTE: KmsKeyWrapper.wrapKey / unwrapKey are ASYNC.
 * Callers must await them. The legacy KeyWrapper.wrapKey / unwrapKey are sync.
 * storageService.js detects KMS mode via isKmsMode() and awaits accordingly.
 */
function getKeyWrapper() {
  if (_defaultWrapper) return _defaultWrapper;

  const providerName  = (process.env.KMS_PROVIDER || 'local').toLowerCase();
  const useKms        = providerName !== 'local' || process.env.STORAGE_USE_KMS === 'true';

  if (useKms) {
    const { getKeyProvider } = require('../services/kms/index');
    const provider = getKeyProvider();
    _defaultWrapper = new KmsKeyWrapper(provider, process.env.STORAGE_KEK_ID || 'STORAGE_KEK');
  } else {
    const masterKey = process.env.STORAGE_MASTER_KEY;
    const kekId     = process.env.STORAGE_KEK_ID || 'master-v1';
    _defaultWrapper = new KeyWrapper(masterKey, kekId);
  }

  return _defaultWrapper;
}

/**
 * Returns true when the KMS-backed async wrapper is active.
 */
function isKmsMode() {
  const providerName = (process.env.KMS_PROVIDER || 'local').toLowerCase();
  return providerName !== 'local' || process.env.STORAGE_USE_KMS === 'true';
}

function resetKeyWrapper() {
  _defaultWrapper = null;
}

module.exports = {
  KeyWrapper,
  KmsKeyWrapper,
  getKeyWrapper,
  isKmsMode,
  resetKeyWrapper
};
