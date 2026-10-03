'use strict';

/**
 * services/kms/LocalProvider.js
 * Sprint 16A: Local Software-Based KeyProvider (Development & Local Test Only)
 *
 * Implements AES-256-GCM envelope encryption with context bound as Additional
 * Authenticated Data (AAD), ECDSA P-256 asymmetric signing, versioned key rings,
 * and key rotation.
 */

const crypto = require('crypto');
const KeyProvider = require('./KeyProvider');

class LocalProvider extends KeyProvider {
  constructor(options = {}) {
    super(options);
    this.name = 'local';

    // Key rings indexed by keyId: { currentVersion: 'v1', versions: { 'v1': { keyMaterial, createdAt, status } } }
    this.symmetricKeyRings = new Map();
    this.asymmetricKeyRings = new Map();

    // Initialize default master keys from environment or deterministic seed if provided
    this._initializeDefaultKeys();
  }

  _initializeDefaultKeys() {
    // 1. Storage KEK (Symmetric AES-256)
    let masterKeyBuf;
    if (process.env.STORAGE_MASTER_KEY) {
      try {
        masterKeyBuf = Buffer.from(process.env.STORAGE_MASTER_KEY, 'base64');
        if (masterKeyBuf.length !== 32) {
          masterKeyBuf = crypto.createHash('sha256').update(process.env.STORAGE_MASTER_KEY).digest();
        }
      } catch (_) {
        masterKeyBuf = crypto.randomBytes(32);
      }
    } else {
      masterKeyBuf = crypto.randomBytes(32);
    }

    this.symmetricKeyRings.set('STORAGE_KEK', {
      currentVersion: 'v1',
      versions: {
        'v1': {
          keyMaterial: masterKeyBuf,
          createdAt: new Date(),
          status: 'ACTIVE'
        }
      }
    });

    // 2. JWT_KEY (Asymmetric ECDSA P-256)
    const jwtKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.asymmetricKeyRings.set('JWT_KEY', {
      currentVersion: 'v1',
      versions: {
        'v1': {
          privateKey: jwtKeyPair.privateKey,
          publicKey: jwtKeyPair.publicKey,
          createdAt: new Date(),
          status: 'ACTIVE'
        }
      }
    });

    // 3. NOTARY_KEY (Asymmetric ECDSA P-256 for checkpoint signing)
    const notaryKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.asymmetricKeyRings.set('NOTARY_KEY', {
      currentVersion: 'v1',
      versions: {
        'v1': {
          privateKey: notaryKeyPair.privateKey,
          publicKey: notaryKeyPair.publicKey,
          createdAt: new Date(),
          status: 'ACTIVE'
        }
      }
    });
  }

  _getOrCreateSymmetricKey(keyId) {
    if (!this.symmetricKeyRings.has(keyId)) {
      const newKey = crypto.randomBytes(32);
      this.symmetricKeyRings.set(keyId, {
        currentVersion: 'v1',
        versions: {
          'v1': {
            keyMaterial: newKey,
            createdAt: new Date(),
            status: 'ACTIVE'
          }
        }
      });
    }
    return this.symmetricKeyRings.get(keyId);
  }

  _getOrCreateAsymmetricKey(keyId) {
    if (!this.asymmetricKeyRings.has(keyId)) {
      const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      this.asymmetricKeyRings.set(keyId, {
        currentVersion: 'v1',
        versions: {
          'v1': {
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
            createdAt: new Date(),
            status: 'ACTIVE'
          }
        }
      });
    }
    return this.asymmetricKeyRings.get(keyId);
  }

  /**
   * Encrypts plaintext data key with AES-256-GCM, binding context as AAD.
   */
  async wrap(keyId, plaintext, context = {}) {
    return this.execute('wrap', async () => {
      const ring = this._getOrCreateSymmetricKey(keyId);
      const activeVersion = ring.currentVersion;
      const keyEntry = ring.versions[activeVersion];

      if (!keyEntry || keyEntry.status !== 'ACTIVE') {
        const err = new Error(`Key [${keyId}] version [${activeVersion}] is not active`);
        err.status = 400;
        err.code = 'KEY_INACTIVE';
        throw err;
      }

      const plaintextBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
      const iv = crypto.randomBytes(12); // Standard 96-bit nonce for GCM
      const cipher = crypto.createCipheriv('aes-256-gcm', keyEntry.keyMaterial, iv);

      // Bind contextual AAD
      const aad = this.canonicalizeContext(context);
      if (aad.length > 0) {
        cipher.setAAD(aad);
      }

      const ciphertext = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const wrappedPayload = {
        version: activeVersion,
        keyId,
        alg: 'AES-256-GCM',
        iv: iv.toString('base64'),
        tag: authTag.toString('base64'),
        ciphertext: ciphertext.toString('base64')
      };

      // Serialized string format: eg-kms:v1:<base64-json>
      const serialized = `eg-kms:${activeVersion}:${Buffer.from(JSON.stringify(wrappedPayload)).toString('base64')}`;

      return {
        wrappedKey: serialized,
        keyId,
        version: activeVersion,
        algorithm: 'AES-256-GCM'
      };
    });
  }

