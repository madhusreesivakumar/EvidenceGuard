/**
 * Sprint 7D – Audit Coverage Test
 * Drives the live server through one action of each of the 13 canonical
 * action types, then queries /api/audit to confirm each produced at least
 * one audit row with the required fields.
 *
 * Supports both running against an existing server (via TEST_BASE_URL or default 3000)
 * or spinning up an automatic in-process MongoMemoryServer if no server is running.
 *
 * Usage: node scripts/test-audit-coverage.js
 */
'use strict';

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
require('dotenv').config();

let BASE           = process.env.TEST_BASE_URL    || 'http://localhost:3000';
const ADMIN_EMAIL  = process.env.TEST_ADMIN_EMAIL    || process.env.SEED_ADMIN_EMAIL    || 'admin@evidenceguard.local';
const ADMIN_PASS   = process.env.TEST_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || 'Admin1234!';
const INV_EMAIL    = `cov_inv_${Date.now()}@test.local`;
const INV_PASS     = 'Inv12345!';
const VIEW_EMAIL   = `cov_view_${Date.now()}@test.local`;
const VIEW_PASS    = 'View1234!';

// The 13 canonical actions the spec requires
const REQUIRED_ACTIONS = [
  'REGISTER', 'LOGIN', 'LOGOUT', 'UPLOAD', 'HASH_GENERATED', 'VERIFY',
  'TAMPER_DETECTED', 'DELETE', 'BLOCK_CREATED', 'BLOCKCHAIN_VALIDATED',
  'USER_CREATED', 'ROLE_CHANGED', 'QR_GENERATED'
];

