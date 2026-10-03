'use strict';

/**
 * storage/keyWrapper.js
 * Sprint 11A – Envelope Encryption Master Key Wrapper (KeyWrapper Interface)
 *
 * Wraps and unwraps 256-bit Data Encryption Keys (DEKs) using the 256-bit master key
 * specified via STORAGE_MASTER_KEY (base64 encoded).
 *
 * Security:
 * - Master key MUST be exactly 32 bytes (256 bits).
 * - Startup validation throws if invalid.
 * - Key data and wrapped keys are NEVER logged.
 * - Ready to be swapped with AWS KMS / GCP Cloud KMS in Sprint 16.
 */

const crypto = require('crypto');

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
   * Wraps a 256-bit Data Encryption Key (DEK)
   * Format: IV (12B) + AuthTag (16B) + Ciphertext (32B) -> Base64 string
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
   * Unwraps a wrapped DEK
   * Returns original 32-byte DEK Buffer
   */
  unwrapKey(wrappedDekBase64) {
    if (!wrappedDekBase64 || typeof wrappedDekBase64 !== 'string') {
      throw new Error('wrappedDek must be a valid base64 string');
    }

    const packed = Buffer.from(wrappedDekBase64, 'base64');
    if (packed.length < 28) { // 12 (iv) + 16 (tag) = 28 min
      throw new Error('Invalid wrapped DEK payload length');
    }

    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this._masterKey, iv);
    decipher.setAAD(Buffer.from(this.kekId, 'utf8'));
    decipher.setAuthTag(tag);

    try {
      const dek = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (dek.length !== 32) {
        throw new Error('Unwrapped DEK length mismatch');
      }
      return dek;
    } catch (err) {
      throw new Error('Failed to unwrap DEK: authentication verification failed or key is invalid');
    }
  }

  // Prevent console.log / util.inspect from exposing the key
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `[KeyWrapper: kekId=${this.kekId}, key=[REDACTED]]`;
  }

  toJSON() {
    return { kekId: this.kekId, status: 'CONFIGURED' };
  }
}

let defaultWrapper = null;

function getKeyWrapper() {
  if (!defaultWrapper) {
    const masterKey = process.env.STORAGE_MASTER_KEY;
    const kekId = process.env.STORAGE_KEK_ID || 'master-v1';
    defaultWrapper = new KeyWrapper(masterKey, kekId);
  }
  return defaultWrapper;
}

function resetKeyWrapper() {
  defaultWrapper = null;
}

module.exports = {
  KeyWrapper,
  getKeyWrapper,
  resetKeyWrapper
};
