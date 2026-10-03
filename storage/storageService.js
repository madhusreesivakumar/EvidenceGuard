'use strict';

/**
 * storage/storageService.js
 * Sprint 11A – Storage Service with Envelope Encryption & Pluggable Drivers
 *
 * Pluggable drivers:
 * - 'local' (local disk storage)
 * - 's3' (AWS S3 & MinIO compatible)
 *
 * Envelope Encryption:
 * - Random 256-bit DEK per file
 * - 1 MiB chunked AES-256-GCM streaming
 * - DEK wrapped via KeyWrapper (master key)
 * - Evidence.storage records driver, key, encryption metadata, cipherSize, cipherSha256
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const localDriver = require('./localDriver');
const s3Driver = require('./s3Driver');
const { getKeyWrapper, isKmsMode } = require('./keyWrapper');
const {
  createEncryptStream,
  createDecryptStream,
  DEFAULT_CHUNK_SIZE
} = require('./chunkedEncryption');

function getDriver(driverName) {
  const name = (driverName || process.env.STORAGE_DRIVER || 'local').toLowerCase();
  if (name === 's3') {
    return s3Driver;
  }
  return localDriver;
}

function getCurrentDriverName() {
  return (process.env.STORAGE_DRIVER || 'local').toLowerCase();
}

function isEncryptionEnabled() {
  return process.env.STORAGE_ENCRYPTION === 'true' || process.env.FEATURE_REMOTE_STORAGE === 'true';
}

const sanitizeFilename = (filename) => {
  return (filename || '')
    .replace(/[^\w\.\-\ ]/g, '') // strip control chars and unusual symbols
    .trim()
    .substring(0, 200); // limit length
};

/**
 * Saves a file to storage, optionally applying envelope encryption
 */
async function save(source, storageKey, options = {}) {
  const driverName = options.driver || getCurrentDriverName();
  const driver = getDriver(driverName);
  const shouldEncrypt = options.encrypt !== undefined ? Boolean(options.encrypt) : isEncryptionEnabled();

  if (!shouldEncrypt) {
    const rawResult = await driver.save(source, storageKey, options);
    return {
      storageKey,
      driver: driverName,
      encryption: null,
      size: rawResult.size
    };
  }

  // ── Envelope Encryption Flow ────────────────────────────────────────────────
  const keyWrapper = getKeyWrapper();
  const dek = crypto.randomBytes(32);
  // Context for contextual AAD binding (Sprint 16B): evidenceId and orgId prevent cross-record key transplant
  const wrapContext = {
    ...(options.evidenceId ? { evidenceId: String(options.evidenceId) } : {}),
    ...(options.orgId      ? { orgId: String(options.orgId) }           : {}),
    purpose: 'EVIDENCE_ENVELOPE_DEK'
  };
  const wrappedDek = isKmsMode()
    ? await keyWrapper.wrapKey(dek, wrapContext)
    : keyWrapper.wrapKey(dek);
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;

  // Stream encryption with SHA-256 & byte counting for ciphertext
  let cipherSize = 0;
  const cipherHash = crypto.createHash('sha256');

  const encryptStream = createEncryptStream(dek, { chunkSize });

  const meterStream = new Transform({
    transform(chunk, enc, cb) {
      cipherSize += chunk.length;
      cipherHash.update(chunk);
      this.push(chunk);
      cb();
    }
  });

  if (driverName === 'local') {
    // Stream encrypted data directly to destination file
    const destPath = path.join(path.join(__dirname, '..', 'uploads'), storageKey);
    const writeStream = fs.createWriteStream(destPath);

    let readStream;
    if (typeof source === 'string') {
      readStream = fs.createReadStream(source);
    } else if (Buffer.isBuffer(source)) {
      const { Readable } = require('stream');
      readStream = Readable.from(source);
    } else {
      readStream = source;
    }

    await pipeline(readStream, encryptStream, meterStream, writeStream);

    // Clean up temporary upload file if applicable
    if (typeof source === 'string' && (source.includes('temp') || source.includes('tmp'))) {
      try { await fs.promises.unlink(source); } catch (_) {}
    }
  } else {
    // Remote driver (S3 / MinIO)
    let readStream;
    if (typeof source === 'string') {
      readStream = fs.createReadStream(source);
    } else if (Buffer.isBuffer(source)) {
      const { Readable } = require('stream');
      readStream = Readable.from(source);
    } else {
      readStream = source;
    }

    // Buffer ciphertext stream or pipeline through temporary location if driver requires length
    const tempCipherPath = path.join(path.join(__dirname, '..', 'uploads', 'tmp'), `enc-${storageKey}`);
    const tempWriteStream = fs.createWriteStream(tempCipherPath);

    await pipeline(readStream, encryptStream, meterStream, tempWriteStream);

    await driver.save(tempCipherPath, storageKey, {
      ...options,
      size: cipherSize,
      contentType: 'application/octet-stream'
    });

    try { await fs.promises.unlink(tempCipherPath); } catch (_) {}

    if (typeof source === 'string' && (source.includes('temp') || source.includes('tmp'))) {
      try { await fs.promises.unlink(source); } catch (_) {}
    }
  }

  return {
    storageKey,
    driver: driverName,
    encryption: {
      alg: 'AES-256-GCM',
      kekId: keyWrapper.getKekId(),
      wrappedDek,
      chunkSize
    },
    cipherSize,
    cipherSha256: cipherHash.digest('hex')
  };
}

/**
 * Retrieves a Readable stream of the file, transparently decrypting if encrypted
 */
async function getStream(storageKey, options = {}) {
  const driver = getDriver(options.driver);
  const rawStream = await driver.getStream(storageKey);

  // If encryption metadata is present, wrap raw stream with decryptor
  if (options.encryption && options.encryption.wrappedDek) {
    const keyWrapper = getKeyWrapper();
    const unwrapContext = {
      ...(options.evidenceId ? { evidenceId: String(options.evidenceId) } : {}),
      ...(options.orgId      ? { orgId: String(options.orgId) }           : {}),
      purpose: 'EVIDENCE_ENVELOPE_DEK'
    };
    const dek = isKmsMode()
      ? await keyWrapper.unwrapKey(options.encryption.wrappedDek, unwrapContext)
      : keyWrapper.unwrapKey(options.encryption.wrappedDek);
    const decryptStream = createDecryptStream(dek);
    return rawStream.pipe(decryptStream);
  }

  return rawStream;
}

async function remove(storageKey, options = {}) {
  const driver = getDriver(options.driver);
  return await driver.remove(storageKey);
}

async function exists(storageKey, options = {}) {
  const driver = getDriver(options.driver);
  return await driver.exists(storageKey);
}

async function stat(storageKey, options = {}) {
  const driver = getDriver(options.driver);
  return await driver.stat(storageKey);
}

function getFilePath(storageKey, options = {}) {
  const driver = getDriver(options.driver);
  if (typeof driver.getFilePath === 'function') {
    return driver.getFilePath(storageKey);
  }
  return null;
}

module.exports = {
  save,
  getStream,
  remove,
  exists,
  stat,
  getFilePath,
  getDriver,
  getCurrentDriverName,
  isEncryptionEnabled,
  sanitizeFilename
};
