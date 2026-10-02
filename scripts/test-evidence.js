process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '1';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Evidence = require('../models/Evidence');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Block = require('../models/Block');
const Counter = require('../models/Counter');
const { ensureGenesis } = require('../services/chainService');
const authRoutes = require('../routes/authRoutes');
const evidenceRoutes = require('../routes/evidenceRoutes');

const table = [];
function assert(condition, message) {
  table.push({ Test: message, Status: condition ? 'PASS' : 'FAIL' });
}

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  global.TRANSACTIONS_SUPPORTED = false;
  await User.syncIndexes();
  await Evidence.syncIndexes();
  await AuditLog.syncIndexes();
  await Block.syncIndexes();
  await ensureGenesis();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/evidence', evidenceRoutes);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  // Create Users
  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Inv", email: "inv@test.com", password: "Password1" }) });
  await User.updateOne({ email: "inv@test.com" }, { role: "INVESTIGATOR" });
  
  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "View", email: "view@test.com", password: "Password1" }) });
  
  let res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "inv@test.com", password: "Password1" }) });
  const invCookie = res.headers.get('set-cookie').split(';')[0];

  res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "view@test.com", password: "Password1" }) });
  const viewCookie = res.headers.get('set-cookie').split(';')[0];

  const createFormNative = (buffer, filename, mimetype, fields = {}) => {
    const fd = new FormData();
    const blob = new Blob([buffer], { type: mimetype });
    fd.append('file', blob, filename);
    for (const key in fields) fd.append(key, fields[key]);
    return fd;
  };

  const fileContent = Buffer.from('Final sprint test data');
  const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex').toLowerCase();

  // 1. Upload ok, hash matches locally computed SHA-256
  const fdSuccess = createFormNative(fileContent, 'img.png', 'image/png', { name: 'My Ev', type: 'Image' });
  const resSuccess = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdSuccess });
  const dataSuccess = await resSuccess.json();
  assert(resSuccess.status === 201 && dataSuccess.evidence.hash === fileHash, 'upload ok, hash matches a locally computed SHA-256');

  // 2. Duplicate 409
  const fdDup = createFormNative(fileContent, 'img.png', 'image/png', { name: 'My Ev', type: 'Image' });
  const resDup = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdDup });
  assert(resDup.status === 409, 'duplicate 409');

  // 3. Renamed duplicate 409
  const fdRename = createFormNative(fileContent, 'renamed.png', 'image/png', { name: 'My Ev', type: 'Image' });
  const resRename = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdRename });
  assert(resRename.status === 409, 'renamed duplicate 409');

  // 4. Changed-byte 201
  const alteredContent = Buffer.from('Final sprint test data!');
  const fdAltered = createFormNative(alteredContent, 'img.png', 'image/png', { name: 'My Ev', type: 'Image' });
  const resAltered = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdAltered });
  assert(resAltered.status === 201, 'changed-byte 201');

  // 5. VIEWER 403
  const fdViewer = createFormNative(fileContent, 'img.png', 'image/png', { name: 'My Ev', type: 'Image' });
  const resViewer = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': viewCookie }, body: fdViewer });
  assert(resViewer.status === 403, 'VIEWER 403');

  // 6. Oversize 413
  const bigContent = Buffer.alloc(2 * 1024 * 1024);
  const fdBig = createFormNative(bigContent, 'big.png', 'image/png', { name: 'My Ev', type: 'Image' });
  const resBig = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdBig });
  assert(resBig.status === 413, 'oversize 413');

  // 7. Bad type 415
  const exeContent = Buffer.from('fake exe');
  const fdExe = createFormNative(exeContent, 'virus.exe', 'application/x-msdownload', { name: 'My Ev', type: 'Image' });
  const resExe = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdExe });
  assert(resExe.status === 415, 'bad type 415');

  // 8. ClientHash mismatch 422
  const fdMismatch = createFormNative(alteredContent, 'img.png', 'image/png', { name: 'My Ev', type: 'Image', clientHash: fileHash }); // Sending hash of original, but file is altered
  const resMismatch = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdMismatch });
  assert(resMismatch.status === 422, 'clientHash mismatch 422');

  // 9. Audit rows
  const logs = await AuditLog.find({ action: { $in: ['HASH_GENERATED', 'UPLOAD'] } });
  const hasHashGen = logs.some(l => l.action === 'HASH_GENERATED');
  const hasUpload = logs.some(l => l.action === 'UPLOAD');
  assert(hasHashGen && hasUpload, 'audit rows for HASH_GENERATED and UPLOAD');

  console.table(table);

  server.close();
  await mongoose.disconnect();
  await mongod.stop();

  if (table.some(t => t.Status === 'FAIL')) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
