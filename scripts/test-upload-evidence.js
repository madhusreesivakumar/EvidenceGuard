const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const Evidence = require('../models/Evidence');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Counter = require('../models/Counter');
const authRoutes = require('../routes/authRoutes');
const evidenceRoutes = require('../routes/evidenceRoutes');
const crypto = require('crypto');

process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '50';

const table = [];
function assert(condition, message) {
  table.push({ Test: message, Status: condition ? 'PASS' : 'FAIL' });
}

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await User.syncIndexes();
  await Evidence.syncIndexes();
  await AuditLog.syncIndexes();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/evidence', evidenceRoutes);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  // Create Users
  const invRes = await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Inv", email: "inv@test.com", password: "Password1" }) });
  await User.updateOne({ email: "inv@test.com" }, { role: "INVESTIGATOR" });
  
  const viewerRes = await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "View", email: "view@test.com", password: "Password1" }) });
  
  // Login to get cookies
  let res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "inv@test.com", password: "Password1" }) });
  const invCookie = res.headers.get('set-cookie').split(';')[0];

  res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "view@test.com", password: "Password1" }) });
  const viewCookie = res.headers.get('set-cookie').split(';')[0];

  // Helper for FormData in Node 18
  const createFormNative = (buffer, filename, mimetype, fields = {}) => {
    const fd = new FormData();
    const blob = new Blob([buffer], { type: mimetype });
    fd.append('file', blob, filename);
    for (const key in fields) fd.append(key, fields[key]);
    return fd;
  };

  const fileContent = Buffer.from('test evidence data');
  const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex').toLowerCase();

  // 1. Upload as INVESTIGATOR
  const fdSuccess = createFormNative(fileContent, 'doc.txt', 'text/plain', { name: 'My Ev', type: 'Document' });
  const resSuccess = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdSuccess });
  const dataSuccess = await resSuccess.json();
  assert(resSuccess.status === 201 && dataSuccess.evidence.hash === fileHash, 'Upload as INVESTIGATOR: 201; record has a 64-char hash equal to sha256sum');
  
  const evidence1 = dataSuccess.evidence;

  // 2. Upload as VIEWER
  const fdViewer = createFormNative(fileContent, 'doc.txt', 'text/plain', { name: 'My Ev', type: 'Document' });
  const resViewer = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': viewCookie }, body: fdViewer });
  const resLoggedOut = await fetch(`${baseUrl}/evidence`, { method: 'POST', body: fdViewer });
  assert(resViewer.status === 403 && resLoggedOut.status === 401, 'Upload as VIEWER: 403. Upload while logged out: 401.');

  // 3. Spoofing IDs
  const fileContent2 = Buffer.from('test evidence data 2');
  const fdSpoof = createFormNative(fileContent2, 'doc2.txt', 'text/plain', { 
    name: 'Spoofed Ev', type: 'Document', 
    caseId: 'SPOOF-01', status: 'Verified', uploadedBy: 'fakeID' 
  });
  const resSpoof = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdSpoof });
  const dataSpoof = await resSpoof.json();
  assert(resSpoof.status === 201 && dataSpoof.evidence.caseId !== 'SPOOF-01' && dataSpoof.evidence.status === 'Pending', 'Sending caseId/status/uploadedBy in the body has no effect.');

  // 4. Tampered Client Hash
  const fileContent3 = Buffer.from('test evidence data 3');
  const fdTamper = createFormNative(fileContent3, 'doc3.txt', 'text/plain', { name: 'Tamper Ev', type: 'Document', clientHash: '0000000000000000000000000000000000000000000000000000000000000000' });
  const resTamper = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdTamper });
  assert(resTamper.status === 422, 'Tampered clientHash returns 422 and stores nothing.');

  // 5. IDs are sequential
  assert(evidence1.evidenceId === 'EV-0001' && evidence1.caseId === `EG-${new Date().getFullYear()}-0001`, 'IDs are sequential: EV-0001 / EG-2026-0001.');

  // 6. MongoDB / Filesystem Storage
  const dbRecord = await Evidence.findOne({ evidenceId: 'EV-0001' }).select('+storageKey');
  let fileExists = false;
  if (dbRecord && dbRecord.storageKey) {
     const filePath = path.join(__dirname, '..', 'uploads', dbRecord.storageKey);
     fileExists = fs.existsSync(filePath);
  }
  assert(dbRecord !== null && fileExists, 'MongoDB shows the record; uploads/ contains the file named by storageKey.');

  console.table(table);

  server.close();
  await mongoose.disconnect();
  await mongod.stop();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
