'use strict';
/**
 * scripts/test-security.js
 * Sprint 8A – Security test suite.
 * Can run against an external server (via TEST_BASE_URL) or spins up an in-process
 * test server with MongoMemoryServer automatically.
 * Usage: node scripts/test-security.js
 */

const http  = require('http');
const https = require('https');
const path  = require('path');
const fs    = require('fs');
const { spawnSync } = require('child_process');

process.env.JWT_SECRET = 'test-security-suite-jwt-secret-key-32chars-min!';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/evidenceguard_test';
process.env.NODE_ENV = 'development';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');

const results = [];
let passed = 0;
let failed = 0;

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
    const url     = new URL(baseUrl + urlPath);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : http;
    let bodyBuf   = null;
    const headers = { ...(extraHeaders || {}) };

    if (body !== null && body !== undefined) {
      bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = bodyBuf.length;
    }
    if (cookies) headers['Cookie'] = cookies;

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString();
        let parsed;
        try { parsed = JSON.parse(rawBody); } catch { parsed = rawBody; }
        resolve({
          status: res.statusCode,
          body: parsed,
          headers: res.headers,
          rawCookies: res.headers['set-cookie'] || []
        });
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function extractCookie(rawCookies) {
  if (!rawCookies || rawCookies.length === 0) return '';
  return rawCookies.map(c => c.split(';')[0]).join('; ');
}

