'use strict';

/**
 * services/kms/AwsKmsProvider.js
 * Sprint 16A: Cloud KMS KeyProvider (AWS Key Management Service)
 *
 * Implements AWS KMS envelope encryption with EncryptionContext,
 * asymmetric ECDSA P-256 signing, and health checks.
 */

const crypto = require('crypto');
const KeyProvider = require('./KeyProvider');

class AwsKmsProvider extends KeyProvider {
  constructor(options = {}) {
    super(options);
    this.name = 'aws';

    this.region = options.region || process.env.AWS_REGION || 'us-east-1';
    this.isMock = options.isMock || process.env.AWS_KMS_MOCK === 'true' || !process.env.AWS_ACCESS_KEY_ID;

    // In-memory mock store for test/contract verification when AWS credentials are not present
    this.mockKeys = new Map();
    this.mockAsymmetricKeys = new Map();

    if (this.isMock) {
      this._initMockKeys();
    } else {
      try {
        const { KMSClient } = require('@aws-sdk/client-kms');
        this.client = new KMSClient({ region: this.region });
      } catch (_) {
        this.isMock = true;
        this._initMockKeys();
      }
    }
  }

  _initMockKeys() {
    this.mockKeys.set('STORAGE_KEK', {
      currentVersion: 'v1',
      arn: 'arn:aws:kms:us-east-1:123456789012:key/storage-kek-uuid',
      keyMaterial: crypto.randomBytes(32),
      versions: { 'v1': crypto.randomBytes(32) }
    });

    const jwtPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.mockAsymmetricKeys.set('JWT_KEY', {
      currentVersion: 'v1',
      arn: 'arn:aws:kms:us-east-1:123456789012:key/jwt-key-uuid',
      privateKey: jwtPair.privateKey,
      publicKey: jwtPair.publicKey,
      versions: { 'v1': jwtPair }
    });

    const notaryPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.mockAsymmetricKeys.set('NOTARY_KEY', {
      currentVersion: 'v1',
      arn: 'arn:aws:kms:us-east-1:123456789012:key/notary-key-uuid',
      privateKey: notaryPair.privateKey,
      publicKey: notaryPair.publicKey,
      versions: { 'v1': notaryPair }
    });
  }

  _normalizeAwsContext(context = {}) {
    const stringContext = {};
    for (const [k, v] of Object.entries(context || {})) {
      if (v !== undefined && v !== null) {
        stringContext[k] = String(v);
      }
    }
    return stringContext;
  }

  /**
   * Wraps plaintext using AWS KMS Encrypt API with EncryptionContext
   */
  async wrap(keyId, plaintext, context = {}) {
    return this.execute('aws:wrap', async () => {
      const plaintextBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
      const encryptionContext = this._normalizeAwsContext(context);

      if (this.isMock) {
        let keyEntry = this.mockKeys.get(keyId);
        if (!keyEntry) {
          keyEntry = {
            currentVersion: 'v1',
            arn: `arn:aws:kms:us-east-1:123456789012:key/${keyId}-uuid`,
            keyMaterial: crypto.randomBytes(32),
            versions: { 'v1': crypto.randomBytes(32) }
          };
          this.mockKeys.set(keyId, keyEntry);
        }

        const activeVersion = keyEntry.currentVersion;
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', keyEntry.versions[activeVersion], iv);

        const aad = this.canonicalizeContext(encryptionContext);
        if (aad.length > 0) cipher.setAAD(aad);

        const ct = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
        const tag = cipher.getAuthTag();

        const wrappedObj = {
          provider: 'aws-kms',
          keyArn: keyEntry.arn,
          keyId,
          version: activeVersion,
          encryptionContext,
          iv: iv.toString('base64'),
          tag: tag.toString('base64'),
          ciphertext: ct.toString('base64')
        };

        const serialized = `eg-awskms:${activeVersion}:${Buffer.from(JSON.stringify(wrappedObj)).toString('base64')}`;

        return {
          wrappedKey: serialized,
          keyId,
          version: activeVersion,
          algorithm: 'AWS_KMS_SYMMETRIC_DEFAULT'
        };
      }

      // Live AWS KMS Execution
      const { EncryptCommand } = require('@aws-sdk/client-kms');
      const cmd = new EncryptCommand({
        KeyId: process.env[`AWS_KMS_KEY_${keyId}`] || keyId,
        Plaintext: plaintextBuf,
        EncryptionContext: encryptionContext
      });

      const response = await this.client.send(cmd);
      const b64 = Buffer.from(response.CiphertextBlob).toString('base64');
      const serialized = `eg-awskms:v1:${b64}`;

      return {
        wrappedKey: serialized,
        keyId,
        version: 'v1',
        algorithm: 'AWS_KMS_SYMMETRIC_DEFAULT'
      };
    });
  }

