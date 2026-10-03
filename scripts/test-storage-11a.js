#!/usr/bin/env node
'use strict';

/**
 * scripts/test-storage-11a.js
 * Sprint 11A – Storage Interface, Envelope Encryption, and S3 Driver Tests
 *
 * Verifies:
 * 1. Master Key Startup Validation (missing, wrong length, valid 32B, redaction)
 * 2. KeyWrapper DEK wrap & unwrap round-trip and tampering rejection
 * 3. Chunked Encryption (AES-256-GCM, 1 MiB chunks) round-trip: small, exact 1 MiB, multi-chunk
 * 4. Flipped bit rejection (authentication tag failure)
 * 5. Truncated file rejection (missing trailing bytes or dropped chunk)
 * 6. Reordered chunks rejection (AAD chunk index mismatch)
 * 7. Wrong key rejection
 * 8. Tampered header rejection (magic mismatch)
 * 9. Constant memory streaming for 200 MB payload (max heap < 100 MB)
 * 10. S3 Driver interface compliance (save, getStream, remove, exists, stat)
 * 11. End-to-end Evidence Upload & Download with Envelope Encryption
 *     - Evidence.storage populated with encryption metadata
 *     - Plaintext SHA-256 recorded as evidence.hash
 *     - Stored file on disk is ciphertext
 *     - Transparent download decrypts to original plaintext
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');

// Set master key for tests
const TEST_MASTER_KEY = crypto.randomBytes(32).toString('base64');
process.env.STORAGE_ENCRYPTION = 'true';
process.env.STORAGE_MASTER_KEY = TEST_MASTER_KEY;
process.env.JWT_SECRET = 'test-storage-jwt-secret-key-32chars!';
require('dotenv').config();

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const { KeyWrapper, getKeyWrapper, resetKeyWrapper } = require('../storage/keyWrapper');
const {
  createEncryptStream,
  createDecryptStream,
  DEFAULT_CHUNK_SIZE,
  HEADER_SIZE
} = require('../storage/chunkedEncryption');
const storageService = require('../storage/storageService');
const localDriver = require('../storage/localDriver');
const s3Driver = require('../storage/s3Driver');

let passed = 0;
let failed = 0;
const results = [];

function assert(description, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${description}`);
    results.push({ description, status: 'PASS' });
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${description} ${details ? '- ' + details : ''}`);
    results.push({ description, status: 'FAIL', details });
  }
}

async function streamToBuffer(readableStream) {
  const chunks = [];
  for await (const chunk of readableStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

(async () => {
  console.log('\n======================================================================');
  console.log('       EvidenceGuard Sprint 11A – Storage & Encryption Test Suite     ');
  console.log('======================================================================\n');

  // ── Test 1: Master Key Startup Validation & Redaction ───────────────────────
  console.log('[Test 1] Master Key Validation & Protection...');
  
  // Missing key
  let missingKeyThrew = false;
  try {
    new KeyWrapper('');
  } catch (err) {
    missingKeyThrew = err.code === 'INVALID_MASTER_KEY';
  }
  assert('Missing master key throws INVALID_MASTER_KEY', missingKeyThrew);

  // Short key (16 bytes instead of 32)
  let shortKeyThrew = false;
  try {
    new KeyWrapper(crypto.randomBytes(16).toString('base64'));
  } catch (err) {
    shortKeyThrew = err.code === 'INVALID_MASTER_KEY_LENGTH';
  }
  assert('Short master key (16 bytes) throws INVALID_MASTER_KEY_LENGTH', shortKeyThrew);

  // Valid 32-byte key
  const validKw = new KeyWrapper(TEST_MASTER_KEY, 'master-test-v1');
  assert('Valid 32-byte master key loads successfully', validKw.getKekId() === 'master-test-v1');

  // Key redaction (never logged)
  const inspected = require('util').inspect(validKw);
  assert('KeyWrapper masks master key from console logging/inspect', inspected.includes('[REDACTED]') && !inspected.includes(TEST_MASTER_KEY));

  // ── Test 2: KeyWrapper DEK Wrap & Unwrap ────────────────────────────────────
  console.log('\n[Test 2] KeyWrapper DEK Wrap & Unwrap...');
  const testDek = crypto.randomBytes(32);
  const wrapped = validKw.wrapKey(testDek);
  assert('DEK wrapped to base64 string', typeof wrapped === 'string' && wrapped.length > 40);

  const unwrapped = validKw.unwrapKey(wrapped);
  assert('Unwrapped DEK matches original test DEK exactly', testDek.equals(unwrapped));

  // Tampered wrapped DEK
  let tamperedWrappedThrew = false;
  try {
    const tamperedBuf = Buffer.from(wrapped, 'base64');
    tamperedBuf[20] ^= 0xFF; // flip bit in tag/ciphertext
    validKw.unwrapKey(tamperedBuf.toString('base64'));
  } catch (_) {
    tamperedWrappedThrew = true;
  }
  assert('Tampered wrapped DEK fails unwrapping with auth error', tamperedWrappedThrew);

  // Wrong master key unwrap
  let wrongMasterThrew = false;
  try {
    const otherKw = new KeyWrapper(crypto.randomBytes(32).toString('base64'), 'master-test-v1');
    otherKw.unwrapKey(wrapped);
  } catch (_) {
    wrongMasterThrew = true;
  }
  assert('Wrong master key fails unwrapping', wrongMasterThrew);

  // ── Test 3: Chunked Encryption Round-Trip ───────────────────────────────────
  console.log('\n[Test 3] Chunked Encryption Round-Trip...');
  
  async function testRoundTrip(name, size) {
    const plaintext = crypto.randomBytes(size);
    const dek = crypto.randomBytes(32);

    const encStream = createEncryptStream(dek);
    const cipherBuf = await streamToBuffer(Readable.from(plaintext).pipe(encStream));

    const decStream = createDecryptStream(dek);
    const roundtripBuf = await streamToBuffer(Readable.from(cipherBuf).pipe(decStream));

    assert(`Round-trip ${name} (${size} bytes) matches original`, plaintext.equals(roundtripBuf));
  }

  await testRoundTrip('small file', 128);
  await testRoundTrip('exact 1 MiB chunk', DEFAULT_CHUNK_SIZE);
  await testRoundTrip('multi-chunk file', 2.5 * DEFAULT_CHUNK_SIZE);

  // ── Test 4: Flipped Bit Rejection ───────────────────────────────────────────
  console.log('\n[Test 4] Flipped Bit Rejection...');
  const dek = crypto.randomBytes(32);
  const samplePlaintext = crypto.randomBytes(100000);
  const validCipher = await streamToBuffer(Readable.from(samplePlaintext).pipe(createEncryptStream(dek)));

  const bitFlippedCipher = Buffer.from(validCipher);
  bitFlippedCipher[HEADER_SIZE + 50] ^= 0x01; // flip 1 bit in ciphertext

  let bitFlipThrew = false;
  try {
    await streamToBuffer(Readable.from(bitFlippedCipher).pipe(createDecryptStream(dek)));
  } catch (err) {
    bitFlipThrew = err.message.includes('authentication failed');
  }
  assert('Flipped bit in ciphertext is rejected with authentication error', bitFlipThrew);

  // ── Test 5: Truncated File Rejection ────────────────────────────────────────
  console.log('\n[Test 5] Truncated File Rejection...');
  // Multi-chunk cipher
  const multiPlaintext = crypto.randomBytes(2.5 * DEFAULT_CHUNK_SIZE);
  const multiCipher = await streamToBuffer(Readable.from(multiPlaintext).pipe(createEncryptStream(dek)));

  // Truncate last 200 bytes
  const truncatedCipher = multiCipher.subarray(0, multiCipher.length - 200);
  let truncateThrew = false;
  try {
    await streamToBuffer(Readable.from(truncatedCipher).pipe(createDecryptStream(dek)));
  } catch (err) {
    truncateThrew = true;
  }
  assert('Truncated stream missing trailing bytes is rejected', truncateThrew);

  // Drop final chunk cleanly (dropping chunk 2 completely)
  const len0 = multiCipher.readUInt32BE(HEADER_SIZE);
  const chunk0End = HEADER_SIZE + 4 + len0 + 16;
  const len1 = multiCipher.readUInt32BE(chunk0End);
  const chunk1End = chunk0End + 4 + len1 + 16;
  const droppedLastChunk = multiCipher.subarray(0, chunk1End);

  let droppedChunkThrew = false;
  try {
    await streamToBuffer(Readable.from(droppedLastChunk).pipe(createDecryptStream(dek)));
  } catch (err) {
    droppedChunkThrew = err.message.includes('authentication failed');
  }
  assert('Cleanly dropped final chunk fails isFinal AAD validation', droppedChunkThrew);

  // ── Test 6: Reordered Chunks Rejection ──────────────────────────────────────
  console.log('\n[Test 6] Reordered Chunks Rejection...');
  const header = multiCipher.subarray(0, HEADER_SIZE);
  const chunk0 = multiCipher.subarray(HEADER_SIZE, chunk0End);
  const chunk1 = multiCipher.subarray(chunk0End, chunk1End);
  const chunk2 = multiCipher.subarray(chunk1End);

  // Swap chunk 0 and chunk 1
  const reorderedCipher = Buffer.concat([header, chunk1, chunk0, chunk2]);
  let reorderThrew = false;
  try {
    await streamToBuffer(Readable.from(reorderedCipher).pipe(createDecryptStream(dek)));
  } catch (err) {
    reorderThrew = err.message.includes('authentication failed');
  }
  assert('Reordered chunks fail chunkIndex AAD verification', reorderThrew);

  // ── Test 7: Wrong Key Rejection ─────────────────────────────────────────────
  console.log('\n[Test 7] Wrong Key Rejection...');
  let wrongKeyThrew = false;
  try {
    const wrongDek = crypto.randomBytes(32);
    await streamToBuffer(Readable.from(validCipher).pipe(createDecryptStream(wrongDek)));
  } catch (err) {
    wrongKeyThrew = err.message.includes('authentication failed');
  }
  assert('Decryption with incorrect DEK is rejected', wrongKeyThrew);

  // ── Test 8: Tampered Header Rejection ───────────────────────────────────────
  console.log('\n[Test 8] Tampered Header Rejection...');
  const tamperedHeaderCipher = Buffer.from(validCipher);
  tamperedHeaderCipher[0] = 0x58; // 'X' instead of 'E'
  let badHeaderThrew = false;
  try {
    await streamToBuffer(Readable.from(tamperedHeaderCipher).pipe(createDecryptStream(dek)));
  } catch (err) {
    badHeaderThrew = err.message.includes('magic mismatch');
  }
  assert('Tampered header magic bytes rejected immediately', badHeaderThrew);

  // ── Test 9: 200 MB Large File Streaming Memory Bound ────────────────────────
  console.log('\n[Test 9] Streaming 200 MB Payload (Constant Memory Bound)...');
  const LARGE_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MB
  const streamChunk = Buffer.alloc(DEFAULT_CHUNK_SIZE, 0x47); // 1 MiB chunk

  let produced = 0;
  const largeSource = new Readable({
    read() {
      if (produced >= LARGE_TOTAL_BYTES) {
        this.push(null);
        return;
      }
      produced += DEFAULT_CHUNK_SIZE;
      this.push(streamChunk);
    }
  });

  let received = 0;
  const nullSink = new Writable({
    write(chunk, enc, cb) {
      received += chunk.length;
      cb();
    }
  });

  const heapStart = process.memoryUsage().heapUsed;
  let heapPeak = heapStart;
  const heapCheckInterval = setInterval(() => {
    const currentHeap = process.memoryUsage().heapUsed;
    if (currentHeap > heapPeak) heapPeak = currentHeap;
  }, 40);

  const streamDek = crypto.randomBytes(32);
  const streamStart = Date.now();
  await pipeline(
    largeSource,
    createEncryptStream(streamDek),
    createDecryptStream(streamDek),
    nullSink
  );
  clearInterval(heapCheckInterval);
  const streamElapsed = Date.now() - streamStart;

  assert('Streamed 200 MB payload completely', received === LARGE_TOTAL_BYTES);
  const heapGrowthMb = (heapPeak - heapStart) / (1024 * 1024);
  console.log(`  📊 Streamed 200 MB in ${streamElapsed}ms (Heap growth: ${heapGrowthMb.toFixed(1)} MB)`);
  assert('Heap memory stayed bounded (< 80 MB growth during 200 MB stream)', heapGrowthMb < 80);

  // ── Test 10: S3 Driver Interface Compliance ─────────────────────────────────
  console.log('\n[Test 10] S3 Driver Interface Verification...');
  // Inject mock S3 client
  const s3StorageMap = new Map();
  const mockS3Client = {
    async send(cmd) {
      const name = cmd.constructor.name;
      if (name === 'PutObjectCommand') {
        const key = cmd.input.Key;
        let buf;
        if (typeof cmd.input.Body === 'string') {
          buf = fs.readFileSync(cmd.input.Body);
        } else if (Buffer.isBuffer(cmd.input.Body)) {
          buf = cmd.input.Body;
        } else if (cmd.input.Body && typeof cmd.input.Body.pipe === 'function') {
          buf = await streamToBuffer(cmd.input.Body);
        }
        s3StorageMap.set(key, {
          data: buf,
          length: buf.length,
          lastModified: new Date()
        });
        return { ETag: '"mock-etag"' };
      }
      if (name === 'GetObjectCommand') {
        const item = s3StorageMap.get(cmd.input.Key);
        if (!item) {
          const err = new Error('NoSuchKey');
          err.name = 'NoSuchKey';
          throw err;
        }
        return {
          Body: Readable.from(item.data),
          ContentLength: item.length,
          LastModified: item.lastModified
        };
      }
      if (name === 'HeadObjectCommand') {
        const item = s3StorageMap.get(cmd.input.Key);
        if (!item) {
          const err = new Error('NotFound');
          err.name = 'NotFound';
          throw err;
        }
        return {
          ContentLength: item.length,
          LastModified: item.lastModified
        };
      }
      if (name === 'DeleteObjectCommand') {
        s3StorageMap.delete(cmd.input.Key);
        return {};
      }
      throw new Error(`Unhandled command: ${name}`);
    }
  };

  s3Driver.setClient(mockS3Client);

  const testS3Key = 'test-s3-obj-001';
  const testS3Payload = Buffer.from('EvidenceGuard S3 Driver Verified');

  // S3 save
  await s3Driver.save(testS3Payload, testS3Key);
  assert('S3 save succeeds', s3StorageMap.has(testS3Key));

  // S3 exists
  const s3Exists = await s3Driver.exists(testS3Key);
  assert('S3 exists returns true for stored object', s3Exists === true);

  // S3 stat
  const s3Stat = await s3Driver.stat(testS3Key);
  assert('S3 stat returns correct byte length', s3Stat.size === testS3Payload.length);

  // S3 getStream
  const s3Stream = await s3Driver.getStream(testS3Key);
  const s3ReadBuf = await streamToBuffer(s3Stream);
  assert('S3 getStream reads exact bytes', testS3Payload.equals(s3ReadBuf));

  // S3 remove
  await s3Driver.remove(testS3Key);
  const s3ExistsAfter = await s3Driver.exists(testS3Key);
  assert('S3 remove deletes object idempotently', s3ExistsAfter === false);

  // ── Test 11: End-to-End Evidence Upload with Envelope Encryption ────────────
  console.log('\n[Test 11] End-to-End Evidence Upload with Envelope Encryption...');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri);

  const { ensureGenesis } = require('../services/chainService');
  await ensureGenesis();

  const User = require('../models/User');
  const Evidence = require('../models/Evidence');

  const salt = await bcrypt.genSalt(10);
  const adminUser = await User.create({
    name: 'Admin Officer',
    email: 'admin_storage_11@evidenceguard.local',
    passwordHash: await bcrypt.hash('SecurePass123!', salt),
    role: 'ADMIN'
  });

  const app = require('../server');
  const server = app.listen(0);
  const port = server.address().port;
  const BASE = `http://localhost:${port}`;

  // Login
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin_storage_11@evidenceguard.local', password: 'SecurePass123!' })
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];

  // Upload file with encryption
  const originalSecretText = 'TOP SECRET CLASSIFIED EVIDENCE CONTENT - 2026';
  const originalPlaintextSha = crypto.createHash('sha256').update(originalSecretText).digest('hex');

  const fd = new FormData();
  const blob = new Blob([Buffer.from(originalSecretText)], { type: 'text/plain' });
  fd.append('file', blob, 'classified.txt');
  fd.append('name', 'Classified File');
  fd.append('type', 'Document');
  fd.append('description', 'Encrypted file test');

  const uploadRes = await fetch(`${BASE}/api/evidence`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: fd
  });
  const uploadData = await uploadRes.json();

  assert('Evidence upload returns HTTP 201', uploadRes.status === 201);
  const evId = uploadData.evidence?.evidenceId;

  // Retrieve evidence doc from DB
  const evidenceDoc = await Evidence.findOne({ evidenceId: evId }).select('+storageKey');
  assert('Evidence.hash remains plaintext SHA-256', evidenceDoc.hash === originalPlaintextSha);
  assert('Evidence.storage.encryption.alg is AES-256-GCM', evidenceDoc.storage?.encryption?.alg === 'AES-256-GCM');
  assert('Evidence.storage.encryption.wrappedDek is recorded', !!evidenceDoc.storage?.encryption?.wrappedDek);
  assert('Evidence.storage.cipherSha256 is recorded', !!evidenceDoc.storage?.cipherSha256);
  assert('Ciphertext hash is DIFFERENT from plaintext hash', evidenceDoc.storage?.cipherSha256 !== originalPlaintextSha);

  // Read stored file directly from local storage disk
  const storedFilePath = path.join(__dirname, '..', 'uploads', evidenceDoc.storageKey);
  const storedRawBytes = fs.readFileSync(storedFilePath);
  assert('File on disk starts with encryption header magic (EGEC)', storedRawBytes.subarray(0, 4).toString('ascii') === 'EGEC');
  assert('File on disk does NOT contain plaintext secret text', !storedRawBytes.includes(originalSecretText));

  // Download evidence via API - verify transparent decryption
  const downloadRes = await fetch(`${BASE}/api/evidence/${evId}/download`, {
    headers: { Cookie: cookie }
  });
  assert('Download endpoint returns HTTP 200', downloadRes.status === 200);
  const downloadedText = await downloadRes.text();
  assert('Downloaded file transparently decrypts to original plaintext', downloadedText === originalSecretText);

  // Cleanup
  try { fs.unlinkSync(storedFilePath); } catch (_) {}
  await server.close();
  await mongoose.disconnect();
  await mongod.stop();

  console.log('\n======================================================================');
  console.log(`Sprint 11A Storage & Encryption Test Results: ${passed} passed, ${failed} failed`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
