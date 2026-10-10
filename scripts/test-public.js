process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '5';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const Evidence = require('../models/Evidence');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');
const Counter = require('../models/Counter');

const authRoutes = require('../routes/authRoutes');
const evidenceRoutes = require('../routes/evidenceRoutes');
const publicRoutes = require('../routes/publicRoutes');
const { ensureGenesis } = require('../services/chainService');

let server;
let baseUrl;
let mongod;

async function setup() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.use('/api/auth', authRoutes);
  app.use('/api/evidence', evidenceRoutes);
  app.use('/api/public', publicRoutes);

  await ensureGenesis();

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
}

async function teardown() {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function run() {
  await setup();

  try {
    const results = [];
    const assertTest = (name, condition, details = '') => {
      results.push({ Test: name, Status: condition ? 'PASS' : 'FAIL', Details: details });
      if (!condition) {
        console.error(`FAIL: ${name}`, details);
      }
    };

    const pwdHash = await bcrypt.hash('password123', 10);
    const adminUser = await User.create({
      name: 'Admin User',
      email: 'admin@test.com',
      passwordHash: pwdHash,
      role: 'ADMIN'
    });

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.com', password: 'password123' })
    });
    const adminCookie = loginRes.headers.get('set-cookie');

    // 1. Upload an active evidence item
    const fileContent = 'Active Evidence File Content ' + Date.now();
    const formData = new FormData();
    formData.append('file', new Blob([fileContent], { type: 'text/plain' }), 'secret-evidence.txt');
    formData.append('name', 'Secret Weapon File');
    formData.append('type', 'Document');
    formData.append('description', 'Classified murder investigation weapon analysis');

    const upRes = await fetch(`${baseUrl}/api/evidence`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: formData
    });
    const upJson = await upRes.json();
    const activeEvId = upJson.evidence.evidenceId;
    const activeCaseId = upJson.evidence.caseId;
    const activePublicToken = upJson.evidence.publicToken;

    // 2. Upload and delete a second evidence item
    const formData2 = new FormData();
    formData2.append('file', new Blob(['to be deleted'], { type: 'text/plain' }), 'deleted.txt');
    formData2.append('name', 'Deleted Evidence File');
    formData2.append('type', 'Other');

    const upRes2 = await fetch(`${baseUrl}/api/evidence`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: formData2
    });
    const upJson2 = await upRes2.json();
    const deletedEvId = upJson2.evidence.evidenceId;
    const deletedCaseId = upJson2.evidence.caseId;
    const deletedPublicToken = upJson2.evidence.publicToken;

    // Soft delete second item
    await fetch(`${baseUrl}/api/evidence/${deletedEvId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Test soft delete for public verify test' })
    });

    await fetch(`${baseUrl}/api/evidence/${deletedEvId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Deleting for public test' })
    });

    // ── Test 1: Public endpoint returns EXACTLY whitelisted keys via publicToken ──
    const pubRes = await fetch(`${baseUrl}/api/public/verify/${activePublicToken}`);
    assertTest('Public endpoint status 200 via publicToken without login', pubRes.status === 200);

    const pubQueryRes = await fetch(`${baseUrl}/api/public/verify?t=${encodeURIComponent(activePublicToken)}`);
    assertTest('Public endpoint status 200 via query param ?t= without login', pubQueryRes.status === 200);

    const pubJson = await pubRes.json();
    const expectedKeys = ['caseId', 'evidenceId', 'type', 'hash', 'registeredAt', 'status', 'statusAsOf', 'note', 'isDemo'].sort();
    const actualKeys = Object.keys(pubJson).sort();
    assertTest('Exact whitelisted keys returned', JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), `Got keys: ${actualKeys.join(',')}`);

    // Deep scan for forbidden strings/keys
    const forbiddenFields = ['name', 'email', 'storageKey', 'uploadedBy', 'description', 'fileName', 'Secret Weapon', 'Classified'];
    const jsonString = JSON.stringify(pubJson);
    let foundForbidden = [];
    for (const f of forbiddenFields) {
      if (jsonString.includes(f)) {
        foundForbidden.push(f);
      }
    }
    assertTest('No forbidden keys/content leaked in response', foundForbidden.length === 0, `Found: ${foundForbidden.join(',')}`);
    assertTest('Note text matches required specification', pubJson.note === 'Status shows the result of the most recent verification. It is not a live check of any file.');

    // ── Test 1b: New record without legacyPublic flag cannot be accessed via caseId ──
    const noLegacyRes = await fetch(`${baseUrl}/api/public/verify/${activeCaseId}`);
    assertTest('New record without legacyPublic returns 404 for caseId lookup', noLegacyRes.status === 404);

    // ── Test 1c: Legacy record flagged legacyPublic works via caseId ──
    await Evidence.updateOne({ evidenceId: activeEvId }, { $set: { legacyPublic: true } });
    const legacyRes = await fetch(`${baseUrl}/api/public/verify/${activeCaseId}`);
    assertTest('Legacy record with legacyPublic:true resolves via caseId path', legacyRes.status === 200);
    const legacyQueryRes = await fetch(`${baseUrl}/api/public/verify?caseId=${encodeURIComponent(activeCaseId)}`);
    assertTest('Legacy record with legacyPublic:true resolves via ?caseId= query', legacyQueryRes.status === 200);

    // ── Test 2: Bad format Case ID -> 400 ──
    const badFmtRes = await fetch(`${baseUrl}/api/public/verify/INVALID-ID`);
    assertTest('Bad format returns 400', badFmtRes.status === 400);

    // ── Test 3: Unknown Token / Case ID -> 404 ──
    const unknownRes = await fetch(`${baseUrl}/api/public/verify/EG-9999-9999`);
    assertTest('Unknown Case ID returns 404', unknownRes.status === 404);

    const unknownTokenRes = await fetch(`${baseUrl}/api/public/verify/unknown_random_token_12345`);
    assertTest('Unknown Token returns 404', unknownTokenRes.status === 404);

    // ── Test 4: Deleted Evidence -> 404 ──
    const deletedRes = await fetch(`${baseUrl}/api/public/verify/${deletedPublicToken}`);
    assertTest('Deleted Evidence publicToken returns 404', deletedRes.status === 404);

    // ── Test 5: Cache-Control: no-store on public response ──
    assertTest('Cache-Control: no-store header set', pubRes.headers.get('cache-control') === 'no-store');

    // ── Test 6: QR endpoint requires authentication (401 when logged out) ──
    const loggedOutQr = await fetch(`${baseUrl}/api/evidence/${activeEvId}/qr`);
    assertTest('QR endpoint returns 401 when logged out', loggedOutQr.status === 401);

    // ── Test 7: QR endpoint with authentication returns required fields and token URL ──
    const loggedInQr = await fetch(`${baseUrl}/api/evidence/${activeEvId}/qr`, {
      headers: { Cookie: adminCookie }
    });
    assertTest('QR endpoint returns 200 when authenticated', loggedInQr.status === 200);
    const qrJson = await loggedInQr.json();
    assertTest('QR endpoint returns success: true', qrJson.success === true);
    assertTest('QR endpoint returns pngDataUrl', typeof qrJson.pngDataUrl === 'string' && qrJson.pngDataUrl.startsWith('data:image/png;base64,'));
    assertTest('QR endpoint returns svg', typeof qrJson.svg === 'string' && qrJson.svg.includes('<svg'));
    const expectedUrl = `http://localhost:3000/verify.html?t=${encodeURIComponent(activePublicToken)}`;
    assertTest('QR URL uses /verify.html?t=<token> format', qrJson.url === expectedUrl, `Expected ${expectedUrl}, got ${qrJson.url}`);

    // Regenerating QR moves record to token links (legacyPublic -> false)
    const reloadedEv = await Evidence.findOne({ evidenceId: activeEvId });
    assertTest('Regenerating QR moves record to token link (sets legacyPublic: false)', reloadedEv.legacyPublic === false);

    // ── Test 8: QR audit row created with action QR_GENERATED ──
    const qrAudit = await AuditLog.findOne({ action: 'QR_GENERATED', evidenceId: activeEvId });
    assertTest('Audit row created for QR generation', !!qrAudit && qrAudit.caseId === activeCaseId);

    // ── Test 9: Public rate limiting (60 per 15 min per IP) ──
    let hit429 = false;
    for (let i = 0; i < 65; i++) {
      const r = await fetch(`${baseUrl}/api/public/verify/${activePublicToken}`);
      if (r.status === 429) {
        hit429 = true;
        break;
      }
    }
    assertTest('Public endpoint enforces rate limit (returns 429)', hit429);

    console.table(results);
    const hasFailures = results.some(r => r.Status === 'FAIL');
    if (hasFailures) throw new Error('One or more public verification tests failed');
  } finally {
    await teardown();
  }
}

run().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