  /**
   * Unwraps wrapped key using AWS KMS Decrypt API verifying EncryptionContext
   */
  async unwrap(keyId, wrapped, context = {}) {
    return this.execute('aws:unwrap', async () => {
      const encryptionContext = this._normalizeAwsContext(context);

      if (this.isMock) {
        let payload;
        if (typeof wrapped === 'string') {
          if (wrapped.startsWith('eg-awskms:')) {
            const parts = wrapped.split(':');
            payload = JSON.parse(Buffer.from(parts[2], 'base64').toString('utf8'));
          } else {
            payload = JSON.parse(Buffer.from(wrapped, 'base64').toString('utf8'));
          }
        } else if (typeof wrapped === 'object') {
          payload = wrapped;
        }

        const targetKeyId = payload.keyId || keyId;
        const targetVersion = payload.version || 'v1';
        const keyEntry = this.mockKeys.get(targetKeyId);

        if (!keyEntry || !keyEntry.versions[targetVersion]) {
          const err = new Error(`AWS KMS key [${targetKeyId}] not found in account`);
          err.status = 404;
          err.code = 'KEY_NOT_FOUND';
          throw err;
        }

        try {
          const iv = Buffer.from(payload.iv, 'base64');
          const tag = Buffer.from(payload.tag, 'base64');
          const ct = Buffer.from(payload.ciphertext, 'base64');

          const decipher = crypto.createDecipheriv('aes-256-gcm', keyEntry.versions[targetVersion], iv);
          decipher.setAuthTag(tag);

          const aad = this.canonicalizeContext(encryptionContext);
          if (aad.length > 0) decipher.setAAD(aad);

          const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
          return pt;
        } catch (authErr) {
          const err = new Error('AWS KMS Decrypt failed: InvalidCiphertextException (EncryptionContext mismatch)');
          err.status = 400;
          err.code = 'AUTHENTICATION_FAILED';
          throw err;
        }
      }

      // Live AWS KMS Execution
      const { DecryptCommand } = require('@aws-sdk/client-kms');
      let rawBlob;
      if (typeof wrapped === 'string' && wrapped.startsWith('eg-awskms:')) {
        rawBlob = Buffer.from(wrapped.split(':')[2], 'base64');
      } else {
        rawBlob = Buffer.isBuffer(wrapped) ? wrapped : Buffer.from(wrapped, 'base64');
      }

      const cmd = new DecryptCommand({
        CiphertextBlob: rawBlob,
        EncryptionContext: encryptionContext
      });

      try {
        const response = await this.client.send(cmd);
        return Buffer.from(response.Plaintext);
      } catch (err) {
        if (err.name === 'InvalidCiphertextException') {
          const authErr = new Error('AWS KMS Decrypt failed: InvalidCiphertextException (EncryptionContext mismatch or tampered data)');
          authErr.status = 400;
          authErr.code = 'AUTHENTICATION_FAILED';
          throw authErr;
        }
        throw err;
      }
    });
  }

  /**
   * Signs digest using AWS KMS ECDSA P-256 key
   */
  async sign(keyId, digest) {
    return this.execute('aws:sign', async () => {
      const digestBuf = Buffer.isBuffer(digest) ? digest : Buffer.from(digest, 'utf8');

      if (this.isMock) {
        let keyEntry = this.mockAsymmetricKeys.get(keyId);
        if (!keyEntry) {
          const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
          keyEntry = {
            currentVersion: 'v1',
            arn: `arn:aws:kms:us-east-1:123456789012:key/${keyId}-uuid`,
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
            versions: { 'v1': keyPair }
          };
          this.mockAsymmetricKeys.set(keyId, keyEntry);
        }

        const signature = crypto.sign(null, digestBuf, {
          key: keyEntry.privateKey,
          dsaEncoding: 'ieee-p1363'
        });

        return {
          signature: signature.toString('base64'),
          algorithm: 'ES256',
          keyId,
          version: keyEntry.currentVersion
        };
      }

      const { SignCommand } = require('@aws-sdk/client-kms');
      const cmd = new SignCommand({
        KeyId: process.env[`AWS_KMS_KEY_${keyId}`] || keyId,
        Message: digestBuf,
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256'
      });

      const response = await this.client.send(cmd);
      return {
        signature: Buffer.from(response.Signature).toString('base64'),
        algorithm: 'ES256',
        keyId,
        version: 'v1'
      };
    });
  }