  /**
   * Decrypts wrapped key validating contextual AAD and authentication tag.
   */
  async unwrap(keyId, wrapped, context = {}) {
    return this.execute('unwrap', async () => {
      let payload;
      if (typeof wrapped === 'string') {
        if (wrapped.startsWith('eg-kms:')) {
          const parts = wrapped.split(':');
          const jsonStr = Buffer.from(parts[2], 'base64').toString('utf8');
          payload = JSON.parse(jsonStr);
        } else {
          try {
            payload = JSON.parse(wrapped);
          } catch (_) {
            payload = JSON.parse(Buffer.from(wrapped, 'base64').toString('utf8'));
          }
        }
      } else if (typeof wrapped === 'object') {
        payload = wrapped;
      } else {
        const err = new Error('Invalid wrapped key payload format');
        err.status = 400;
        err.code = 'INVALID_PAYLOAD';
        throw err;
      }

      const targetKeyId = payload.keyId || keyId;
      const targetVersion = payload.version || 'v1';

      const ring = this.symmetricKeyRings.get(targetKeyId);
      if (!ring || !ring.versions[targetVersion]) {
        const err = new Error(`Key [${targetKeyId}] version [${targetVersion}] not found in KMS ring`);
        err.status = 404;
        err.code = 'KEY_NOT_FOUND';
        throw err;
      }

      const keyEntry = ring.versions[targetVersion];
      if (keyEntry.status === 'DISABLED') {
        const err = new Error(`Key version [${targetVersion}] has been disabled`);
        err.status = 400;
        err.code = 'KEY_DISABLED';
        throw err;
      }

      try {
        const iv = Buffer.from(payload.iv, 'base64');
        const authTag = Buffer.from(payload.tag, 'base64');
        const ciphertext = Buffer.from(payload.ciphertext, 'base64');

        const decipher = crypto.createDecipheriv('aes-256-gcm', keyEntry.keyMaterial, iv);
        decipher.setAuthTag(authTag);

        // Bind contextual AAD
        const aad = this.canonicalizeContext(context);
        if (aad.length > 0) {
          decipher.setAAD(aad);
        }

        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return plaintext;
      } catch (authErr) {
        // GCM decipher fails if auth tag doesn't match, ciphertext is tampered, or AAD differs
        const err = new Error('Cryptographic unwrap failed: context mismatch or tampered ciphertext');
        err.status = 400;
        err.code = 'AUTHENTICATION_FAILED';
        throw err;
      }
    });
  }

  /**
   * Signs a digest with an asymmetric private key inside the provider.
   */
  async sign(keyId, digest) {
    return this.execute('sign', async () => {
      const ring = this._getOrCreateAsymmetricKey(keyId);
      const activeVersion = ring.currentVersion;
      const keyEntry = ring.versions[activeVersion];

      const digestBuf = Buffer.isBuffer(digest) ? digest : Buffer.from(digest, 'utf8');

      // ECDSA P-256 signature in IEEE P1363 format (64 bytes: r || s)
      const signature = crypto.sign(null, digestBuf, {
        key: keyEntry.privateKey,
        dsaEncoding: 'ieee-p1363'
      });

      return {
        signature: signature.toString('base64'),
        algorithm: 'ES256',
        keyId,
        version: activeVersion
      };
    });
  }

