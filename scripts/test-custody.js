#!/usr/bin/env node
'use strict';

/**
 * Sprint 12A – Chain of Custody Model & API Test Suite
 * Tests:
 * 1. Automatic COLLECTED custody event created upon evidence upload
 * 2. Non-custodian blocked from initiating transfers (HTTP 403)
 * 3. Custodian initiates transfer, pending transfer state established
 * 4. Duplicate pending transfer rejected (HTTP 400)
 * 5. Non-recipient cannot accept transfer (HTTP 403)
 * 6. Recipient accepts transfer, custodian updated
 * 7. Optimistic concurrency conflict detected (parallel transfer attempts leave one winner, HTTP 409)
 * 8. Transfer expiry enforcement (> 72 hours rejected, HTTP 400)
 * 9. Automatic ACCESSED events on download and verify (auto: true, custodian unchanged)
 * 10. Custodian releases evidence to external party (terminal state until ADMIN returns)
 * 11. Illegal operations on RELEASED evidence rejected
 * 12. Non-admin cannot return released evidence; ADMIN returns evidence
 * 13. VIEWER role blocked from all custody endpoints (HTTP 403)
 * 14. Custody chain validation confirms valid contiguous sequence and hash links
 * 15. Direct tampering with a stored event is detected by custody validation
 * 16. Audit trail records CUSTODY_EVENT and CUSTODY_TRANSFER, audit chain remains VALID
 */

process.env.FEATURE_CUSTODY = 'true';
process.env.JWT_SECRET = 'test-custody-jwt-secret-key-32chars!';
require('dotenv').config();

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');

let BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

const ADMIN_EMAIL = 'admin_custody_12@evidenceguard.local';
const ADMIN_PASS  = 'AdminPass1234!';
const INV1_EMAIL  = 'investigator_custody_1@evidenceguard.local';
const INV1_PASS   = 'Investigator1Pass!';
const INV2_EMAIL  = 'investigator_custody_2@evidenceguard.local';
const INV2_PASS   = 'Investigator2Pass!';
const VIEWER_EMAIL = 'viewer_custody@evidenceguard.local';
const VIEWER_PASS  = 'ViewerPass1234!';

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

function request(method, pathUrl, body = null, cookies = null, isMultipart = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {}
    };

    if (cookies) {
      options.headers['Cookie'] = cookies;
    }

    let payload = null;

    if (isMultipart && body) {
      payload = body.buffer;
      options.headers['Content-Type'] = body.contentType;
      options.headers['Content-Length'] = payload.length;
    } else if (body) {
      payload = Buffer.from(JSON.stringify(body));
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = payload.length;
    }

    const reqLib = url.protocol === 'https:' ? https : http;
    const req = reqLib.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(data).toString('utf8');
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          parsed = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
          rawCookies: res.headers['set-cookie'] || []
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractCookie(rawCookies = []) {
  return rawCookies.map(c => c.split(';')[0]).join('; ');
}

async function uploadMultipart(pathUrl, fields, fileContent, fileName, cookies) {
  const fd = new FormData();
  const blob = new Blob([Buffer.from(fileContent)], { type: 'text/plain' });
  fd.append('file', blob, fileName);
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, v);
  }

  const res = await fetch(new URL(pathUrl, BASE).href, {
    method: 'POST',
    headers: {
      Cookie: cookies || ''
    },
    body: fd
  });

  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

