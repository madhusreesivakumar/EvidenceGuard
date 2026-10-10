#!/usr/bin/env node
'use strict';

/**
 * EvidenceGuard – Master End-to-End Workflow Test
 * Live server integration test executing the complete 14-step master specification:
 *
 * 1. Register ->
 * 2. Login ->
 * 3. Dashboard stats ->
 * 4. Upload evidence ->
 * 5. SHA-256 equals a locally computed hash ->
 * 6. MongoDB record exists ->
 * 7. Blockchain block exists and links to the previous block ->
 * 8. Records list shows it ->
 * 9. Verify original file = VERIFIED ->
 * 10. Verify modified file = TAMPERED ->
 * 11. Audit trail contains UPLOAD, HASH_GENERATED, BLOCK_CREATED, VERIFY, TAMPER_DETECTED ->
 * 12. QR generated and public view returns only whitelisted fields ->
 * 13. Blockchain validation = "BLOCKCHAIN INTEGRITY: VALID" ->
 * 14. Audit chain validation = "AUDIT CHAIN: VALID"
 *
 * Usage:
 *   node scripts/test-e2e.js
 */

require('dotenv').config();
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || 'admin@evidenceguard.local';
const ADMIN_PASS  = process.env.TEST_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || 'Admin1234!';

const TS = Date.now();
const INV_NAME  = 'Agent Carter';
const INV_EMAIL = `investigator_${TS}@evidenceguard.local`;
const INV_PASS  = 'Investigator2026!';

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

function request(method, urlPath, body, cookies, isMultipart) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    let bodyBuf = null;
    const headers = {};

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
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let parsed;
        const rawText = Buffer.concat(chunks).toString();
        try { parsed = JSON.parse(rawText); } catch { parsed = { raw: rawText }; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
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
  return rawCookies.map(c => c.split(';')[0]).join('; ');
}

