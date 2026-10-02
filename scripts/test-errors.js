'use strict';
/**
 * scripts/test-errors.js
 * Sprint 8B – Comprehensive error handling and UX test suite.
 * Tests machine error codes, HTTP statuses, leak-prevention, and DB recovery.
 *
 * Usage: node scripts/test-errors.js
 */

const http  = require('http');
const crypto = require('crypto');
const path  = require('path');
const fs    = require('fs');

process.env.JWT_SECRET = 'test-errors-suite-jwt-secret-key-32chars-min!';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
process.env.NODE_ENV = 'development';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');

const results = [];
let passed = 0;
let failed = 0;
const recordedResponses = [];

function assert(label, ok, detail) {
  results.push({ label, ok, detail: detail || '' });
  if (ok) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ' – ' + detail : ''}`);
    failed++;
  }
}

function request(baseUrl, method, urlPath, body, cookies, extraHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + urlPath);
    let bodyBuf = null;
    const headers = { ...(extraHeaders || {}) };

    if (body !== null && body !== undefined) {
      bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = bodyBuf.length;
    }
    if (cookies) headers['Cookie'] = cookies;

    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        recordedResponses.push({ status: res.statusCode, raw });
        resolve({
          status: res.statusCode,
          headers: res.headers,
          raw,
          json
        });
      });
    });

    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function buildMultipart(fields, file) {
  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
  const parts = [];

  for (const [name, val] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`
    ));
  }

  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field || 'file'}"; filename="${file.filename || 'test.txt'}"\r\nContent-Type: ${file.contentType || 'text/plain'}\r\n\r\n`
    ));
    parts.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content || ''));
    parts.push(Buffer.from('\r\n'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function run() {
  console.log('======================================================================');
  console.log('       EvidenceGuard – Sprint 8B Error Handling Test Suite           ');
  console.log('======================================================================');

  let mongod = null;
  let server = null;
  let baseUrl = '';

  // 1. Setup in-process server or connect to live
  if (process.env.TEST_BASE_URL) {
    baseUrl = process.env.TEST_BASE_URL;
    console.log(`Running against external server: ${baseUrl}`);
  } else {
    console.log('Starting in-memory MongoDB and test server...');
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();

    const app = require('../server');
    const connectDB = require('../config/db');
    const { ensureGenesis } = require('../services/chainService');

    await connectDB();
    await ensureGenesis();

    server = http.createServer(app);
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Test server running on ${baseUrl}`);
  }

  // Seed Users: Admin and Viewer
  const User = require('../models/User');
  const adminPassword = 'AdminSecretPassword123!';
  const viewerPassword = 'ViewerSecretPassword123!';
  const adminHash = await bcrypt.hash(adminPassword, 10);
  const viewerHash = await bcrypt.hash(viewerPassword, 10);

  const adminUser = await User.findOneAndUpdate(
    { email: 'admin@errortest.io' },
    { name: 'Admin Tester', passwordHash: adminHash, role: 'ADMIN', isActive: true },
    { upsert: true, new: true }
  );

  const viewerUser = await User.findOneAndUpdate(
    { email: 'viewer@errortest.io' },
    { name: 'Viewer Tester', passwordHash: viewerHash, role: 'VIEWER', isActive: true },
    { upsert: true, new: true }
  );

  // Login to get tokens/cookies
  const loginAdmin = await request(baseUrl, 'POST', '/api/auth/login', {
    email: 'admin@errortest.io',
    password: adminPassword
  });
  const adminCookie = (loginAdmin.headers['set-cookie'] || [])[0];

  const loginViewer = await request(baseUrl, 'POST', '/api/auth/login', {
    email: 'viewer@errortest.io',
    password: viewerPassword
  });
  const viewerCookie = (loginViewer.headers['set-cookie'] || [])[0];

  // ── 1. NO_FILE (400) ────────────────────────────────────────────────────────
  console.log('\n--- [1] NO_FILE (400) ---');
  const noFileMp = buildMultipart({ name: 'Evidence Without File', type: 'Document' }, null);
  const rNoFile = await request(baseUrl, 'POST', '/api/evidence', noFileMp.body, adminCookie, { 'Content-Type': noFileMp.contentType });
  assert('Missing upload file returns HTTP 400', rNoFile.status === 400, `got ${rNoFile.status}`);
  assert('Missing upload file returns code NO_FILE', rNoFile.json && rNoFile.json.code === 'NO_FILE', `got ${rNoFile.json?.code}`);

  // ── 2. INVALID_FILE_TYPE (415) ──────────────────────────────────────────────
  console.log('\n--- [2] INVALID_FILE_TYPE (415) ---');
  const badTypeMp = buildMultipart(
    { name: 'Bad Executable', type: 'Document' },
    { filename: 'malicious.exe', contentType: 'application/x-msdownload', content: 'MZ executable binary' }
  );
  const rBadType = await request(baseUrl, 'POST', '/api/evidence', badTypeMp.body, adminCookie, { 'Content-Type': badTypeMp.contentType });
  assert('Disallowed file type returns HTTP 415', rBadType.status === 415, `got ${rBadType.status}`);
  assert('Disallowed file type returns code INVALID_FILE_TYPE', rBadType.json && rBadType.json.code === 'INVALID_FILE_TYPE', `got ${rBadType.json?.code}`);

  // ── 3. FILE_TOO_LARGE (413) ─────────────────────────────────────────────────
  console.log('\n--- [3] FILE_TOO_LARGE (413) ---');
  const bigJson = JSON.stringify({ name: 'x'.repeat(120 * 1024) });
  const rBigJson = await request(baseUrl, 'POST', '/api/auth/login', bigJson, null, { 'Content-Type': 'application/json' });
  assert('Oversized request body returns HTTP 413', rBigJson.status === 413, `got ${rBigJson.status}`);
  assert('Oversized request body returns code FILE_TOO_LARGE', rBigJson.json && rBigJson.json.code === 'FILE_TOO_LARGE', `got ${rBigJson.json?.code}`);

  // ── 4. EMPTY_FILE (400) ─────────────────────────────────────────────────────
  console.log('\n--- [4] EMPTY_FILE (400) ---');
  const emptyMp = buildMultipart(
    { name: 'Zero Byte File', type: 'Document' },
    { filename: 'empty.txt', contentType: 'text/plain', content: Buffer.alloc(0) }
  );
  const rEmpty = await request(baseUrl, 'POST', '/api/evidence', emptyMp.body, adminCookie, { 'Content-Type': emptyMp.contentType });
  assert('Empty 0-byte file returns HTTP 400', rEmpty.status === 400, `got ${rEmpty.status}`);
  assert('Empty file returns code EMPTY_FILE', rEmpty.json && rEmpty.json.code === 'EMPTY_FILE', `got ${rEmpty.json?.code}`);

  // ── 5. DUPLICATE_EVIDENCE (409) ─────────────────────────────────────────────
  console.log('\n--- [5] DUPLICATE_EVIDENCE (409) ---');
  const content = 'Sprint 8B forensic test evidence ' + Date.now();
  const fileHash = crypto.createHash('sha256').update(content).digest('hex');

  const mp1 = buildMultipart(
    { name: 'First Upload', type: 'Document', clientHash: fileHash },
    { filename: 'sample.txt', contentType: 'text/plain', content }
  );
  const r1 = await request(baseUrl, 'POST', '/api/evidence', mp1.body, adminCookie, { 'Content-Type': mp1.contentType });
  assert('Initial upload succeeds (HTTP 201)', r1.status === 201, `got ${r1.status}`);

  const mp2 = buildMultipart(
    { name: 'Second Upload Duplicate', type: 'Document', clientHash: fileHash },
    { filename: 'sample_copy.txt', contentType: 'text/plain', content }
  );
  const rDup = await request(baseUrl, 'POST', '/api/evidence', mp2.body, adminCookie, { 'Content-Type': mp2.contentType });
  assert('Duplicate evidence returns HTTP 409', rDup.status === 409, `got ${rDup.status}`);
  assert('Duplicate evidence returns code DUPLICATE_EVIDENCE', rDup.json && rDup.json.code === 'DUPLICATE_EVIDENCE', `got ${rDup.json?.code}`);
  assert('Duplicate response preserves existing details', Boolean(rDup.json && rDup.json.existing && rDup.json.existing.evidenceId), 'Missing existing details');

  // ── 6. INVALID_ID (400) ─────────────────────────────────────────────────────
  console.log('\n--- [6] INVALID_ID (400) ---');
  const rBadId = await request(baseUrl, 'GET', '/api/evidence/NOT-AN-ID', null, adminCookie);
  assert('Malformed evidence ID returns HTTP 400', rBadId.status === 400, `got ${rBadId.status}`);
  assert('Malformed evidence ID returns code INVALID_ID', rBadId.json && rBadId.json.code === 'INVALID_ID', `got ${rBadId.json?.code}`);

  // ── 7. NOT_FOUND (404) ──────────────────────────────────────────────────────
  console.log('\n--- [7] NOT_FOUND (404) ---');
  const rNotFoundEv = await request(baseUrl, 'GET', '/api/evidence/EV-9999', null, adminCookie);
  assert('Non-existent evidence returns HTTP 404', rNotFoundEv.status === 404, `got ${rNotFoundEv.status}`);
  assert('Non-existent evidence returns code NOT_FOUND', rNotFoundEv.json && rNotFoundEv.json.code === 'NOT_FOUND', `got ${rNotFoundEv.json?.code}`);

  const rUnknownRoute = await request(baseUrl, 'GET', '/api/nonexistent-route-xyz', null, adminCookie);
  assert('Unknown API route returns HTTP 404', rUnknownRoute.status === 404, `got ${rUnknownRoute.status}`);
  assert('Unknown API route returns code NOT_FOUND', rUnknownRoute.json && rUnknownRoute.json.code === 'NOT_FOUND', `got ${rUnknownRoute.json?.code}`);

  // ── 8. HASH_MISMATCH_UPLOAD (422) ───────────────────────────────────────────
  console.log('\n--- [8] HASH_MISMATCH_UPLOAD (422) ---');
  const mismatchMp = buildMultipart(
    { name: 'Mismatched Evidence', type: 'Document', clientHash: '0000000000000000000000000000000000000000000000000000000000000000' },
    { filename: 'mismatch.txt', contentType: 'text/plain', content: 'real content' }
  );
  const rMismatch = await request(baseUrl, 'POST', '/api/evidence', mismatchMp.body, adminCookie, { 'Content-Type': mismatchMp.contentType });
  assert('Hash mismatch returns HTTP 422', rMismatch.status === 422, `got ${rMismatch.status}`);
  assert('Hash mismatch returns code HASH_MISMATCH_UPLOAD', rMismatch.json && rMismatch.json.code === 'HASH_MISMATCH_UPLOAD', `got ${rMismatch.json?.code}`);

  // ── 9. VALIDATION_ERROR (400) ──────────────────────────────────────────────
  console.log('\n--- [9] VALIDATION_ERROR (400) ---');
  const rValErr = await request(baseUrl, 'POST', '/api/auth/register', { email: 'invalid-email', password: '123' });
  assert('Invalid input returns HTTP 400', rValErr.status === 400, `got ${rValErr.status}`);
  assert('Invalid input returns code VALIDATION_ERROR', rValErr.json && rValErr.json.code === 'VALIDATION_ERROR', `got ${rValErr.json?.code}`);
  assert('Validation error returns field-level details', Boolean(rValErr.json && Array.isArray(rValErr.json.details) && rValErr.json.details.length > 0), 'Missing details array');

  // ── 10. AUTH_FAILED (401) ───────────────────────────────────────────────────
  console.log('\n--- [10] AUTH_FAILED (401) ---');
  const rAuthFail = await request(baseUrl, 'POST', '/api/auth/login', { email: 'admin@errortest.io', password: 'WrongPassword999!' });
  assert('Bad login credentials return HTTP 401', rAuthFail.status === 401, `got ${rAuthFail.status}`);
  assert('Bad login credentials return code AUTH_FAILED', rAuthFail.json && rAuthFail.json.code === 'AUTH_FAILED', `got ${rAuthFail.json?.code}`);

  // ── 11. UNAUTHORIZED (401) ──────────────────────────────────────────────────
  console.log('\n--- [11] UNAUTHORIZED (401) ---');
  const rUnauth = await request(baseUrl, 'GET', '/api/evidence', null, null);
  assert('Accessing protected endpoint without token returns HTTP 401', rUnauth.status === 401, `got ${rUnauth.status}`);
  assert('Unauthenticated request returns code UNAUTHORIZED', rUnauth.json && rUnauth.json.code === 'UNAUTHORIZED', `got ${rUnauth.json?.code}`);

  // ── 12. FORBIDDEN (403) ─────────────────────────────────────────────────────
  console.log('\n--- [12] FORBIDDEN (403) ---');
  const rForbidden = await request(baseUrl, 'DELETE', '/api/evidence/EV-0001', { reason: 'Test delete' }, viewerCookie);
  assert('Unauthorized role action returns HTTP 403', rForbidden.status === 403, `got ${rForbidden.status}`);
  assert('Unauthorized role action returns code FORBIDDEN', rForbidden.json && rForbidden.json.code === 'FORBIDDEN', `got ${rForbidden.json?.code}`);

  // ── 13. Malformed JSON Body (400) ───────────────────────────────────────────
  console.log('\n--- [13] Malformed JSON Body (400) ---');
  const rBadJson = await request(baseUrl, 'POST', '/api/auth/login', '{"email": "bad json...', null, { 'Content-Type': 'application/json' });
  assert('Malformed JSON body returns HTTP 400', rBadJson.status === 400, `got ${rBadJson.status}`);
  assert('Malformed JSON body returns code VALIDATION_ERROR', rBadJson.json && rBadJson.json.code === 'VALIDATION_ERROR', `got ${rBadJson.json?.code}`);

  // ── 14. RATE_LIMITED (429) ───────────────────────────────────────────────────
  console.log('\n--- [14] RATE_LIMITED (429) ---');
  let hitRateLimit = false;
  let rateLimitCode = '';
  for (let i = 0; i < 15; i++) {
    const r = await request(baseUrl, 'POST', '/api/auth/login', { email: 'baduser@example.com', password: 'badpassword' });
    if (r.status === 429) {
      hitRateLimit = true;
      rateLimitCode = r.json?.code;
      break;
    }
  }
  assert('Rapid login requests trigger HTTP 429', hitRateLimit, '');
  assert('Rate limited response returns code RATE_LIMITED', rateLimitCode === 'RATE_LIMITED', `got ${rateLimitCode}`);

  // ── 15. Information Leak Checks Across All Responses ────────────────────────
  console.log('\n--- [15] Information Leak Prevention Checks ---');
  let leakFound = false;
  let leakDetail = '';

  for (const item of recordedResponses) {
    const raw = item.raw;
    if (/stack/i.test(raw) && raw.includes('at Object.')) {
      leakFound = true;
      leakDetail = 'Stack trace found in response';
      break;
    }
    if (raw.includes('node_modules')) {
      leakFound = true;
      leakDetail = 'node_modules path found in response';
      break;
    }
    if (raw.includes('mongodb+srv') || raw.includes('mongodb://')) {
      leakFound = true;
      leakDetail = 'MongoDB connection string found in response';
      break;
    }
    if (/([a-zA-Z]:\\[a-zA-Z0-9_\\]+|\/home\/|\/Users\/)/.test(raw)) {
      leakFound = true;
      leakDetail = 'Filesystem path found in response';
      break;
    }
  }

  assert('No response body contains stack traces, internals, paths, or connection strings', !leakFound, leakDetail);

  // ── 16. DB-Down Behavior and Self-Recovery Simulation ───────────────────────
  console.log('\n--- [16] Database Disconnection and Self-Recovery ---');
  if (server && mongod) {
    const uri = mongod.getUri();
    
    // Simulate DB down: close connection
    await mongoose.connection.close();

    const rDbDown = await request(baseUrl, 'GET', '/api/evidence', null, adminCookie);
    assert('DB-backed endpoint returns HTTP 503 when MongoDB is down', rDbDown.status === 503, `got ${rDbDown.status}`);
    assert('DB-backed endpoint returns code DB_UNAVAILABLE', rDbDown.json && rDbDown.json.code === 'DB_UNAVAILABLE', `got ${rDbDown.json?.code}`);
    assert('DB-down error message is user-friendly', rDbDown.json && rDbDown.json.message === 'MongoDB connection failed. Please try again shortly.', `got ${rDbDown.json?.message}`);

    const rHealthDown = await request(baseUrl, 'GET', '/api/health');
    assert('/api/health returns HTTP 503 when MongoDB is down', rHealthDown.status === 503, `got ${rHealthDown.status}`);
    assert('/api/health reports database disconnected', rHealthDown.json && rHealthDown.json.database === 'disconnected', `got ${rHealthDown.json?.database}`);

    // Self-recovery: Reconnect to MongoDB
    await mongoose.connect(uri);

    const rHealthUp = await request(baseUrl, 'GET', '/api/health');
    assert('/api/health returns HTTP 200 after database reconnects', rHealthUp.status === 200, `got ${rHealthUp.status}`);
    assert('/api/health reports database connected after recovery', rHealthUp.json && rHealthUp.json.database === 'connected', `got ${rHealthUp.json?.database}`);

    const rDbRecovered = await request(baseUrl, 'GET', '/api/evidence', null, adminCookie);
    assert('DB-backed endpoint resumes normal operation (HTTP 200) without process restart', rDbRecovered.status === 200, `got ${rDbRecovered.status}`);
  } else {
    console.log('Skipping in-process DB disconnection (running against external server)');
  }

  // ── SUMMARY REPORT ─────────────────────────────────────────────────────────
  console.log('\n======================================================================');
  console.log('                   SPRINT 8B ERROR TEST REPORT                        ');
  console.log('======================================================================');
  console.log(`TOTAL TESTS : ${results.length}`);
  console.log(`PASSED      : ${passed}`);
  console.log(`FAILED      : ${failed}`);
  console.log('======================================================================\n');

  if (server) server.close();
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
  if (mongod) await mongod.stop();

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