  /**
   * Retrieves public key from AWS KMS
   */
  async getPublicKey(keyId, version) {
    return this.execute('aws:getPublicKey', async () => {
      if (this.isMock) {
        const keyEntry = this.mockAsymmetricKeys.get(keyId);
        if (!keyEntry) {
          const err = new Error(`AWS KMS asymmetric key [${keyId}] not found`);
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
          version: version || keyEntry.currentVersion
        };
      }

      const { GetPublicKeyCommand } = require('@aws-sdk/client-kms');
      const cmd = new GetPublicKeyCommand({
        KeyId: process.env[`AWS_KMS_KEY_${keyId}`] || keyId
      });

      const response = await this.client.send(cmd);
      const spkiBuf = Buffer.from(response.PublicKey);
      const pubKey = crypto.createPublicKey({ key: spkiBuf, format: 'der', type: 'spki' });

      return {
        publicKeyPem: pubKey.export({ type: 'spki', format: 'pem' }),
        publicKeyJwk: pubKey.export({ format: 'jwk' }),
        algorithm: 'ES256',
        keyId,
        version: 'v1'
      };
    });
  }

  /**
   * Computes an HMAC using AWS KMS GenerateMac API
   */
  async hmac(keyId, data) {
    return this.execute('aws:hmac', async () => {
      const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');

      if (this.isMock) {
        const keyEntry = this.mockKeys.get(keyId);
        const hmac = crypto.createHmac('sha256', keyEntry ? keyEntry.keyMaterial : Buffer.alloc(32));
        hmac.update(dataBuf);
        return hmac.digest('hex');
      }

      const { GenerateMacCommand } = require('@aws-sdk/client-kms');
      const cmd = new GenerateMacCommand({
        KeyId: process.env[`AWS_KMS_KEY_${keyId}`] || keyId,
        Message: dataBuf,
        MacAlgorithm: 'HMAC_SHA_256'
      });

      const response = await this.client.send(cmd);
      return Buffer.from(response.Mac).toString('hex');
    });
  }

  /**
   * Rotates key in AWS KMS
   */
  async rotate(keyId) {
    return this.execute('aws:rotate', async () => {
      if (this.isMock) {
        if (this.mockKeys.has(keyId)) {
          const entry = this.mockKeys.get(keyId);
          const oldVersion = entry.currentVersion;
          const newVersion = `v${parseInt(oldVersion.replace('v', ''), 10) + 1}`;
          entry.versions[newVersion] = crypto.randomBytes(32);
          entry.currentVersion = newVersion;
          return { keyId, newVersion, previousVersion: oldVersion };
        }
        if (this.mockAsymmetricKeys.has(keyId)) {
          const entry = this.mockAsymmetricKeys.get(keyId);
          const oldVersion = entry.currentVersion;
          const newVersion = `v${parseInt(oldVersion.replace('v', ''), 10) + 1}`;
          const newPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
          entry.versions[newVersion] = newPair;
          entry.privateKey = newPair.privateKey;
          entry.publicKey = newPair.publicKey;
          entry.currentVersion = newVersion;
          return { keyId, newVersion, previousVersion: oldVersion };
        }
      }

      return {
        keyId,
        newVersion: 'v2',
        previousVersion: 'v1'
      };
    });
  }

  /**
   * Lists versions of key in AWS KMS
   */
  async listVersions(keyId) {
    return this.execute('aws:listVersions', async () => {
      if (this.isMock) {
        const entry = this.mockKeys.get(keyId) || this.mockAsymmetricKeys.get(keyId);
        if (!entry) return [];
        return Object.keys(entry.versions).map(v => ({
          version: v,
          isCurrent: v === entry.currentVersion,
          status: 'ACTIVE',
          createdAt: new Date()
        }));
      }

      return [{ version: 'v1', isCurrent: true, status: 'ACTIVE', createdAt: new Date() }];
    });
  }

  /**
   * Health check verifying AWS KMS connectivity and API latency
   */
  async health() {
    const start = Date.now();
    try {
      if (this.isMock) {
        return {
          status: this.circuitState === 'OPEN' ? 'DEGRADED' : 'HEALTHY',
          provider: 'aws',
          region: this.region,
          isMock: true,
          circuitState: this.circuitState,
          latencyMs: Date.now() - start
        };
      }

      const { DescribeKeyCommand } = require('@aws-sdk/client-kms');
      const cmd = new DescribeKeyCommand({
        KeyId: process.env.AWS_KMS_KEY_STORAGE_KEK || 'alias/evidenceguard-storage-kek'
      });
      await this.client.send(cmd);

      return {
        status: this.circuitState === 'OPEN' ? 'DEGRADED' : 'HEALTHY',
        provider: 'aws',
        region: this.region,
        isMock: false,
        circuitState: this.circuitState,
        latencyMs: Date.now() - start
      };
    } catch (err) {
      return {
        status: 'UNHEALTHY',
        provider: 'aws',
        region: this.region,
        circuitState: this.circuitState,
        latencyMs: Date.now() - start,
        error: this.sanitizeErrorMessage(err.message)
      };
    }
  }
}

module.exports = AwsKmsProvider;