function buildMultipart(fields, fileBuffer, fileName) {
  const boundary = '----E2EBoundary' + Date.now();
  const parts = [];

  for (const [k, v] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  }

  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n`
  );

  const head = Buffer.from(parts.join(''));
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const buffer = Buffer.concat([head, fileBuffer, tail]);

  return {
    buffer,
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

// ─── Main Execution ───────────────────────────────────────────────────────────

(async () => {
  console.log('\n======================================================================');
  console.log('              EvidenceGuard Master End-to-End Workflow Test          ');
  console.log('======================================================================\n');

  let server;
  let mongod;
  let externalServer = Boolean(process.env.TEST_BASE_URL);

  if (externalServer) {
    try {
      const health = await request('GET', '/api/health');
      if (health.status !== 200) externalServer = false;
    } catch (_) { externalServer = false; }
  }

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-e2e-workflow-jwt-secret-key-32chars!';
  process.env.STORAGE_DRIVER = 'local';
  process.env.MAX_UPLOAD_MB = '50';

  const mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const bcrypt = require('bcrypt');
  const User = require('../models/User');
  const Evidence = require('../models/Evidence');
  const Block = require('../models/Block');
  const AuditLog = require('../models/AuditLog');
  const Counter = require('../models/Counter');
  const { ensureGenesis } = require('../services/chainService');

  if (!externalServer) {
    console.log('[Setup] Starting live in-memory server & MongoDB instance...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);

    await Promise.all([
      User.syncIndexes(),
      Evidence.syncIndexes(),
      Block.syncIndexes(),
      AuditLog.syncIndexes(),
      Counter.syncIndexes()
    ]);
    await ensureGenesis();

    const adminHash = await bcrypt.hash(ADMIN_PASS, 10);
    await User.create({
      name: 'System Admin',
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

  console.log(`[Target]  Connected to ${BASE}\n`);

  let invCookies = '';
  let adminCookies = '';
  let evidenceData = null;
  let localHash = '';
  let originalFileBuf = null;

  try {
    // ── STEP 1: Register ─────────────────────────────────────────────────────
    console.log('Step 1: Register');
    const regRes = await request('POST', '/api/auth/register', {
      name: INV_NAME,
      email: INV_EMAIL,
      password: INV_PASS
    });
    if (regRes.status !== 201 || !regRes.body.user) {
      throw new Error(`Register failed with status ${regRes.status}: ${JSON.stringify(regRes.body)}`);
    }
    const invUserId = regRes.body.user._id || regRes.body.user.id;
    console.log(`  ✅ Registered new account: ${INV_EMAIL} (role: ${regRes.body.user.role})`);

    // ── Admin Login & Role Promotion ─────────────────────────────────────────
    const adminLoginRes = await request('POST', '/api/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASS
    });
    if (adminLoginRes.status !== 200) {
      throw new Error(`Admin login failed: ${adminLoginRes.status}`);
    }
    adminCookies = extractCookie(adminLoginRes.rawCookies);

    // Promote new account to INVESTIGATOR
    const promoRes = await request('PATCH', `/api/users/${invUserId}/role`, { role: 'INVESTIGATOR' }, adminCookies);
    if (promoRes.status !== 200) {
      throw new Error(`Failed to promote user to INVESTIGATOR: ${JSON.stringify(promoRes.body)}`);
    }

    // ── STEP 2: Login ────────────────────────────────────────────────────────
    console.log('Step 2: Login');
    const loginRes = await request('POST', '/api/auth/login', {
      email: INV_EMAIL,
      password: INV_PASS
    });
    if (loginRes.status !== 200 || !loginRes.body.user) {
      throw new Error(`Login failed with status ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
    }
    invCookies = extractCookie(loginRes.rawCookies);
    console.log(`  ✅ Authenticated as ${loginRes.body.user.name} (role: ${loginRes.body.user.role})`);

    // ── STEP 3: Dashboard stats ──────────────────────────────────────────────
    console.log('Step 3: Dashboard stats');
    const statsRes = await request('GET', '/api/dashboard/stats', null, invCookies);
    if (statsRes.status !== 200 || !statsRes.body.success) {
      throw new Error(`Dashboard stats failed with status ${statsRes.status}: ${JSON.stringify(statsRes.body)}`);
    }
    console.log(`  ✅ Dashboard metrics retrieved: Total Evidence: ${statsRes.body.evidence?.total ?? 0}, Blocks: ${statsRes.body.blockchain?.totalBlocks ?? 1}`);

    // ── STEP 4: Upload evidence ──────────────────────────────────────────────
    console.log('Step 4: Upload evidence');
    const rawContent = `Digital Forensic Evidence Sample Payload - Timestamp ${TS}\nConfidential Chain of Custody Log`;
    originalFileBuf = Buffer.from(rawContent, 'utf8');
    localHash = crypto.createHash('sha256').update(originalFileBuf).digest('hex');

    const uploadPayload = buildMultipart(
      {
        name: `Cyber Incident Report ${TS}`,
        caseId: `EG-${new Date().getFullYear()}-8888`,
        type: 'Document',
        description: 'Forensic memory capture and transmission logs.'
      },
      originalFileBuf,
      `evidence-${TS}.txt`
    );

    const uploadRes = await request('POST', '/api/evidence', uploadPayload, invCookies, true);
    if (uploadRes.status !== 201 || !uploadRes.body.success || !uploadRes.body.evidence) {
      throw new Error(`Evidence upload failed with status ${uploadRes.status}: ${JSON.stringify(uploadRes.body)}`);
    }
    evidenceData = uploadRes.body.evidence;
    console.log(`  ✅ Uploaded evidence: ID ${evidenceData.evidenceId}, Case ${evidenceData.caseId}`);

    // ── STEP 5: SHA-256 equals a locally computed hash ────────────────────────
    console.log('Step 5: SHA-256 equals a locally computed hash');
    if (evidenceData.hash !== localHash) {
      throw new Error(`Hash mismatch! Server: ${evidenceData.hash}, Local: ${localHash}`);
    }
    console.log(`  ✅ SHA-256 verified matches local computation:`);
    console.log(`     ${evidenceData.hash}`);

    // ── STEP 6: MongoDB record exists ────────────────────────────────────────
    console.log('Step 6: MongoDB record exists');
    const dbRecord = await Evidence.findOne({ evidenceId: evidenceData.evidenceId });
    if (!dbRecord) {
      throw new Error(`MongoDB record for ${evidenceData.evidenceId} not found in database!`);
    }
    if (dbRecord.hash !== localHash || dbRecord.status !== 'Pending') {
      throw new Error(`MongoDB record invalid fields: hash=${dbRecord.hash}, status=${dbRecord.status}`);
    }
    console.log(`  ✅ MongoDB document confirmed present with status: ${dbRecord.status}`);

    // ── STEP 7: Blockchain block exists and links to previous block ──────────
    console.log('Step 7: Blockchain block exists and links to the previous block');
    const block = await Block.findOne({ evidenceId: evidenceData.evidenceId });
    if (!block) {
      throw new Error(`Blockchain block for ${evidenceData.evidenceId} not found!`);
    }
    if (block.evidenceHash !== localHash) {
      throw new Error(`Block evidenceHash mismatch: expected ${localHash}, found ${block.evidenceHash}`);
    }

    const prevBlock = await Block.findOne({ blockNumber: block.blockNumber - 1 });
    if (!prevBlock) {
      throw new Error(`Previous block (#${block.blockNumber - 1}) not found!`);
    }
    if (block.previousHash !== prevBlock.currentHash) {
      throw new Error(`Block previousHash link broken! Expected ${prevBlock.currentHash}, found ${block.previousHash}`);
    }
    console.log(`  ✅ Block #${block.blockNumber} exists and cryptographically links to block #${prevBlock.blockNumber}:`);
    console.log(`     Previous: ${block.previousHash.slice(0, 24)}...`);
    console.log(`     Current:  ${block.currentHash.slice(0, 24)}...`);

    // ── STEP 8: Records list shows it ────────────────────────────────────────
    console.log('Step 8: Records list shows it');
    const listRes = await request('GET', `/api/evidence?q=${evidenceData.evidenceId}`, null, invCookies);
    if (listRes.status !== 200 || !Array.isArray(listRes.body.items)) {
      throw new Error(`Failed to list evidence: status ${listRes.status}`);
    }
    const foundItem = listRes.body.items.find(e => e.evidenceId === evidenceData.evidenceId);
    if (!foundItem) {
      throw new Error(`Evidence ${evidenceData.evidenceId} not found in search results!`);
    }
    console.log(`  ✅ Records list confirmed containing ${evidenceData.evidenceId}`);

    // ── STEP 9: Verify original file = VERIFIED ──────────────────────────────
    console.log('Step 9: Verify original file = VERIFIED');
    const verifyPayloadOrig = buildMultipart({}, originalFileBuf, `verify-${TS}.txt`);
    const verifyResOrig = await request('POST', `/api/evidence/${evidenceData.evidenceId}/verify`, verifyPayloadOrig, invCookies, true);
    if (verifyResOrig.status !== 200 || verifyResOrig.body.result !== 'VERIFIED') {
      throw new Error(`Expected VERIFIED, got: ${JSON.stringify(verifyResOrig.body)}`);
    }
    console.log(`  ✅ Verification with genuine file returned result: ${verifyResOrig.body.result}`);

    // ── STEP 10: Verify modified file = TAMPERED ─────────────────────────────
    console.log('Step 10: Verify modified file = TAMPERED');
    const tamperedBuf = Buffer.from(rawContent + ' [MODIFIED BY MALICIOUS ACTOR]', 'utf8');
    const verifyPayloadTamp = buildMultipart({}, tamperedBuf, `tampered-${TS}.txt`);
    const verifyResTamp = await request('POST', `/api/evidence/${evidenceData.evidenceId}/verify`, verifyPayloadTamp, invCookies, true);
    if (verifyResTamp.status !== 200 || verifyResTamp.body.result !== 'TAMPERED') {
      throw new Error(`Expected TAMPERED, got: ${JSON.stringify(verifyResTamp.body)}`);
    }
    console.log(`  ✅ Verification with tampered file returned result: ${verifyResTamp.body.result}`);

    // ── STEP 11: Audit trail contains all 5 required actions ───────────────────
    console.log('Step 11: Audit trail contains UPLOAD, HASH_GENERATED, BLOCK_CREATED, VERIFY, TAMPER_DETECTED');
    const auditRes = await request('GET', `/api/audit?evidenceId=${evidenceData.evidenceId}`, null, adminCookies);
    if (auditRes.status !== 200 || !Array.isArray(auditRes.body.items)) {
      throw new Error(`Failed to query audit trail: status ${auditRes.status}`);
    }
    const auditActions = new Set(auditRes.body.items.map(i => i.action));
    const REQUIRED_AUDIT = ['UPLOAD', 'HASH_GENERATED', 'BLOCK_CREATED', 'VERIFY', 'TAMPER_DETECTED'];
    for (const reqAct of REQUIRED_AUDIT) {
      if (!auditActions.has(reqAct)) {
        throw new Error(`Audit trail missing required action: ${reqAct}`);
      }
    }
    console.log(`  ✅ All 5 required actions present in audit trail: ${REQUIRED_AUDIT.join(', ')}`);

    // ── STEP 12: QR generated and public view returns only whitelisted fields ─
    console.log('Step 12: QR generated and public view returns only whitelisted fields');
    const qrRes = await request('GET', `/api/evidence/${evidenceData.evidenceId}/qr`, null, invCookies);
    if (qrRes.status !== 200 || !qrRes.body.success || !qrRes.body.pngDataUrl) {
      throw new Error(`QR generation failed: ${JSON.stringify(qrRes.body)}`);
    }
    console.log(`  ✅ QR Code generated successfully: ${qrRes.body.url}`);

    // Public verification without login
    const pubRes = await request('GET', `/api/public/verify/${evidenceData.publicToken}`);
    if (pubRes.status !== 200 || !pubRes.body.caseId) {
      throw new Error(`Public verification endpoint failed: ${JSON.stringify(pubRes.body)}`);
    }

    const returnedKeys = Object.keys(pubRes.body).sort();
    const ALLOWED_KEYS = ['caseId', 'evidenceId', 'hash', 'isDemo', 'note', 'registeredAt', 'status', 'statusAsOf', 'type'].sort();

    for (const k of returnedKeys) {
      if (!ALLOWED_KEYS.includes(k)) {
        throw new Error(`Public verification leaked unauthorized field: "${k}"!`);
      }
    }

    // Explicit check for sensitive fields
    const FORBIDDEN_FIELDS = ['storageKey', '_id', 'filePath', 'uploadedBy', 'clientHash', '__v', 'ipAddress'];
    for (const forbidden of FORBIDDEN_FIELDS) {
      if (pubRes.body[forbidden] !== undefined) {
        throw new Error(`Public verification response contains forbidden field: "${forbidden}"`);
      }
    }
    console.log(`  ✅ Public view strictly restricted to whitelisted keys: ${returnedKeys.join(', ')}`);

    // ── STEP 13: Blockchain validation = "BLOCKCHAIN INTEGRITY: VALID" ───────
    console.log('Step 13: Blockchain validation');
    const bcRes = await request('POST', '/api/blockchain/validate', {}, adminCookies);
    if (bcRes.status !== 200 || bcRes.body.valid !== true) {
      throw new Error(`Blockchain validation failed: ${JSON.stringify(bcRes.body)}`);
    }
    console.log('  ✅ BLOCKCHAIN INTEGRITY: VALID');

    // ── STEP 14: Audit chain validation = "AUDIT CHAIN: VALID" ───────────────
    console.log('Step 14: Audit chain validation');
    const auValRes = await request('POST', '/api/audit/validate', {}, adminCookies);
    if (auValRes.status !== 200 || auValRes.body.valid !== true) {
      throw new Error(`Audit chain validation failed: ${JSON.stringify(auValRes.body)}`);
    }
    console.log('  ✅ AUDIT CHAIN: VALID');

    // ── Conclusion ────────────────────────────────────────────────────────────
    console.log('\n======================================================================');
    console.log('       ALL 14 STEPS OF THE END-TO-END WORKFLOW TEST PASSED (100%)     ');
    console.log('======================================================================\n');

    process.exit(0);

  } catch (err) {
    console.error('\n❌ [E2E WORKFLOW FAILURE]:', err.message || err);
    process.exit(1);
  } finally {
    if (!externalServer) {
      if (server) server.close();
      await mongoose.disconnect();
      if (mongod) await mongod.stop();
    }
  }
})();
