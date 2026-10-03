'use strict';

/**
 * storage/localDriver.js
 * Sprint 11A – Local Disk Storage Driver
 *
 * Implements standard storage interface:
 * - save(source, storageKey, options)
 * - getStream(storageKey)
 * - remove(storageKey)
 * - exists(storageKey)
 * - stat(storageKey)
 * - getFilePath(storageKey)
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

const save = async (source, storageKey, options = {}) => {
  ensureUploadDir();
  const destPath = path.join(UPLOAD_DIR, storageKey);

  if (typeof source === 'string') {
    // Local file path
    try {
      await fs.promises.copyFile(source, destPath);
      if (source.includes('temp') || source.includes('tmp')) {
        try { await fs.promises.unlink(source); } catch (_) {}
      }
    } catch (err) {
      await fs.promises.rename(source, destPath);
    }
  } else if (Buffer.isBuffer(source)) {
    await fs.promises.writeFile(destPath, source);
  } else if (source && typeof source.pipe === 'function') {
    // Readable stream
    const writeStream = fs.createWriteStream(destPath);
    await pipeline(source, writeStream);
  } else {
    throw new Error('Invalid source provided to localDriver.save');
  }

  const fileStats = await fs.promises.stat(destPath);
  return {
    storageKey,
    size: fileStats.size
  };
};

const getStream = (storageKey) => {
  const filePath = path.join(UPLOAD_DIR, storageKey);
  if (!fs.existsSync(filePath)) {
    const err = new Error(`Object not found in local storage: ${storageKey}`);
    err.code = 'ENOENT';
    throw err;
  }
  return fs.createReadStream(filePath);
};

const remove = async (storageKey) => {
  const filePath = path.join(UPLOAD_DIR, storageKey);
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
};

const exists = async (storageKey) => {
  const filePath = path.join(UPLOAD_DIR, storageKey);
  try {
    await fs.promises.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
};

const stat = async (storageKey) => {
  const filePath = path.join(UPLOAD_DIR, storageKey);
  const s = await fs.promises.stat(filePath);
  return {
    size: s.size,
    lastModified: s.mtime
  };
};

const getFilePath = (storageKey) => {
  return path.join(UPLOAD_DIR, storageKey);
};

module.exports = {
  save,
  getStream,
  remove,
  exists,
  stat,
  getFilePath
};