(async () => {
  console.log('\n======================================================');
  console.log('       EvidenceGuard – Sprint 8A Security Tests       ');
  console.log('======================================================\n');

  let server;
  let mongod;
  let baseUrl = process.env.TEST_BASE_URL || null;

  const externalServer = Boolean(process.env.TEST_BASE_URL);

  const User = require('../models/User');
  const Evidence = require('../models/Evidence');
  const Block = require('../models/Block');
  const AuditLog = require('../models/AuditLog');
  const { ensureGenesis } = require('../services/chainService');
  const app = require('../server');

  if (!externalServer) {
    console.log('[Setup] Starting in-memory test environment...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);

    await Promise.all([
      User.syncIndexes(),
      Evidence.syncIndexes(),
      Block.syncIndexes(),
      AuditLog.syncIndexes()
    ]);
    await ensureGenesis();

    // Create test accounts: Admin, Investigator, Viewer
    const hash = await bcrypt.hash('Password123!', 10);
    await User.create([
      { name: 'Security Admin', email: 'admin@sec.test', passwordHash: hash, role: 'ADMIN', isActive: true },
      { name: 'Security Investigator', email: 'inv@sec.test', passwordHash: hash, role: 'INVESTIGATOR', isActive: true },
      { name: 'Security Viewer', email: 'viewer@sec.test', passwordHash: hash, role: 'VIEWER', isActive: true }
    ]);

    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    console.log(`[Setup] In-process server listening at ${baseUrl}\n`);
  } else {
    console.log(`[Setup] Using existing server at ${baseUrl}\n`);
  }

  // ── [1] Dev URLs return 404 ───────────────────────────────────────────────
  console.log('--- [1] Dev routes removed ---');
  const devAudit = await request(baseUrl, 'GET', '/api/dev/audit-test');
  assert('GET /api/dev/audit-test → 404', devAudit.status === 404, `got ${devAudit.status}`);

  const devRbac = await request(baseUrl, 'GET', '/api/dev/rbac/view');
  assert('GET /api/dev/rbac/view → 404', devRbac.status === 404, `got ${devRbac.status}`);

  // ── [2] Security Headers ──────────────────────────────────────────────────
  console.log('\n--- [2] HTTP Security Headers on /api/health ---');
  const health = await request(baseUrl, 'GET', '/api/health');
  const hh = health.headers;
  assert('X-Content-Type-Options: nosniff', hh['x-content-type-options'] === 'nosniff', hh['x-content-type-options']);
  assert('Referrer-Policy: no-referrer', hh['referrer-policy'] === 'no-referrer', hh['referrer-policy']);
  assert('X-Powered-By disabled/absent', !hh['x-powered-by'], hh['x-powered-by']);
  assert('Content-Security-Policy present', !!(hh['content-security-policy']), '');
  assert('Cache-Control: no-store on /api', (hh['cache-control'] || '').includes('no-store'), hh['cache-control']);
  assert('Permissions-Policy denying camera/mic/geo', (hh['permissions-policy'] || '').includes('camera=()'), hh['permissions-policy']);

  // ── [3] HTML page headers ─────────────────────────────────────────────────
  console.log('\n--- [3] HTML Page Security Headers (/login.html) ---');
  const htmlRes = await request(baseUrl, 'GET', '/login.html');
  const htmlH   = htmlRes.headers;
  assert('CSP present on HTML page', !!(htmlH['content-security-policy']), '');
  assert('X-Content-Type-Options on HTML page', htmlH['x-content-type-options'] === 'nosniff', '');

  // ── [4] Login & Cookie flags ──────────────────────────────────────────────
  console.log('\n--- [4] Authentication & Cookie Flags ---');
  const adminLogin = await request(baseUrl, 'POST', '/api/auth/login', { email: 'admin@sec.test', password: 'Password123!' });
  assert('Admin login → 200', adminLogin.status === 200, `got ${adminLogin.status}`);
  const adminCookie = extractCookie(adminLogin.rawCookies);
  const rawCookie = adminLogin.rawCookies[0] || '';
  assert('Cookie has HttpOnly flag', /HttpOnly/i.test(rawCookie), rawCookie.substring(0, 70));
  assert('Cookie has SameSite=Lax flag', /SameSite=Lax/i.test(rawCookie), rawCookie.substring(0, 70));

  const invLogin = await request(baseUrl, 'POST', '/api/auth/login', { email: 'inv@sec.test', password: 'Password123!' });
  const invCookie = extractCookie(invLogin.rawCookies);

  const viewerLogin = await request(baseUrl, 'POST', '/api/auth/login', { email: 'viewer@sec.test', password: 'Password123!' });
  const viewerCookie = extractCookie(viewerLogin.rawCookies);

  // ── [5] NoSQL Injection Sweep ─────────────────────────────────────────────
  console.log('\n--- [5] NoSQL Injection Guards ---');
  // Body with $ operator
  const inj1 = await request(baseUrl, 'POST', '/api/auth/login', '{"email":{"$ne":null},"password":"Password123!"}', null, { 'Content-Type': 'application/json' });
  assert('NoSQL body {"$ne":null} on login → 400', inj1.status === 400, `got ${inj1.status}`);

  const inj2 = await request(baseUrl, 'POST', '/api/auth/login', '{"$gt":""}', null, { 'Content-Type': 'application/json' });
  assert('NoSQL body {"$gt":""} on login → 400', inj2.status === 400, `got ${inj2.status}`);

  // Query parameter with $ operator
  const inj3 = await request(baseUrl, 'GET', '/api/evidence?q[$ne]=x', null, adminCookie);
  assert('NoSQL query ?q[$ne]=x on evidence list → 400', inj3.status === 400, `got ${inj3.status}`);

  const inj4 = await request(baseUrl, 'GET', '/api/audit?q[$ne]=x', null, adminCookie);
  assert('NoSQL query ?q[$ne]=x on audit search → 400', inj4.status === 400, `got ${inj4.status}`);

  const inj5 = await request(baseUrl, 'GET', '/api/users?q[$gt]=x', null, adminCookie);
  assert('NoSQL query ?q[$gt]=x on user management → 400', inj5.status === 400, `got ${inj5.status}`);

  // ── [6] Route Table & Unauthenticated 401 checks ──────────────────────────
  console.log('\n--- [6] Unauthenticated Access (All protected routes → 401) ---');
  const protectedRoutes = [
    ['GET',    '/api/auth/me'],
    ['GET',    '/api/evidence'],
    ['POST',   '/api/evidence'],
    ['GET',    '/api/evidence/lookup'],
    ['POST',   '/api/evidence/EV-0001/verify'],
    ['GET',    '/api/evidence/EV-0001/verifications'],
    ['GET',    '/api/evidence/EV-0001/qr'],
    ['GET',    '/api/evidence/EV-0001'],
    ['DELETE', '/api/evidence/EV-0001'],
    ['GET',    '/api/blockchain'],
    ['POST',   '/api/blockchain/validate'],
    ['GET',    '/api/dashboard/stats'],
    ['GET',    '/api/audit/filters'],
    ['POST',   '/api/audit/validate'],
    ['GET',    '/api/audit'],
    ['GET',    '/api/users'],
    ['POST',   '/api/users'],
    ['PATCH',  '/api/users/507f1f77bcf86cd799439011/role'],
    ['DELETE', '/api/users/507f1f77bcf86cd799439011']
  ];

  for (const [m, p] of protectedRoutes) {
    const r = await request(baseUrl, m, p, m === 'POST' || m === 'PATCH' ? {} : null);
    assert(`Logged out ${m} ${p} → 401`, r.status === 401, `got ${r.status}`);
  }

  // ── [7] Role-Based Access Control (403 for wrong role) ─────────────────────
  console.log('\n--- [7] Role-Based Authorization Checks (403 for wrong role) ---');
  // VIEWER on upload
  const rVUpload = await request(baseUrl, 'POST', '/api/evidence', {}, viewerCookie);
  assert('VIEWER POST /api/evidence → 403', rVUpload.status === 403, `got ${rVUpload.status}`);

  // VIEWER on delete evidence
  const rVDel = await request(baseUrl, 'DELETE', '/api/evidence/EV-0001', { reason: 'Delete attempt' }, viewerCookie);
  assert('VIEWER DELETE /api/evidence/EV-0001 → 403', rVDel.status === 403, `got ${rVDel.status}`);

  // INVESTIGATOR on delete evidence (ADMIN only)
  const rIDel = await request(baseUrl, 'DELETE', '/api/evidence/EV-0001', { reason: 'Delete attempt' }, invCookie);
  assert('INVESTIGATOR DELETE /api/evidence/EV-0001 → 403', rIDel.status === 403, `got ${rIDel.status}`);

  // VIEWER on blockchain validate (ADMIN only)
  const rVBcVal = await request(baseUrl, 'POST', '/api/blockchain/validate', {}, viewerCookie);
  assert('VIEWER POST /api/blockchain/validate → 403', rVBcVal.status === 403, `got ${rVBcVal.status}`);

  // INVESTIGATOR on blockchain validate (ADMIN only)
  const rIBcVal = await request(baseUrl, 'POST', '/api/blockchain/validate', {}, invCookie);
  assert('INVESTIGATOR POST /api/blockchain/validate → 403', rIBcVal.status === 403, `got ${rIBcVal.status}`);

  // VIEWER on audit logs (INVESTIGATOR & ADMIN only)
  const rVAudit = await request(baseUrl, 'GET', '/api/audit', null, viewerCookie);
  assert('VIEWER GET /api/audit → 403', rVAudit.status === 403, `got ${rVAudit.status}`);

  // VIEWER on audit validate (ADMIN only)
  const rVAuditVal = await request(baseUrl, 'POST', '/api/audit/validate', {}, viewerCookie);
  assert('VIEWER POST /api/audit/validate → 403', rVAuditVal.status === 403, `got ${rVAuditVal.status}`);

  // INVESTIGATOR on audit validate (ADMIN only)
  const rIAuditVal = await request(baseUrl, 'POST', '/api/audit/validate', {}, invCookie);
  assert('INVESTIGATOR POST /api/audit/validate → 403', rIAuditVal.status === 403, `got ${rIAuditVal.status}`);

  // VIEWER on user management (ADMIN only)
  const rVUsers = await request(baseUrl, 'GET', '/api/users', null, viewerCookie);
  assert('VIEWER GET /api/users → 403', rVUsers.status === 403, `got ${rVUsers.status}`);

  // INVESTIGATOR on user management (ADMIN only)
  const rIUsers = await request(baseUrl, 'GET', '/api/users', null, invCookie);
  assert('INVESTIGATOR GET /api/users → 403', rIUsers.status === 403, `got ${rIUsers.status}`);

  // ── [8] Oversized body (413) & Wrong Content-Type (415) ───────────────────
  console.log('\n--- [8] Body Size & Media Type Limits ---');
  const bigBody = JSON.stringify({ data: 'x'.repeat(150 * 1024) });
  const bigRes  = await request(baseUrl, 'POST', '/api/auth/login', bigBody, null, { 'Content-Type': 'application/json' });
  assert('Oversized 150 KB JSON body → 413', bigRes.status === 413, `got ${bigRes.status}`);

  const xmlBody = '<xml><test>value</test></xml>';
  const xmlRes  = await request(baseUrl, 'POST', '/api/auth/login', xmlBody, null, { 'Content-Type': 'application/xml' });
  assert('Unsupported Content-Type (application/xml) → 415', xmlRes.status === 415, `got ${xmlRes.status}`);

  // ── [9] Login Rate Limiting ───────────────────────────────────────────────
  console.log('\n--- [9] Login Rate Limiting (10 req / 15 min limit) ---');
  let hitRateLimit = false;
  for (let i = 0; i < 12; i++) {
    const r = await request(baseUrl, 'POST', '/api/auth/login', { email: 'bad@sec.test', password: 'WrongPassword!' });
    if (r.status === 429) {
      hitRateLimit = true;
      break;
    }
  }
  assert('Excessive login attempts trigger 429 Too Many Requests', hitRateLimit, '');

  // ── [10] Path Traversal and Upload Security ────────────────────────────────
  console.log('\n--- [10] Upload Security & Path Traversal Guards ---');
  // Upload multipart with directory traversal in filename
  const boundary = '---------------------------' + Date.now().toString(16);
  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="../../../etc/passwd.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `evidence content for security test\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="name"\r\n\r\n` +
      `Security Test File\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="type"\r\n\r\n` +
      `Document\r\n` +
      `--${boundary}--\r\n`
    )
  ]);

  const upRes = await request(baseUrl, 'POST', '/api/evidence', multipartBody, adminCookie, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`
  });
  assert('Upload with filename ../../../etc/passwd.txt accepted or sanitized', [201, 400].includes(upRes.status), `got ${upRes.status}`);

  // Verify that the file was not written outside uploads
  const evilEscaped = path.join(__dirname, '..', '..', 'etc', 'passwd.txt');
  assert('File never escaped uploads folder via path traversal', !fs.existsSync(evilEscaped), '');

  // Stored file URLs are never directly reachable
  const directUploadRes = await request(baseUrl, 'GET', '/uploads/test.txt');
  assert('Direct GET /uploads/test.txt → 404 (not publicly served)', directUploadRes.status === 404, `got ${directUploadRes.status}`);

  // ── [11] Startup refuses bad configuration ────────────────────────────────
  console.log('\n--- [11] Startup Validation Refuses Bad Configuration ---');
  const shortSecretResult = spawnSync('node', ['server.js'], {
    env: {
      ...process.env,
      JWT_SECRET: 'short',
      MONGODB_URI: 'mongodb://localhost:27017/test',
      PUBLIC_BASE_URL: 'http://localhost:3000',
      PORT: '0'
    },
    cwd: path.join(__dirname, '..'),
    timeout: 5000
  });
  assert('Server refuses to start when JWT_SECRET < 32 characters', shortSecretResult.status !== 0, `exit code: ${shortSecretResult.status}`);

  const missingMongoResult = spawnSync('node', ['server.js'], {
    env: {
      ...process.env,
      JWT_SECRET: 'long-secret-key-that-is-at-least-32-chars-long!',
      MONGODB_URI: '',
      PUBLIC_BASE_URL: 'http://localhost:3000',
      PORT: '0'
    },
    cwd: path.join(__dirname, '..'),
    timeout: 5000
  });
  assert('Server refuses to start when MONGODB_URI is empty', missingMongoResult.status !== 0, `exit code: ${missingMongoResult.status}`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  if (server) {
    server.close();
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  if (mongod) {
    await mongod.stop();
  }

  // ── Summary Table ─────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('                   SPRINT 8A SECURITY TEST REPORT                     ');
  console.log('═'.repeat(70));
  console.log('Test Case'.padEnd(58) + 'Result');
  console.log('─'.repeat(70));
  for (const r of results) {
    const symbol = r.ok ? 'PASS' : 'FAIL';
    console.log(`${r.label.substring(0, 56).padEnd(58)}${symbol}`);
  }
  console.log('─'.repeat(70));
  console.log(`TOTAL: ${passed} PASSED, ${failed} FAILED (${results.length} total)`);
  console.log('═'.repeat(70) + '\n');

  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});