(async () => {
  console.log('\n======================================================================');
  console.log('       EvidenceGuard Sprint 12A – Chain of Custody Test Suite         ');
  console.log('======================================================================\n');

  let mongod;
  let server;
  let externalServer = Boolean(process.env.TEST_BASE_URL);

  if (externalServer) {
    try {
      const health = await request('GET', '/api/health');
      if (health.status !== 200) externalServer = false;
    } catch (_) { externalServer = false; }
  }

  const User = require('../models/User');
  const Evidence = require('../models/Evidence');
  const CustodyEvent = require('../models/CustodyEvent');
  const Block = require('../models/Block');
  const AuditLog = require('../models/AuditLog');
  const { ensureGenesis } = require('../services/chainService');

  if (!externalServer) {
    console.log('[Setup] Starting in-memory MongoDB environment...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);

    await Promise.all([
      User.syncIndexes(),
      Evidence.syncIndexes(),
      CustodyEvent.syncIndexes(),
      Block.syncIndexes(),
      AuditLog.syncIndexes()
    ]);

    await ensureGenesis();

    const adminHash = await bcrypt.hash(ADMIN_PASS, 10);
    const inv1Hash  = await bcrypt.hash(INV1_PASS, 10);
    const inv2Hash  = await bcrypt.hash(INV2_PASS, 10);
    const viewHash  = await bcrypt.hash(VIEWER_PASS, 10);

    await User.create([
      { name: 'Admin Chief', email: ADMIN_EMAIL.toLowerCase(), passwordHash: adminHash, role: 'ADMIN', isActive: true },
      { name: 'Investigator Alpha', email: INV1_EMAIL.toLowerCase(), passwordHash: inv1Hash, role: 'INVESTIGATOR', isActive: true },
      { name: 'Investigator Bravo', email: INV2_EMAIL.toLowerCase(), passwordHash: inv2Hash, role: 'INVESTIGATOR', isActive: true },
      { name: 'Viewer Charlie', email: VIEWER_EMAIL.toLowerCase(), passwordHash: viewHash, role: 'VIEWER', isActive: true }
    ]);

    const app = require('../server');
    server = app.listen(0);
    const port = server.address().port;
    BASE = `http://localhost:${port}`;
  }

  console.log(`[Target] Connected to ${BASE}\n`);

  let adminCookies, inv1Cookies, inv2Cookies, viewCookies;
  let inv1User, inv2User, adminUser;

  // 1. Authentication
  console.log('--- [1] Authentication Setup ---');
  const loginRes1 = await request('POST', '/api/auth/login', { email: INV1_EMAIL, password: INV1_PASS });
  assert('Investigator 1 login succeeds', loginRes1.status === 200);
  inv1Cookies = extractCookie(loginRes1.rawCookies);
  inv1User    = loginRes1.body.user;

  const loginRes2 = await request('POST', '/api/auth/login', { email: INV2_EMAIL, password: INV2_PASS });
  assert('Investigator 2 login succeeds', loginRes2.status === 200);
  inv2Cookies = extractCookie(loginRes2.rawCookies);
  inv2User    = loginRes2.body.user;

  const loginAdmin = await request('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  assert('Admin login succeeds', loginAdmin.status === 200);
  adminCookies = extractCookie(loginAdmin.rawCookies);
  adminUser    = loginAdmin.body.user;

  const loginView = await request('POST', '/api/auth/login', { email: VIEWER_EMAIL, password: VIEWER_PASS });
  assert('Viewer login succeeds', loginView.status === 200);
  viewCookies = extractCookie(loginView.rawCookies);

  // 2. Upload Evidence & Automatic COLLECTED Event
  console.log('\n--- [2] Evidence Upload & Automatic COLLECTED Event ---');
  const fileContent1 = `Chain of custody test sample payload ${Date.now()}`;
  const uploadRes = await uploadMultipart(
    '/api/evidence',
    { name: 'Bloodstained Knife', caseId: 'EG-2026-0101', type: 'Other', description: 'Recovered from scene' },
    fileContent1,
    'knife_specimen.txt',
    inv1Cookies
  );
  assert('Evidence upload succeeds with HTTP 201', uploadRes.status === 201, JSON.stringify(uploadRes.body));
  const ev1 = uploadRes.body.evidence;
  assert('Evidence ID issued', !!ev1?.evidenceId);

  const custodyRes1 = await request('GET', `/api/evidence/${ev1.evidenceId}/custody`, null, inv1Cookies);
  assert('GET evidence custody returns HTTP 200', custodyRes1.status === 200);
  assert('Total custody events is 1 (auto-collected)', custodyRes1.body.totalEvents === 1);
  assert('Current status is IN_CUSTODY', custodyRes1.body.status === 'IN_CUSTODY');
  assert('Current custodian is Investigator Alpha', custodyRes1.body.currentCustodian?.userId === String(inv1User._id || inv1User.id));
  assert('First event type is COLLECTED', custodyRes1.body.events[0]?.type === 'COLLECTED');
  assert('First event prevHash is genesis 0000000000000000', custodyRes1.body.events[0]?.prevHash === '0000000000000000');
  assert('First event auto flag is true', custodyRes1.body.events[0]?.auto === true);

  // 3. RBAC Enforcement: VIEWER Role Blocked
  console.log('\n--- [3] Role-Based Access Control: VIEWER Blocked ---');
  const viewCustodyGet = await request('GET', `/api/evidence/${ev1.evidenceId}/custody`, null, viewCookies);
  assert('VIEWER GET custody returns HTTP 403', viewCustodyGet.status === 403);
  assert('VIEWER error code is FORBIDDEN', viewCustodyGet.body?.code === 'FORBIDDEN');

  const viewCustodyPost = await request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'ANALYZED',
    reason: 'Viewing unauthorized analysis'
  }, viewCookies);
  assert('VIEWER POST custody returns HTTP 403', viewCustodyPost.status === 403);

  const viewCustodyMine = await request('GET', '/api/custody/mine', null, viewCookies);
  assert('VIEWER GET /api/custody/mine returns HTTP 403', viewCustodyMine.status === 403);

  const viewValidate = await request('POST', `/api/evidence/${ev1.evidenceId}/custody/validate`, null, viewCookies);
  assert('VIEWER POST custody validate returns HTTP 403', viewValidate.status === 403);

  // 4. Non-Custodian Blocked From Initiating Transfer
  console.log('\n--- [4] Non-Custodian Blocked From Transfer ---');
  const invalidTransfer = await request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'TRANSFER_INITIATED',
    toUserId: inv1User._id || inv1User.id,
    reason: 'Unauthorized transfer attempt by non-custodian'
  }, inv2Cookies);
  assert('Non-custodian transfer returns HTTP 403', invalidTransfer.status === 403);
  assert('Error code indicates not current custodian', invalidTransfer.body?.code === 'NOT_CURRENT_CUSTODIAN');

  // 5. Custodian Initiates Transfer
  console.log('\n--- [5] Custodian Initiates Transfer ---');
  const initiateRes = await request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'TRANSFER_INITIATED',
    toUserId: inv2User._id || inv2User.id,
    reason: 'Transferring to forensics investigator for DNA profiling',
    location: 'Forensics Lab Intake Room 3',
    conditionNotes: 'Intact in tamper-evident sealed container'
  }, inv1Cookies);
  assert('Transfer initiation returns HTTP 201', initiateRes.status === 201);
  const pendingEvent = initiateRes.body.event;
  assert('Initiated event seq is 2', pendingEvent.seq === 2);
  assert('Initiated event has valid entryHash', !!pendingEvent.entryHash && pendingEvent.entryHash.length === 64);
  assert('Initiated event links to seq 1 entryHash', pendingEvent.prevHash === custodyRes1.body.events[0].entryHash);

  const custodyRes2 = await request('GET', `/api/evidence/${ev1.evidenceId}/custody`, null, inv1Cookies);
  assert('Evidence status updated to PENDING_TRANSFER', custodyRes2.body.status === 'PENDING_TRANSFER');
  assert('Pending transfer recipient is Investigator Bravo', custodyRes2.body.pendingTransfer?.toUserId === String(inv2User._id || inv2User.id));

  // Check /api/custody/mine for both users
  const mineInv2 = await request('GET', '/api/custody/mine', null, inv2Cookies);
  assert('Investigator 2 has 1 pending incoming transfer', mineInv2.body.counts?.incoming === 1);
  assert('Incoming transfer evidenceId matches', mineInv2.body.pendingIncoming[0]?.evidence?.evidenceId === ev1.evidenceId);

  const mineInv1 = await request('GET', '/api/custody/mine', null, inv1Cookies);
  assert('Investigator 1 has 1 pending outgoing transfer', mineInv1.body.counts?.outgoing === 1);

  // 6. Duplicate Pending Transfer Rejected
  console.log('\n--- [6] Duplicate Pending Transfer Rejected ---');
  const dupTransfer = await request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'TRANSFER_INITIATED',
    toUserId: adminUser._id || adminUser.id,
    reason: 'Concurrent transfer attempt should fail'
  }, inv1Cookies);
  assert('Concurrent transfer attempt returns HTTP 400', dupTransfer.status === 400);
  assert('Error code indicates transfer already pending', dupTransfer.body?.code === 'TRANSFER_ALREADY_PENDING');

  // 7. Non-Recipient Cannot Accept Transfer
  console.log('\n--- [7] Non-Recipient Acceptance Blocked ---');
  const badAccept = await request('POST', `/api/custody/${pendingEvent.custodyId}/accept`, {
    reason: 'Investigator 1 trying to accept their own transfer'
  }, inv1Cookies);
  assert('Non-recipient accept returns HTTP 403', badAccept.status === 403);
  assert('Error code indicates not transfer recipient', badAccept.body?.code === 'NOT_TRANSFER_RECIPIENT');

  // 8. Recipient Accepts Transfer
  console.log('\n--- [8] Recipient Accepts Custody Transfer ---');
  const acceptRes = await request('POST', `/api/custody/${pendingEvent.custodyId}/accept`, {
    reason: 'Specimen received in good condition, seal intact',
    location: 'DNA Extraction Room'
  }, inv2Cookies);
  assert('Recipient accept returns HTTP 200', acceptRes.status === 200);
  const acceptEvent = acceptRes.body.event;
  assert('Accept event seq is 3', acceptEvent.seq === 3);

  const custodyRes3 = await request('GET', `/api/evidence/${ev1.evidenceId}/custody`, null, inv2Cookies);
  assert('Evidence status returned to IN_CUSTODY', custodyRes3.body.status === 'IN_CUSTODY');
  assert('Current custodian is now Investigator Bravo', custodyRes3.body.currentCustodian?.userId === String(inv2User._id || inv2User.id));
  assert('Pending transfer cleared to null', custodyRes3.body.pendingTransfer === null);

  const mineInv2After = await request('GET', '/api/custody/mine', null, inv2Cookies);
  assert('Investigator 2 holds item in custody', mineInv2After.body.counts?.held === 1);
  assert('Investigator 2 incoming count is 0', mineInv2After.body.counts?.incoming === 0);

  // 9. Optimistic Concurrency Conflict (Parallel attempts leave one winner)
  console.log('\n--- [9] Optimistic Concurrency & Conflict Rejection ---');
  const parallelPromiseA = request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'ANALYZED',
    reason: 'Concurrent test branch A: DNA swab analysis performed',
    location: 'Lab Bench 1',
    expectedSeq: 4
  }, inv2Cookies);

  const parallelPromiseB = request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'STORED',
    reason: 'Concurrent test branch B: Evidence stored in cold locker',
    location: 'Cold Locker 2',
    expectedSeq: 4
  }, inv2Cookies);

  const [resA, resB] = await Promise.all([parallelPromiseA, parallelPromiseB]);
  const statuses = [resA.status, resB.status];
  assert('One parallel request succeeds (HTTP 201)', statuses.includes(201));
  assert('The conflicting parallel request is rejected (HTTP 409)', statuses.includes(409));
  const conflictRes = resA.status === 409 ? resA : resB;
  assert('Conflict error code is CONCURRENCY_CONFLICT', conflictRes.body?.code === 'CONCURRENCY_CONFLICT');

  // 10. Transfer Expiry (> 72 Hours)
  console.log('\n--- [10] Transfer Expiration Enforcement ---');
  // Upload a second piece of evidence
  const uploadRes2 = await uploadMultipart(
    '/api/evidence',
    { name: 'Fingerprinted Glass', caseId: 'EG-2026-0101', type: 'Other', description: 'Latent print specimen' },
    'Glass payload content',
    'glass_specimen.txt',
    inv1Cookies
  );
  const ev2 = uploadRes2.body.evidence;

  // Initiate transfer from Inv 1 to Inv 2
  const initRes2 = await request('POST', `/api/evidence/${ev2.evidenceId}/custody`, {
    type: 'TRANSFER_INITIATED',
    toUserId: inv2User._id || inv2User.id,
    reason: 'Transfer for latent fingerprint dusting'
  }, inv1Cookies);
  const transferToExpire = initRes2.body.event;

  // Directly adjust expiresAt to 1 hour in the past to simulate 72 hours elapsed
  await mongoose.connection.collection('custodyevents').updateOne(
    { custodyId: transferToExpire.custodyId },
    { $set: { expiresAt: new Date(Date.now() - 3600000) } }
  );

  const expiredAccept = await request('POST', `/api/custody/${transferToExpire.custodyId}/accept`, {
    reason: 'Attempting to accept expired transfer'
  }, inv2Cookies);
  assert('Accepting expired transfer returns HTTP 400', expiredAccept.status === 400);
  assert('Error code indicates transfer expired', expiredAccept.body?.code === 'TRANSFER_EXPIRED');

  // 11. Automatic ACCESSED Events on Download & Verify
  console.log('\n--- [11] Automatic ACCESSED Events (Download & Verification) ---');
  const countBeforeAccess = (await request('GET', `/api/evidence/${ev1.evidenceId}/custody`, null, inv2Cookies)).body.totalEvents;

  // Download evidence
  const downloadRes = await request('GET', `/api/evidence/${ev1.evidenceId}/download`, null, inv1Cookies);
  assert('Evidence download returns HTTP 200', downloadRes.status === 200);

  const custodyAfterDownload = await request('GET', `/api/evidence/${ev1.evidenceId}/custody`, null, inv2Cookies);
  assert('Custody events incremented after download', custodyAfterDownload.body.totalEvents === countBeforeAccess + 1);
  const downloadEvent = custodyAfterDownload.body.events[custodyAfterDownload.body.events.length - 1];
  assert('Appended event is ACCESSED', downloadEvent.type === 'ACCESSED');
  assert('ACCESSED event auto is true', downloadEvent.auto === true);
  assert('Custodian remains Investigator Bravo', custodyAfterDownload.body.currentCustodian?.userId === String(inv2User._id || inv2User.id));

  // Verify evidence
  const verifyRes = await uploadMultipart(`/api/evidence/${ev1.evidenceId}/verify`, {}, fileContent1, 'knife_specimen.txt', inv1Cookies);
  assert('Verification request returns HTTP 200', verifyRes.status === 200);

  const custodyAfterVerify = await request('GET', `/api/evidence/${ev1.evidenceId}/custody`, null, inv2Cookies);
  assert('Custody events incremented after verify', custodyAfterVerify.body.totalEvents === countBeforeAccess + 2);
  const verifyEvent = custodyAfterVerify.body.events[custodyAfterVerify.body.events.length - 1];
  assert('Appended event is ACCESSED', verifyEvent.type === 'ACCESSED');
  assert('Custodian remains unchanged', custodyAfterVerify.body.currentCustodian?.userId === String(inv2User._id || inv2User.id));

  // 12. Release to External Party & Terminal State
  console.log('\n--- [12] Evidence Release & Terminal State ---');
  const releaseRes = await request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'RELEASED',
    externalParty: { name: 'Judge Arthur Vance', organization: 'County District Court' },
    reason: 'Submitted into evidence for trial exhibit State v. Doe',
    location: 'Courtroom 4B'
  }, inv2Cookies);
  assert('Evidence release returns HTTP 201', releaseRes.status === 201);

  const custodyAfterRelease = await request('GET', `/api/evidence/${ev1.evidenceId}/custody`, null, inv2Cookies);
  assert('Custody status is RELEASED', custodyAfterRelease.body.status === 'RELEASED');
  assert('Current custodian is null (held externally)', custodyAfterRelease.body.currentCustodian === null);
  assert('External party recorded', custodyAfterRelease.body.externalParty?.name === 'Judge Arthur Vance');

  // Illegal operations on released evidence
  const illegalTransferOnReleased = await request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'TRANSFER_INITIATED',
    toUserId: inv1User._id || inv1User.id,
    reason: 'Cannot transfer released evidence'
  }, inv2Cookies);
  assert('Action on released evidence rejected with HTTP 400', illegalTransferOnReleased.status === 400);
  assert('Error code indicates evidence is released', illegalTransferOnReleased.body?.code === 'EVIDENCE_IS_RELEASED');

  // Non-admin cannot return evidence
  const nonAdminReturn = await request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'RETURNED',
    toUserId: inv2User._id || inv2User.id,
    reason: 'Investigator attempting to return evidence without admin authority'
  }, inv2Cookies);
  assert('Non-admin return returns HTTP 403', nonAdminReturn.status === 403);

  // Admin returns evidence
  const adminReturn = await request('POST', `/api/evidence/${ev1.evidenceId}/custody`, {
    type: 'RETURNED',
    toUserId: inv1User._id || inv1User.id,
    reason: 'Trial concluded; evidence returned from court custody to investigator vault'
  }, adminCookies);
  assert('Admin return returns HTTP 201', adminReturn.status === 201);

  const custodyAfterReturn = await request('GET', `/api/evidence/${ev1.evidenceId}/custody`, null, adminCookies);
  assert('Custody status restored to IN_CUSTODY', custodyAfterReturn.body.status === 'IN_CUSTODY');
  assert('Custodian updated to Investigator Alpha', custodyAfterReturn.body.currentCustodian?.userId === String(inv1User._id || inv1User.id));

  // 13. Cryptographic Chain Validation
  console.log('\n--- [13] Custody Chain Cryptographic Validation ---');
  const validateRes = await request('POST', `/api/evidence/${ev1.evidenceId}/custody/validate`, null, inv1Cookies);
  assert('Validate endpoint returns HTTP 200', validateRes.status === 200);
  assert('Custody chain reports VALID', validateRes.body.valid === true);
  assert('No issues detected in unbroken chain', validateRes.body.issues?.length === 0);

  // 14. Tampering Detection
  console.log('\n--- [14] Custody Tamper Detection ---');
  const rawEvents = await mongoose.connection.collection('custodyevents').find({ evidenceId: ev1.evidenceId }).sort({ seq: 1 }).toArray();
  const targetTamperEvent = rawEvents[1]; // Tamper with event seq 2
  const originalReason = targetTamperEvent.reason;

  // Tamper directly with the stored reason in the raw database collection
  await mongoose.connection.collection('custodyevents').updateOne(
    { _id: targetTamperEvent._id },
    { $set: { reason: 'TAMPERED: Altered reason payload unauthorized modification' } }
  );

  const tamperedValidation = await request('POST', `/api/evidence/${ev1.evidenceId}/custody/validate`, null, inv1Cookies);
  assert('Tampered custody chain returns valid: false', tamperedValidation.body.valid === false);
  assert('Tampered issue check is ENTRY_HASH_MATCH', tamperedValidation.body.issues.some(i => i.check === 'ENTRY_HASH_MATCH'));

  // Restore the original record
  await mongoose.connection.collection('custodyevents').updateOne(
    { _id: targetTamperEvent._id },
    { $set: { reason: originalReason } }
  );

  const restoredValidation = await request('POST', `/api/evidence/${ev1.evidenceId}/custody/validate`, null, inv1Cookies);
  assert('Restored custody chain returns valid: true', restoredValidation.body.valid === true);
  assert('Restored chain has 0 issues', restoredValidation.body.issues.length === 0);

  // 15. Audit Log Coverage
  console.log('\n--- [15] Audit Trail Event Coverage ---');
  const auditRes = await request('GET', `/api/audit?evidenceId=${ev1.evidenceId}`, null, adminCookies);
  assert('GET /api/audit returns HTTP 200', auditRes.status === 200);
  const auditLogs = auditRes.body.items || auditRes.body.logs || [];
  assert('CUSTODY_EVENT actions logged in audit trail', auditLogs.some(l => l.action === 'CUSTODY_EVENT'));
  assert('CUSTODY_TRANSFER actions logged in audit trail', auditLogs.some(l => l.action === 'CUSTODY_TRANSFER'));

  const validateAudit = await request('POST', '/api/audit/validate', null, adminCookies);
  assert('Audit hash chain remains VALID', validateAudit.body.valid === true);

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n======================================================================');
  console.log(`SPRINT 12A TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (!externalServer && server) server.close();
  if (mongod) await mongod.stop();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})().catch(err => {
  console.error('\n[FATAL TEST RUNNER CRASH]', err);
  process.exit(1);
});