  /**
   * Exports the public key for an asymmetric key pair.
   */
  async getPublicKey(keyId, version) {
    return this.execute('getPublicKey', async () => {
      const ring = this._getOrCreateAsymmetricKey(keyId);
      const targetVersion = version || ring.currentVersion;
      const keyEntry = ring.versions[targetVersion];

      if (!keyEntry) {
        const err = new Error(`Key [${keyId}] version [${targetVersion}] not found`);
        err.status = 404;
        err.code = 'KEY_NOT_FOUND';
        throw err;
      }

      const publicKeyPem = keyEntry.publicKey.export({ type: 'spki', format: 'pem' });
      const publicKeyJwk = keyEntry.publicKey.export({ format: 'jwk' });

      return {
        publicKeyPem,
        publicKeyJwk,
        algorithm: 'ES256',
        keyId,
        version: targetVersion
      };
    });
  }

  /**
   * Computes an HMAC over data using a symmetric key.
   */
  async hmac(keyId, data) {
    return this.execute('hmac', async () => {
      const ring = this._getOrCreateSymmetricKey(keyId);
      const activeVersion = ring.currentVersion;
      const keyEntry = ring.versions[activeVersion];

      const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      const hmac = crypto.createHmac('sha256', keyEntry.keyMaterial);
      hmac.update(dataBuf);
      return hmac.digest('hex');
    });
  }

  /**
   * Rotates a key to a new version.
   */
  async rotate(keyId) {
    return this.execute('rotate', async () => {
      if (this.symmetricKeyRings.has(keyId)) {
        const ring = this.symmetricKeyRings.get(keyId);
        const oldVersion = ring.currentVersion;
        const oldVersionNum = parseInt(oldVersion.replace('v', ''), 10) || 1;
        const newVersion = `v${oldVersionNum + 1}`;

        const newKeyMaterial = crypto.randomBytes(32);
        ring.versions[newVersion] = {
          keyMaterial: newKeyMaterial,
          createdAt: new Date(),
          status: 'ACTIVE'
        };
        ring.currentVersion = newVersion;

        return {
          keyId,
          newVersion,
          previousVersion: oldVersion
        };
      }

      if (this.asymmetricKeyRings.has(keyId)) {
        const ring = this.asymmetricKeyRings.get(keyId);
        const oldVersion = ring.currentVersion;
        const oldVersionNum = parseInt(oldVersion.replace('v', ''), 10) || 1;
        const newVersion = `v${oldVersionNum + 1}`;

        const newKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        ring.versions[newVersion] = {
          privateKey: newKeyPair.privateKey,
          publicKey: newKeyPair.publicKey,
          createdAt: new Date(),
          status: 'ACTIVE'
        };
        ring.currentVersion = newVersion;

        return {
          keyId,
          newVersion,
          previousVersion: oldVersion
        };
      }

      // If key doesn't exist yet, create initial
      this._getOrCreateSymmetricKey(keyId);
      return this.rotate(keyId);
    });
  }

  /**
   * Lists all versions of a key.
   */
  async listVersions(keyId) {
    return this.execute('listVersions', async () => {
      const ring = this.symmetricKeyRings.get(keyId) || this.asymmetricKeyRings.get(keyId);
      if (!ring) {
        return [];
      }

      return Object.entries(ring.versions).map(([version, entry]) => ({
        version,
        isCurrent: version === ring.currentVersion,
        status: entry.status,
        createdAt: entry.createdAt
      }));
    });
  }

  /**
   * Health check with latency measurement.
   */
  async health() {
    const start = Date.now();
    try {
      // Test rapid internal encryption round trip
      const testNonce = crypto.randomBytes(16);
      const testKey = crypto.randomBytes(32);
      const cipher = crypto.createCipheriv('aes-256-gcm', testKey, crypto.randomBytes(12));
      cipher.update(testNonce);
      cipher.final();

      const latencyMs = Date.now() - start;
      return {
        status: this.circuitState === 'OPEN' ? 'DEGRADED' : 'HEALTHY',
        provider: 'local',
        circuitState: this.circuitState,
        latencyMs,
        details: {
          symmetricKeysManaged: this.symmetricKeyRings.size,
          asymmetricKeysManaged: this.asymmetricKeyRings.size,
          productionAllowed: process.env.ALLOW_LOCAL_KMS === 'true'
        }
      };
    } catch (err) {
      return {
        status: 'UNHEALTHY',
        provider: 'local',
        circuitState: this.circuitState,
        latencyMs: Date.now() - start,
        error: this.sanitizeErrorMessage(err.message)
      };
    }
  }
}

module.exports = LocalProvider;
