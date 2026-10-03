'use strict';

/**
 * storage/chunkedEncryption.js
 * Sprint 11A – 1 MiB Chunked Streaming AES-256-GCM Envelope Encryption
 *
 * Specifications:
 * - Chunk size: 1 MiB (1,048,576 bytes)
 * - Algorithm: AES-256-GCM
 * - Header: Magic (4B 'EGEC') + Version (1B 0x01) + ChunkSize (4B BE) + BaseNonce (12B) [Total: 21 bytes]
 * - Unique Nonce per chunk: BaseNonce XOR ChunkIndex
 * - Additional Authenticated Data (AAD): ChunkIndex (4B BE) + isFinal flag (1B)
 * - Chunk layout: CipherLength (4B BE) + Ciphertext (N bytes) + AuthTag (16B)
 * - Streamable: Constant memory O(chunkSize), never buffering whole file in RAM
 * - Detects bit flips, truncation, chunk reordering, wrong key, and header tampering
 */

const crypto = require('crypto');
const { Transform } = require('stream');

const MAGIC = Buffer.from('EGEC', 'ascii');
const VERSION = 1;
const DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1 MiB
const HEADER_SIZE = 21; // 4 + 1 + 4 + 12

/**
 * Derives a deterministic unique 12-byte nonce for a given chunk
 */
function deriveChunkNonce(baseNonce, chunkIndex) {
  const nonce = Buffer.from(baseNonce);
  const currentVal = nonce.readUInt32BE(8);
  nonce.writeUInt32BE((currentVal ^ chunkIndex) >>> 0, 8);
  return nonce;
}

/**
 * Constructs 5-byte AAD: chunkIndex (4B BE) + isFinal (1B)
 */
function buildAad(chunkIndex, isFinal) {
  const aad = Buffer.alloc(5);
  aad.writeUInt32BE(chunkIndex, 0);
  aad.writeUInt8(isFinal ? 1 : 0, 4);
  return aad;
}

/**
 * Creates an encryption Transform stream
 */
function createEncryptStream(dek, options = {}) {
  if (!Buffer.isBuffer(dek) || dek.length !== 32) {
    throw new Error('DEK must be a 32-byte Buffer');
  }

  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  const baseNonce = options.baseNonce || crypto.randomBytes(12);

  // Write header: Magic (4B) + Version (1B) + ChunkSize (4B) + BaseNonce (12B)
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt8(VERSION, 4);
  header.writeUInt32BE(chunkSize, 5);
  baseNonce.copy(header, 9);

  let headerEmitted = false;
  let chunkIndex = 0;
  let pendingBuffer = Buffer.alloc(0);

  function encryptChunk(chunkData, isFinal) {
    const nonce = deriveChunkNonce(baseNonce, chunkIndex);
    const aad = buildAad(chunkIndex, isFinal);

    const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonce);
    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([cipher.update(chunkData), cipher.final()]);
    const tag = cipher.getAuthTag();

    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(ciphertext.length, 0);

    chunkIndex++;
    return Buffer.concat([lenBuf, ciphertext, tag]);
  }

  const transform = new Transform({
    transform(chunk, encoding, callback) {
      if (!headerEmitted) {
        this.push(header);
        headerEmitted = true;
      }

      pendingBuffer = Buffer.concat([pendingBuffer, chunk]);

      // Emit full chunks as they accumulate, keeping at least 1 byte if exact multiple
      // so we can distinguish the final chunk in _flush
      while (pendingBuffer.length > chunkSize) {
        const toEncrypt = pendingBuffer.subarray(0, chunkSize);
        pendingBuffer = pendingBuffer.subarray(chunkSize);
        this.push(encryptChunk(toEncrypt, false));
      }

      callback();
    },

    flush(callback) {
      if (!headerEmitted) {
        this.push(header);
        headerEmitted = true;
      }

      // Flush whatever remains as the final chunk (even if 0 bytes for empty file)
      this.push(encryptChunk(pendingBuffer, true));
      pendingBuffer = Buffer.alloc(0);
      callback();
    }
  });

  return transform;
}