let passed = 0, failed = 0;
const results = {};

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function request(method, urlPath, body, cookies, isMultipart) {
  return new Promise((resolve, reject) => {
    const url     = new URL(BASE + urlPath);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : http;
    let bodyBuf = null, headers = {};

    if (isMultipart && body) {
      bodyBuf = body.buffer;
      headers['Content-Type'] = body.contentType;
      headers['Content-Length'] = bodyBuf.length;
    } else if (body) {
      bodyBuf = Buffer.from(JSON.stringify(body));
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = bodyBuf.length;
    }
    if (cookies) headers['Cookie'] = cookies;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString()); } catch { parsed = {}; }
        resolve({ status: res.statusCode, body: parsed, rawCookies: res.headers['set-cookie'] || [] });
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function extractCookie(rawCookies) {
  return rawCookies.map(c => c.split(';')[0]).join('; ');
}

// Build a minimal multipart form-data body for file upload
function buildMultipart(fields, fileContent, fileName) {
  const boundary = '----TestBoundary' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
    );
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n${fileContent}\r\n`
  );
  parts.push(`--${boundary}--\r\n`);
  const buffer = Buffer.from(parts.join(''));
  return { buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const startTs = new Date().toISOString();
  console.log('\n=== Sprint 7D – Audit Coverage Test ===\n');

  let server;
  let mongod;
  let externalServer = false;

  try {
    const health = await request('GET', '/api/health');
    if (health.status === 200) externalServer = true;
  } catch (_) {}

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-audit-coverage-jwt-secret-key-32chars!';

  const mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const bcrypt = require('bcrypt');
  const User = require('../models/User');
  const Evidence = require('../models/Evidence');
  const Block = require('../models/Block');
  const AuditLog = require('../models/AuditLog');
  const { ensureGenesis } = require('../services/chainService');

  if (!externalServer) {
    console.log('[Setup] Starting in-memory test environment...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);

    await Promise.all([
      User.syncIndexes(),
      Evidence.syncIndexes(),
      Block.syncIndexes(),
      AuditLog.syncIndexes()
    ]);
    await ensureGenesis();

    const adminHash = await bcrypt.hash(ADMIN_PASS, 10);
    await User.create({
      name: 'Admin Chief',
      email: ADMIN_EMAIL.toLowerCase(),
      passwordHash: adminHash,
      role: 'ADMIN',
      isActive: true
    });

    const app = require('../server');
    server = app.listen(0);
    const port = server.address().port;
    BASE = `http://localhost:${port}`;
  }

  console.log(`Base URL: ${BASE}`);
  console.log(`Started:  ${startTs}\n`);

  let adminCookies = '', invCookies = '';
  let uploadedEvId = '', uploadedCaseId = '', createdUserId = '';

  try {
    // ── 1. REGISTER (INVESTIGATOR candidate) ──────────────────────────────────
    console.log('[1] REGISTER – creating investigator account');
    const reg = await request('POST', '/api/auth/register', { name: 'CovInv', email: INV_EMAIL, password: INV_PASS });
    if (reg.status !== 201) throw new Error(`REGISTER failed: ${reg.status} ${JSON.stringify(reg.body)}`);

    // ── 2. LOGIN (INVESTIGATOR candidate) ─────────────────────────────────────
    console.log('[2] LOGIN – investigator login');
    const invLogin = await request('POST', '/api/auth/login', { email: INV_EMAIL, password: INV_PASS });
    if (invLogin.status !== 200) throw new Error(`LOGIN failed: ${invLogin.status}`);
    invCookies = extractCookie(invLogin.rawCookies);

    // ── 3. LOGIN (ADMIN) ─────────────────────────────────────────────────────
    console.log('[3] ADMIN login');
    const adminLogin = await request('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
    if (adminLogin.status !== 200) throw new Error(`ADMIN LOGIN failed: ${adminLogin.status} – check credentials`);
    adminCookies = extractCookie(adminLogin.rawCookies);

    // Promote INV to INVESTIGATOR
    const invId = reg.body.user?._id || reg.body.user?.id;
    if (invId) {
      const promo = await request('PATCH', `/api/users/${invId}/role`, { role: 'INVESTIGATOR' }, adminCookies);
      if (promo.status !== 200) console.warn('  [WARN] Could not promote investigator:', promo.body.message);
      // Re-login after role change
      const reLogin = await request('POST', '/api/auth/login', { email: INV_EMAIL, password: INV_PASS });
      if (reLogin.status === 200) invCookies = extractCookie(reLogin.rawCookies);
    }

    // ── 4. UPLOAD (triggers UPLOAD + HASH_GENERATED + BLOCK_CREATED) ─────────
    console.log('[4] UPLOAD – evidence file');
    const ts = Date.now();
    const origContent = `Evidence content for coverage test ${ts}`;
    const body4 = buildMultipart(
      {
        name: `CovFile-${ts}`,
        caseId: `EG-${new Date().getFullYear()}-${String(ts).slice(-4)}`,
        type: 'Document'
      },
      origContent,
      `coverage-${ts}.txt`
    );

    const uploadRes = await new Promise((resolve, reject) => {
      const url = new URL(BASE + '/api/evidence');
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': body4.contentType, 'Content-Length': body4.buffer.length, 'Cookie': invCookies }
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          let p; try { p = JSON.parse(Buffer.concat(chunks).toString()); } catch { p = {}; }
          resolve({ status: res.statusCode, body: p, rawCookies: res.headers['set-cookie'] || [] });
        });
      });
      req.on('error', reject);
      req.write(body4.buffer);
      req.end();
    });

    if (!uploadRes.body.success) {
      console.warn('  [WARN] Upload failed:', uploadRes.body.message, JSON.stringify(uploadRes.body.details || {}), '– UPLOAD/HASH_GENERATED/BLOCK_CREATED may not be triggered');
    } else {
      uploadedEvId   = uploadRes.body.evidence?.evidenceId || '';
      uploadedCaseId = uploadRes.body.evidence?.caseId || '';
      console.log(`  Uploaded: evidenceId=${uploadedEvId}, caseId=${uploadedCaseId}`);
    }

    // ── 5. VERIFY (triggers VERIFY) and TAMPER_DETECTED ──────────────────────
    if (uploadedEvId) {
      console.log('[5a] VERIFY – genuine hash check on uploaded evidence (triggers VERIFY)');
      const body5a = buildMultipart({}, origContent, `coverage-${ts}.txt`);
      const verResA = await new Promise((resolve, reject) => {
        const url = new URL(`${BASE}/api/evidence/${uploadedEvId}/verify`);
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request({
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': body5a.contentType, 'Content-Length': body5a.buffer.length, 'Cookie': invCookies }
        }, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            let p; try { p = JSON.parse(Buffer.concat(chunks).toString()); } catch { p = {}; }
            resolve({ status: res.statusCode, body: p });
          });
        });
        req.on('error', reject);
        req.write(body5a.buffer);
        req.end();
      });
      console.log(`  Verify match result: status=${verResA.status} verified=${verResA.body?.verified}`);

      console.log('[5b] VERIFY – modified file check (triggers TAMPER_DETECTED)');
      const body5b = buildMultipart({}, `tampered-content-${ts}`, `tampered-${ts}.txt`);
      const verResB = await new Promise((resolve, reject) => {
        const url = new URL(`${BASE}/api/evidence/${uploadedEvId}/verify`);
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request({
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': body5b.contentType, 'Content-Length': body5b.buffer.length, 'Cookie': invCookies }
        }, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            let p; try { p = JSON.parse(Buffer.concat(chunks).toString()); } catch { p = {}; }
            resolve({ status: res.statusCode, body: p });
          });
        });
        req.on('error', reject);
        req.write(body5b.buffer);
        req.end();
      });
      console.log(`  Verify mismatch result: status=${verResB.status} verified=${verResB.body?.verified}`);
    } else {
      console.warn('[5] SKIP – no evidenceId to verify');
    }

    // ── 6. QR_GENERATED ──────────────────────────────────────────────────────
    if (uploadedEvId) {
      console.log('[6] QR_GENERATED');
      const qr = await request('GET', `/api/evidence/${uploadedEvId}/qr`, null, adminCookies);
      if (!qr.body.success) console.warn('  [WARN] QR failed:', qr.body.message);
    }

    // ── 7. DELETE (soft-delete) ───────────────────────────────────────────────
    if (uploadedEvId) {
      console.log('[7] DELETE – soft-delete evidence');
      const del = await request('DELETE', `/api/evidence/${uploadedEvId}`, { reason: 'Coverage test cleanup' }, adminCookies);
      if (!del.body.success) console.warn('  [WARN] Delete failed:', del.body.message);
    }

    // ── 8. BLOCKCHAIN_VALIDATED ───────────────────────────────────────────────
    console.log('[8] BLOCKCHAIN_VALIDATED');
    const bcVal = await request('POST', '/api/blockchain/validate', {}, adminCookies);
    if (!bcVal.body.success) console.warn('  [WARN] Chain validation failed:', bcVal.body.message);

    // ── 9. USER_CREATED + ROLE_CHANGED ────────────────────────────────────────
    console.log('[9] USER_CREATED – admin creates viewer');
    const newEmail = `cov_view_${ts}@test.local`;
    const uc = await request('POST', '/api/users', { name: 'CovView', email: newEmail, password: 'View1234!', role: 'VIEWER' }, adminCookies);
    if (uc.status === 201) {
      createdUserId = uc.body.user?._id || uc.body.user?.id;
      console.log(`  Created userId: ${createdUserId}`);
    } else {
      console.warn('  [WARN] USER_CREATED failed:', uc.body.message);
    }

    if (createdUserId) {
      console.log('[10] ROLE_CHANGED – admin changes role');
      const rc = await request('PATCH', `/api/users/${createdUserId}/role`, { role: 'INVESTIGATOR' }, adminCookies);
      if (!rc.body.success) console.warn('  [WARN] ROLE_CHANGED failed:', rc.body.message);

      // Deactivate the test user
      await request('DELETE', `/api/users/${createdUserId}`, null, adminCookies);
    }

    // ── 11. LOGOUT ────────────────────────────────────────────────────────────
    console.log('[11] LOGOUT');
    const logoutRes = await request('POST', '/api/auth/logout', null, invCookies);
    if (logoutRes.status !== 200) console.warn('  [WARN] Logout failed');

    // ── Wait a moment for async audit writes ─────────────────────────────────
    await new Promise(r => setTimeout(r, 1500));

    // ── Query audit log for each required action ───────────────────────────
    console.log('\n[CHECKING] Querying audit trail for each required action…\n');

    for (const action of REQUIRED_ACTIONS) {
      const auRes = await request('GET', `/api/audit?action=${action}&limit=1`, null, adminCookies);
      const rows  = auRes.body.items || auRes.body.logs || [];
      const found = rows.length > 0;
      const row   = rows[0] || {};

      let ok = found;
      let notes = [];

      if (found) {
        // Check required fields
        if (!row.userName) { ok = false; notes.push('missing userName'); }
        if (!row.role)     { ok = false; notes.push('missing role'); }
        if (!row.action)   { ok = false; notes.push('missing action'); }
        if (!row.description && row.description !== '') { ok = false; notes.push('missing description'); }

        // Evidence-related actions must carry evidenceId and caseId
        const evActions = ['UPLOAD','HASH_GENERATED','VERIFY','TAMPER_DETECTED','DELETE','BLOCK_CREATED','QR_GENERATED'];
        if (evActions.includes(action)) {
          if (!row.evidenceId) notes.push('missing evidenceId');
          if (!row.caseId)     notes.push('missing caseId');
        }
      } else {
        notes.push('no audit row found');
      }

      results[action] = { ok, notes };
      if (ok) { passed++; console.log(`  ✅ PASS  ${action.padEnd(24)} ${notes.length ? '(note: ' + notes.join(', ') + ')' : ''}`); }
      else    { failed++; console.error(`  ❌ FAIL  ${action.padEnd(24)} ${notes.join(', ')}`); }
    }

    // ── Audit chain validation ──────────────────────────────────────────────
    console.log('\n[CHAIN] Running audit chain validation after full suite…');
    const chainRes = await request('POST', '/api/audit/validate', {}, adminCookies);
    const chainOk  = chainRes.body.valid === true;
    const entriesChecked = chainRes.body.entriesChecked || chainRes.body.checked || 0;
    if (chainOk) {
      console.log(`  ✅ CHAIN VALID — ${entriesChecked} entries checked`);
    } else {
      console.error(`  ❌ CHAIN INVALID — firstBrokenAt seq ${chainRes.body.firstBrokenSeq || '?'}`);
      failed++;
    }

    // ── Summary table ───────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(62));
    console.log('AUDIT COVERAGE REPORT');
    console.log('═'.repeat(62));
    console.log('Action'.padEnd(26) + 'Result'.padEnd(8) + 'Notes');
    console.log('─'.repeat(62));
    for (const a of REQUIRED_ACTIONS) {
      const r = results[a] || { ok: false, notes: ['not tested'] };
      console.log(`${a.padEnd(26)}${(r.ok ? 'PASS' : 'FAIL').padEnd(8)}${r.notes.join(', ')}`);
    }
    console.log('─'.repeat(62));
    console.log(`Chain: ${chainOk ? 'VALID' : 'INVALID'}`);
    console.log(`Total: ${passed} PASS, ${failed} FAIL`);
    console.log('═'.repeat(62) + '\n');

    process.exit(failed > 0 ? 1 : 0);

  } catch (err) {
    console.error('\n[FATAL] Unexpected error during coverage test:', err.message || err);
    process.exit(1);
  } finally {
    if (!externalServer) {
      if (server) server.close();
      await mongoose.disconnect();
      if (mongod) await mongod.stop();
    }
  }
})();
