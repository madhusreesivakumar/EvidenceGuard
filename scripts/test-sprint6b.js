process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '5';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const User = require('../models/User');
const Evidence = require('../models/Evidence');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');
const Counter = require('../models/Counter');
const Verification = require('../models/Verification');

const authRoutes = require('../routes/authRoutes');
const evidenceRoutes = require('../routes/evidenceRoutes');
const blockchainRoutes = require('../routes/blockchainRoutes');
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
  app.use('/api/blockchain', blockchainRoutes);

  await ensureGenesis();

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`Test server running at ${baseUrl}`);
}

async function teardown() {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function run() {
  await setup();

  try {
    console.log('--- Setting up Users ---');
    // Create admin, investigator, viewer
    const bcrypt = require('bcrypt');
    const pwdHash = await bcrypt.hash('password123', 10);

    const adminUser = await User.create({
      name: 'Admin User',
      email: 'admin@test.com',
      passwordHash: pwdHash,
      role: 'ADMIN'
    });

    const investigatorUser = await User.create({
      name: 'Investigator User',
      email: 'investigator@test.com',
      passwordHash: pwdHash,
      role: 'INVESTIGATOR'
    });

    const viewerUser = await User.create({
      name: 'Viewer User',
      email: 'viewer@test.com',
      passwordHash: pwdHash,
      role: 'VIEWER'
    });

    // Login helper
    const login = async (email) => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123' })
      });
      const cookie = res.headers.get('set-cookie');
      return cookie;
    };

    const adminCookie = await login('admin@test.com');
    const investigatorCookie = await login('investigator@test.com');
    const viewerCookie = await login('viewer@test.com');

    console.log('--- Upload Evidence as ADMIN ---');
    const fileContent = 'Forensic test file content for sprint 6B delete testing ' + Date.now();
    const tempFile = path.join(__dirname, 'temp-sprint6b.txt');
    fs.writeFileSync(tempFile, fileContent);

    const formData = new FormData();
    formData.append('file', new Blob([fileContent], { type: 'text/plain' }), 'test-evidence.txt');
    formData.append('name', 'Evidence To Delete');
    formData.append('type', 'Document');
    formData.append('description', 'Test evidence for soft delete');

    const uploadRes = await fetch(`${baseUrl}/api/evidence`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: formData
    });
    const uploadJson = await uploadRes.json();
    if (!uploadJson.success) throw new Error('Upload failed: ' + JSON.stringify(uploadJson));
    const ev = uploadJson.evidence;
    const evId = ev.evidenceId;
    const cId = ev.caseId;
    console.log(`Uploaded evidence: ${evId}, case: ${cId}, block: ${ev.blockNumber}`);

    // Verify stored file exists in uploads/
    const dbDoc = await Evidence.findOne({ evidenceId: evId }).select('+storageKey');
    const storageFilePath = path.join(__dirname, '..', 'uploads', dbDoc.storageKey);
    console.log('Stored file exists:', fs.existsSync(storageFilePath));
    if (!fs.existsSync(storageFilePath)) throw new Error('Storage file was not saved');

    // 1. Initial validation
    const valRes1 = await fetch(`${baseUrl}/api/blockchain/validate`, {
      method: 'POST',
      headers: { Cookie: adminCookie }
    });
    const valJson1 = await valRes1.json();
    console.log('Pre-delete blockchain validation valid:', valJson1.valid);
    if (!valJson1.valid) throw new Error('Blockchain should be valid pre-delete');

    // 2. Delete as VIEWER -> 403
    console.log('--- Testing DELETE as VIEWER ---');
    const delViewer = await fetch(`${baseUrl}/api/evidence/${evId}`, {
      method: 'DELETE',
      headers: { Cookie: viewerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Viewer trying to delete' })
    });
    console.log('Viewer DELETE status (expect 403):', delViewer.status);
    if (delViewer.status !== 403) throw new Error('Viewer should get 403');

    // 3. Delete as INVESTIGATOR -> 403
    console.log('--- Testing DELETE as INVESTIGATOR ---');
    const delInvestigator = await fetch(`${baseUrl}/api/evidence/${evId}`, {
      method: 'DELETE',
      headers: { Cookie: investigatorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Investigator trying to delete' })
    });
    console.log('Investigator DELETE status (expect 403):', delInvestigator.status);
    if (delInvestigator.status !== 403) throw new Error('Investigator should get 403');

    // 4. Delete as ADMIN with reason too short -> 400
    console.log('--- Testing DELETE with invalid reason ---');
    const delBadReason = await fetch(`${baseUrl}/api/evidence/${evId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'No' })
    });
    console.log('Bad reason DELETE status (expect 400):', delBadReason.status);
    if (delBadReason.status !== 400) throw new Error('Short reason should get 400');

    // 5. Delete as ADMIN with valid reason -> 200
    console.log('--- Testing DELETE as ADMIN ---');
    const deleteReason = 'Formal administrative court order deletion request';
    const delAdmin = await fetch(`${baseUrl}/api/evidence/${evId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: deleteReason })
    });
    const delAdminJson = await delAdmin.json();
    console.log('Admin DELETE status (expect 200):', delAdmin.status, delAdminJson);
    if (delAdmin.status !== 200 || !delAdminJson.success) throw new Error('Admin delete failed');

    // Check stored file is removed
    const fileStillExists = fs.existsSync(storageFilePath);
    console.log('Stored file removed (expect false):', fileStillExists);
    if (fileStillExists) throw new Error('Stored file should have been removed from disk');

    // Check DB record
    const deletedDbDoc = await Evidence.findOne({ evidenceId: evId });
    if (!deletedDbDoc.isDeleted || deletedDbDoc.deletedReason !== deleteReason || !deletedDbDoc.deletedBy) {
      throw new Error('Soft delete fields not properly set in DB');
    }

    // 6. Double delete -> 404
    console.log('--- Testing Double DELETE ---');
    const doubleDel = await fetch(`${baseUrl}/api/evidence/${evId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Deleting second time' })
    });
    console.log('Double delete status (expect 404):', doubleDel.status);
    if (doubleDel.status !== 404) throw new Error('Double delete should return 404');

    // Check audit log for DELETE
    const auditLogs = await AuditLog.find({ action: 'DELETE', evidenceId: evId });
    console.log('Audit DELETE logs count (expect 1):', auditLogs.length);
    if (auditLogs.length !== 1) throw new Error('Expected exactly 1 DELETE audit log');
    console.log('Audit description:', auditLogs[0].description);
    if (!auditLogs[0].description.includes(deleteReason)) throw new Error('Audit log missing reason');

    // 7. Check deleted evidence disappears from list, details, lookup, verify
    console.log('--- Checking disappearances (all 404 / filtered) ---');
    // List
    const listRes = await fetch(`${baseUrl}/api/evidence`, { headers: { Cookie: adminCookie } });
    const listJson = await listRes.json();
    const inList = listJson.items.some(i => i.evidenceId === evId);
    console.log('In GET /api/evidence list (expect false):', inList);
    if (inList) throw new Error('Deleted evidence should not be in list');

    // Details
    const detailsRes = await fetch(`${baseUrl}/api/evidence/${evId}`, { headers: { Cookie: adminCookie } });
    console.log('GET /api/evidence/:id (expect 404):', detailsRes.status);
    if (detailsRes.status !== 404) throw new Error('Deleted evidence details should return 404');

    // Lookup
    const lookupRes = await fetch(`${baseUrl}/api/evidence/lookup?evidenceId=${evId}`, { headers: { Cookie: adminCookie } });
    console.log('GET /api/evidence/lookup (expect 404):', lookupRes.status);
    if (lookupRes.status !== 404) throw new Error('Deleted evidence lookup should return 404');

    // Verify
    const verifyForm = new FormData();
    verifyForm.append('file', new Blob([fileContent], { type: 'text/plain' }), 'test-evidence.txt');
    const verifyRes = await fetch(`${baseUrl}/api/evidence/${evId}/verify`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: verifyForm
    });
    console.log('POST /api/evidence/:id/verify (expect 404):', verifyRes.status);
    if (verifyRes.status !== 404) throw new Error('Deleted evidence verify should return 404');

    // 8. Blockchain block stays and is labelled evidenceDeleted: true
    console.log('--- Checking Blockchain GET /api/blockchain ---');
    const bcRes = await fetch(`${baseUrl}/api/blockchain?page=1&limit=20`, { headers: { Cookie: adminCookie } });
    const bcJson = await bcRes.json();
    const blockForDeleted = bcJson.data.find(b => b.evidenceId === evId);
    console.log('Block found for deleted evidence:', !!blockForDeleted);
    if (!blockForDeleted) throw new Error('Ledger block must remain for deleted evidence');
    console.log('Block has evidenceDeleted: true:', blockForDeleted.evidenceDeleted);
    if (blockForDeleted.evidenceDeleted !== true) throw new Error('Block must have evidenceDeleted: true');

    // 9. Post /api/blockchain/validate is still VALID
    console.log('--- Checking Blockchain Validate ---');
    const valRes2 = await fetch(`${baseUrl}/api/blockchain/validate`, {
      method: 'POST',
      headers: { Cookie: adminCookie }
    });
    const valJson2 = await valRes2.json();
    console.log('Post-delete blockchain validation valid:', valJson2.valid);
    if (!valJson2.valid) {
      console.error('Validation issues:', valJson2.issues);
      throw new Error('Blockchain validation must remain valid after soft delete');
    }

    // 10. Re-uploading the exact same file after deletion works and gets a NEW Evidence ID
    console.log('--- Testing Re-upload of same file after deletion ---');
    const reuploadForm = new FormData();
    reuploadForm.append('file', new Blob([fileContent], { type: 'text/plain' }), 'test-evidence-reupload.txt');
    reuploadForm.append('name', 'Re-uploaded Evidence');
    reuploadForm.append('type', 'Document');
    reuploadForm.append('description', 'Testing re-upload of deleted file');

    const reuploadRes = await fetch(`${baseUrl}/api/evidence`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: reuploadForm
    });
    const reuploadJson = await reuploadRes.json();
    console.log('Re-upload status:', reuploadRes.status, reuploadJson.success);
    if (reuploadRes.status !== 201 || !reuploadJson.success) {
      throw new Error('Re-uploading deleted file failed: ' + JSON.stringify(reuploadJson));
    }
    const newEvId = reuploadJson.evidence.evidenceId;
    console.log(`Old EvId: ${evId}, New EvId: ${newEvId}`);
    if (newEvId === evId) throw new Error('Re-uploaded file should get a NEW evidence ID');

    // 11. XSS Check: Name <img src=x onerror=alert(1)>
    console.log('--- Testing XSS in Evidence Name ---');
    const xssForm = new FormData();
    xssForm.append('file', new Blob(['xss test file content'], { type: 'text/plain' }), 'xss.txt');
    xssForm.append('name', '<img src=x onerror=alert(1)>');
    xssForm.append('type', 'Other');

    const xssRes = await fetch(`${baseUrl}/api/evidence`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: xssForm
    });
    const xssJson = await xssRes.json();
    console.log('XSS evidence upload status:', xssRes.status, xssJson.evidence?.evidenceId);
    if (!xssJson.success) throw new Error('XSS upload failed');

    // Cleanup temp file
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    console.log('=== ALL SPRINT 6B ACCEPTANCE CHECKS PASSED ===');
  } finally {
    await teardown();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