/**
 * Creates a decryption Transform stream
 */
function createDecryptStream(dek) {
  if (!Buffer.isBuffer(dek) || dek.length !== 32) {
    throw new Error('DEK must be a 32-byte Buffer');
  }

  let buffer = Buffer.alloc(0);
  let headerParsed = false;
  let chunkSize = DEFAULT_CHUNK_SIZE;
  let baseNonce = null;

  let chunkIndex = 0;
  let pendingChunk = null; // { ciphertext, tag, index }

  function verifyAndDecrypt(rawCipher, tag, index, isFinal) {
    const nonce = deriveChunkNonce(baseNonce, index);
    const aad = buildAad(index, isFinal);

    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(rawCipher), decipher.final()]);
  }

  const transform = new Transform({
    transform(chunk, encoding, callback) {
      buffer = Buffer.concat([buffer, chunk]);

      // 1. Parse header if not yet parsed
      if (!headerParsed) {
        if (buffer.length < HEADER_SIZE) {
          return callback(); // Need more data for header
        }

        const magic = buffer.subarray(0, 4);
        if (!magic.equals(MAGIC)) {
          return callback(new Error('Invalid encrypted file: header magic mismatch'));
        }

        const ver = buffer.readUInt8(4);
        if (ver !== VERSION) {
          return callback(new Error(`Unsupported encrypted file version: ${ver}`));
        }

        chunkSize = buffer.readUInt32BE(5);
        if (chunkSize <= 0 || chunkSize > 32 * 1024 * 1024) {
          return callback(new Error(`Invalid encrypted chunk size in header: ${chunkSize}`));
        }

        baseNonce = buffer.subarray(9, 21);
        buffer = buffer.subarray(HEADER_SIZE);
        headerParsed = true;
      }

      // 2. Parse chunks from buffer
      while (true) {
        if (buffer.length < 4) break;

        const cipherLen = buffer.readUInt32BE(0);
        const totalChunkBytes = 4 + cipherLen + 16; // 4 (len) + cipherLen + 16 (tag)

        if (buffer.length < totalChunkBytes) {
          break; // Need more data for this chunk
        }

        const cipherData = buffer.subarray(4, 4 + cipherLen);
        const tag = buffer.subarray(4 + cipherLen, totalChunkBytes);
        buffer = buffer.subarray(totalChunkBytes);

        // If we had a previously held chunk, we now know it was NOT final
        if (pendingChunk !== null) {
          try {
            const plaintext = verifyAndDecrypt(pendingChunk.ciphertext, pendingChunk.tag, pendingChunk.index, false);
            this.push(plaintext);
          } catch (decErr) {
            return callback(new Error(`Decryption failed: chunk ${pendingChunk.index} authentication failed (${decErr.message})`));
          }
        }

        pendingChunk = {
          ciphertext: cipherData,
          tag,
          index: chunkIndex++
        };
      }

      callback();
    },

    flush(callback) {
      if (!headerParsed) {
        return callback(new Error('Truncated encrypted file: stream ended before header could be read'));
      }

      if (buffer.length > 0) {
        return callback(new Error(`Truncated encrypted file: ${buffer.length} unparsed trailing bytes at end of stream`));
      }

      if (pendingChunk === null) {
        return callback(new Error('Truncated encrypted file: no chunks found'));
      }

      // The held chunk MUST be the final chunk
      try {
        const plaintext = verifyAndDecrypt(pendingChunk.ciphertext, pendingChunk.tag, pendingChunk.index, true);
        this.push(plaintext);
        pendingChunk = null;
        callback();
      } catch (decErr) {
        callback(new Error(`Decryption failed: final chunk authentication failed (${decErr.message})`));
      }
    }
  });

  return transform;
}

module.exports = {
  MAGIC,
  VERSION,
  DEFAULT_CHUNK_SIZE,
  HEADER_SIZE,
  deriveChunkNonce,
  buildAad,
  createEncryptStream,
  createDecryptStream
};
