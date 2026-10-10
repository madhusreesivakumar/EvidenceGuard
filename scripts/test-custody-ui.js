'use strict';

/**
 * scripts/test-custody-ui.js
 * Sprint 12B – Chain of Custody UI, Candidate Officers & End-to-End Workflow Test Suite
 */

process.env.FEATURE_CUSTODY = 'true';
process.env.JWT_SECRET = 'test-custody-ui-jwt-secret-key-32chars!';
process.env.PORT = '3000';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');
const { ensureGenesis } = require('../services/chainService');

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${testName} ${details ? '— ' + details : ''}`);
  }
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json || data,
          rawBody: data
        });
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

function extractCookie(res, cookieName) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return null;
  for (const c of setCookie) {
    if (c.startsWith(cookieName + '=')) {
      return c.split(';')[0];
    }
  }
  return null;
}

async function runTests() {
  console.log('\n======================================================================');
  console.log('       EvidenceGuard Sprint 12B – Chain of Custody UI Test Suite      ');
  console.log('======================================================================\n');

  // --- [1] Static Files & Markup Verification ---
  console.log('--- [1] Static Files & HTML Component Verification ---');
  const custodyHtmlPath = path.join(__dirname, '..', 'public', 'custody.html');
  const detailsHtmlPath = path.join(__dirname, '..', 'public', 'evidence-details.html');
  const cssPath = path.join(__dirname, '..', 'public', 'style.css');
  const pageLogicPath = path.join(__dirname, '..', 'public', 'page-logic.js');

  assert(fs.existsSync(custodyHtmlPath), 'public/custody.html exists');
  const custodyHtml = fs.readFileSync(custodyHtmlPath, 'utf8');
  assert(custodyHtml.includes('id="tabBtnHeld"'), 'custody.html contains Held tab');
  assert(custodyHtml.includes('id="tabBtnIncoming"'), 'custody.html contains Incoming tab');
  assert(custodyHtml.includes('id="tabBtnOutgoing"'), 'custody.html contains Outgoing tab');
  assert(custodyHtml.includes('id="tbodyHeld"'), 'custody.html contains tbody for held items');
  assert(custodyHtml.includes('id="tbodyIncoming"'), 'custody.html contains tbody for incoming transfers');
  assert(custodyHtml.includes('id="hubRejectModal"'), 'custody.html contains reject handover modal');

  const detailsHtml = fs.readFileSync(detailsHtmlPath, 'utf8');
  assert(detailsHtml.includes('id="custodyBanner"'), 'evidence-details.html contains custody status banner');
  assert(detailsHtml.includes('id="custodyTimelineCard"'), 'evidence-details.html contains custody timeline card');
  assert(detailsHtml.includes('id="custodyTimeline"'), 'evidence-details.html contains custody timeline container');
  assert(detailsHtml.includes('id="btnValidateCustody"'), 'evidence-details.html contains validate custody button');
  assert(detailsHtml.includes('id="btnDownloadAsset"'), 'evidence-details.html contains download asset button');
  assert(detailsHtml.includes('id="transferModal"'), 'evidence-details.html contains transfer modal');
  assert(detailsHtml.includes('id="logActionModal"'), 'evidence-details.html contains log action modal');
  assert(detailsHtml.includes('id="releaseModal"'), 'evidence-details.html contains release modal');
  assert(detailsHtml.includes('id="returnModal"'), 'evidence-details.html contains return modal');

  const css = fs.readFileSync(cssPath, 'utf8');
  assert(css.includes('.custody-status-banner'), 'style.css contains .custody-status-banner styling');
  assert(css.includes('.custody-timeline'), 'style.css contains .custody-timeline styling');
  assert(css.includes('.custody-badge-incustody'), 'style.css contains .custody-badge-incustody badge');

  const pageLogic = fs.readFileSync(pageLogicPath, 'utf8');
  assert(pageLogic.includes('initCustody'), 'page-logic.js defines initCustody()');
  assert(pageLogic.includes('loadCustody'), 'page-logic.js defines loadCustody()');
  assert(pageLogic.includes("currentPage === 'custody.html'"), 'page-logic.js routes custody.html');

  // --- [2] Server End-to-End API Integration ---
  console.log('\n--- [2] Live API Testing (In-Memory Server) ---');
  let mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  await mongoose.connect(mongoUri);
  await ensureGenesis();

  const app = require('../server');
  const server = app.listen(0);
  const port = server.address().port;
  console.log(`[Target] Connected to in-memory server on port ${port}`);

  // Seed users
  const User = require('../models/User');
  await User.deleteMany({});
  const passHash = await bcrypt.hash('Password123!', 10);
  const inv1 = await User.create({
    name: 'Detective Miller',
    email: 'miller@agency.gov',
    passwordHash: passHash,
    role: 'INVESTIGATOR',
    isActive: true
  });
  const inv2 = await User.create({
    name: 'Detective Connor',
    email: 'connor@agency.gov',
    passwordHash: passHash,
    role: 'INVESTIGATOR',
    isActive: true
  });
  const admin = await User.create({
    name: 'Chief Admin',
    email: 'admin@agency.gov',
    passwordHash: passHash,
    role: 'ADMIN',
    isActive: true
  });
  const viewer = await User.create({
    name: 'External Auditor',
    email: 'auditor@watchdog.org',
    passwordHash: passHash,
    role: 'VIEWER',
    isActive: true
  });

  // Login helper
  async function login(email, password) {
    const res = await request({
      hostname: 'localhost',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email, password });
    return extractCookie(res, 'token');
  }

  const tokenInv1 = await login('miller@agency.gov', 'Password123!');
  const tokenInv2 = await login('connor@agency.gov', 'Password123!');
  const tokenAdmin = await login('admin@agency.gov', 'Password123!');
  const tokenViewer = await login('auditor@watchdog.org', 'Password123!');

  // Test GET /api/custody/officers
  console.log('\n--- [3] GET /api/custody/officers Candidate Listing ---');
  const officersRes = await request({
    hostname: 'localhost',
    port,
    path: '/api/custody/officers',
    method: 'GET',
    headers: { 'Cookie': tokenInv1 }
  });
  assert(officersRes.status === 200, 'GET /api/custody/officers returns HTTP 200 for Investigator');
  assert(Array.isArray(officersRes.body.officers), 'Officers array returned');
  assert(officersRes.body.officers.length >= 3, 'Contains active Admin and Investigators (excluding inactive/viewer)');
  const viewerInList = officersRes.body.officers.find(o => o.role === 'VIEWER');
  assert(!viewerInList, 'VIEWER role excluded from custody candidates');

  const viewerOfficersRes = await request({
    hostname: 'localhost',
    port,
    path: '/api/custody/officers',
    method: 'GET',
    headers: { 'Cookie': tokenViewer }
  });
  assert(viewerOfficersRes.status === 403, 'VIEWER role blocked from /api/custody/officers (HTTP 403)');

  // Test Upload and Chain of Custody Integration
  console.log('\n--- [4] Evidence Upload & Custody Tracking Workflow ---');
  const fileContent = 'Forensic memory dump raw bytes 2026';
  const fd = new FormData();
  const blob = new Blob([Buffer.from(fileContent)], { type: 'text/plain' });
  fd.append('file', blob, 'memory.txt');
  fd.append('caseId', 'EG-2026-0042');
  fd.append('name', 'Suspect RAM Dump');
  fd.append('type', 'Document');
  fd.append('description', 'Volatile memory captured live at scene');

  const uploadFetch = await fetch(`http://localhost:${port}/api/evidence`, {
    method: 'POST',
    headers: {
      Cookie: tokenInv1
    },
    body: fd
  });
  const uploadJson = await uploadFetch.json().catch(() => ({}));
  const uploadRes = { status: uploadFetch.status, body: uploadJson };

  assert(uploadRes.status === 201, 'Evidence uploaded successfully (HTTP 201)', JSON.stringify(uploadRes.body));
  const evidenceId = uploadRes.body.evidence ? uploadRes.body.evidence.evidenceId : null;

  // Check /api/custody/mine for Investigator 1
  const mineInv1 = await request({
    hostname: 'localhost',
    port,
    path: '/api/custody/mine',
    method: 'GET',
    headers: { 'Cookie': tokenInv1 }
  });
  assert(mineInv1.status === 200, 'GET /api/custody/mine returns HTTP 200');
  assert(mineInv1.body.counts.held >= 1, 'Investigator 1 holds newly uploaded evidence in custody');

  // Investigator 1 initiates transfer to Investigator 2
  console.log('\n--- [5] Transfer Handshake & Acceptance Workflow ---');
  const transferRes = await request({
    hostname: 'localhost',
    port,
    path: `/api/evidence/${evidenceId}/custody`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': tokenInv1
    }
  }, {
    type: 'TRANSFER_INITIATED',
    toUserId: inv2._id.toString(),
    reason: 'Transferred to Forensics Lab for RAM artifact carving',
    location: 'Cyber Lab Room 4',
    conditionNotes: 'Tamper seal intact'
  });
  assert(transferRes.status === 201, 'Custody transfer initiated (HTTP 201)');
  const transferCustodyId = transferRes.body.event.custodyId;

  // Investigator 2 checks /mine
  const mineInv2 = await request({
    hostname: 'localhost',
    port,
    path: '/api/custody/mine',
    method: 'GET',
    headers: { 'Cookie': tokenInv2 }
  });
  assert(mineInv2.body.counts.incoming === 1, 'Investigator 2 sees 1 pending incoming transfer');
  assert(mineInv2.body.pendingIncoming[0].transfer.custodyId === transferCustodyId, 'Pending incoming transfer matches custodyId');

  // Investigator 2 accepts transfer
  const acceptRes = await request({
    hostname: 'localhost',
    port,
    path: `/api/custody/${transferCustodyId}/accept`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': tokenInv2
    }
  }, {
    reason: 'Custody transfer accepted and physical custody assumed in Lab 4'
  });
  assert(acceptRes.status === 200, 'Investigator 2 accepts transfer (HTTP 200)');

  // Investigator 2 now holds item
  const mineInv2After = await request({
    hostname: 'localhost',
    port,
    path: '/api/custody/mine',
    method: 'GET',
    headers: { 'Cookie': tokenInv2 }
  });
  assert(mineInv2After.body.counts.held >= 1, 'Investigator 2 now holds the evidence');
  assert(mineInv2After.body.counts.incoming === 0, 'Incoming count returned to 0');

  // Test automatic ACCESSED on download
  console.log('\n--- [6] Automatic ACCESSED on Download & Chain Validation ---');
  const downloadRes = await request({
    hostname: 'localhost',
    port,
    path: `/api/evidence/${evidenceId}/download`,
    method: 'GET',
    headers: { 'Cookie': tokenInv2 }
  });
  assert(downloadRes.status === 200, 'Download endpoint streams file with HTTP 200');
  assert(downloadRes.rawBody === fileContent, 'Streamed content matches original bit-for-bit');

  // Validate custody chain
  const valRes = await request({
    hostname: 'localhost',
    port,
    path: `/api/evidence/${evidenceId}/custody/validate`,
    method: 'POST',
    headers: { 'Cookie': tokenInv2 }
  });
  assert(valRes.status === 200, 'Validate custody chain returns HTTP 200');
  assert(valRes.body.valid === true, 'Custody chain reports cryptographically VALID');
  assert(valRes.body.totalEvents >= 4, 'Includes COLLECTED, TRANSFER_INITIATED, TRANSFER_ACCEPTED, and auto ACCESSED');

  console.log('\n======================================================================');
  console.log(`SPRINT 12B TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  server.close();
  await mongoose.connection.close();
  if (mongod) await mongod.stop();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
