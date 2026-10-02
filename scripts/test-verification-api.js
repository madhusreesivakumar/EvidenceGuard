process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '1';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const Evidence = require('../models/Evidence');
const User = require('../models/User');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');
const Verification = require('../models/Verification');
const authRoutes = require('../routes/authRoutes');
const evidenceRoutes = require('../routes/evidenceRoutes');
const { ensureGenesis } = require('../services/chainService');

const table = [];
function assert(condition, message) {
  table.push({ Test: message, Status: condition ? 'PASS' : 'FAIL' });
  if (!condition) console.error(`FAILED: ${message}`);
}

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  
  global.TRANSACTIONS_SUPPORTED = false;
  await User.syncIndexes();
  await Evidence.syncIndexes();
  await AuditLog.syncIndexes();
  await Block.syncIndexes();
  await Verification.syncIndexes();
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
  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Admin", email: "admin@test.com", password: "Password1" }) });
  await User.updateOne({ email: "admin@test.com" }, { role: "ADMIN" });
  const adminCookie = (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "admin@test.com", password: "Password1" }) })).headers.get('set-cookie').split(';')[0];

  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Viewer", email: "view@test.com", password: "Password1" }) });
  const viewCookie = (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "view@test.com", password: "Password1" }) })).headers.get('set-cookie').split(';')[0];

  const createFormNative = (buffer, filename, clientHash) => {
    const fd = new FormData();
    const blob = new Blob([buffer], { type: 'text/plain' });
    fd.append('file', blob, filename);
    fd.append('name', 'Evidence 1');
    fd.append('type', 'Document');
    if (clientHash) fd.append('clientHash', clientHash);
    return fd;
  };

  const createVerifyForm = (buffer, filename, clientHash) => {
    const fd = new FormData();
    const blob = new Blob([buffer], { type: 'text/plain' });
    fd.append('file', blob, filename);
    if (clientHash) fd.append('clientHash', clientHash);
    return fd;
  };

  // 1. Upload original evidence
  const origContent = 'hello world original';
  const f = createFormNative(origContent, 'test.txt');
  const upRes = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': adminCookie }, body: f });
  const upJson = await upRes.json();
  const evId = upJson.evidence.evidenceId;
  const caseId = upJson.evidence.caseId;
  console.log('evId:', evId, 'caseId:', caseId);

  // Wait 1s for timestamps to be clearly different if needed
  await new Promise(r => setTimeout(r, 100));

  // 2. Verify Original File -> VERIFIED
  const vf1 = createVerifyForm(origContent, 'test.txt');
  const vRes1 = await fetch(`${baseUrl}/evidence/${evId}/verify`, { method: 'POST', headers: { 'Cookie': adminCookie }, body: vf1 });
  const vJson1 = await vRes1.json();
  console.log('vJson1:', vJson1);
  assert(vJson1.result === 'VERIFIED', 'Original file -> VERIFIED');
  
  const evDb1 = await Evidence.findOne({ evidenceId: evId });
  assert(evDb1.status === 'Verified' && evDb1.verifiedAt != null, 'status Verified, verifiedAt set');

  // 3. Verify Tampered File -> TAMPERED
  const tamperedContent = 'hello world original!'; // changed one byte
  const vf2 = createVerifyForm(tamperedContent, 'test.txt');
  const vRes2 = await fetch(`${baseUrl}/evidence/${evId}/verify`, { method: 'POST', headers: { 'Cookie': viewCookie }, body: vf2 });
  const vJson2 = await vRes2.json();
  assert(vJson2.result === 'TAMPERED', 'Tampered file -> TAMPERED (via VIEWER role)');
  
  const evDb2 = await Evidence.findOne({ evidenceId: evId });
  assert(evDb2.status === 'Tampered', 'status Tampered');

  // 4. Verify Original File again -> VERIFIED
  const vf3 = createVerifyForm(origContent, 'test.txt');
  const vRes3 = await fetch(`${baseUrl}/evidence/${evId}/verify`, { method: 'POST', headers: { 'Cookie': adminCookie }, body: vf3 });
  const vJson3 = await vRes3.json();
  assert(vJson3.result === 'VERIFIED', 'Original file again -> VERIFIED');

  const historyRes = await fetch(`${baseUrl}/evidence/${evId}/verifications`, { method: 'GET', headers: { 'Cookie': adminCookie } });
  const history = (await historyRes.json()).data;
  assert(history.length === 3, 'History shows 3 verifications');
  assert(history[0].result === 'VERIFIED' && history[1].result === 'TAMPERED' && history[2].result === 'VERIFIED', 'History shows earlier TAMPERED row');

  // 5. Verify by caseId
  const vf4 = createVerifyForm(origContent, 'test.txt');
  const vRes4 = await fetch(`${baseUrl}/evidence/${caseId}/verify`, { method: 'POST', headers: { 'Cookie': adminCookie }, body: vf4 });
  assert(vRes4.status === 200, 'Verify by caseId works');

  // 6. Bad clientHash -> 422
  const vf5 = createVerifyForm(origContent, 'test.txt', '1111111111111111111111111111111111111111111111111111111111111111');
  const preBadCount = await Verification.countDocuments();
  const vRes5 = await fetch(`${baseUrl}/evidence/${evId}/verify`, { method: 'POST', headers: { 'Cookie': adminCookie }, body: vf5 });
  assert(vRes5.status === 422, 'Bad clientHash -> 422');
  const postBadCount = await Verification.countDocuments();
  assert(preBadCount === postBadCount, 'No verification rows written on 422');

  // 7. Bad identifier / Soft-deleted
  const vRes6 = await fetch(`${baseUrl}/evidence/EV-1/verify`, { method: 'POST', headers: { 'Cookie': adminCookie }, body: createVerifyForm(origContent, 'test.txt') });
  assert(vRes6.status === 400, '"EV-1" -> 400');
  
  await Evidence.updateOne({ evidenceId: evId }, { isDeleted: true });
  const vRes7 = await fetch(`${baseUrl}/evidence/${evId}/verify`, { method: 'POST', headers: { 'Cookie': adminCookie }, body: createVerifyForm(origContent, 'test.txt') });
  assert(vRes7.status === 404, 'Soft-deleted item -> 404');
  await Evidence.updateOne({ evidenceId: evId }, { isDeleted: false });

  // 8. Unauthenticated
  const vRes8 = await fetch(`${baseUrl}/evidence/${evId}/verify`, { method: 'POST', body: createVerifyForm(origContent, 'test.txt') });
  assert(vRes8.status === 401, 'Logged out -> 401');

  // 9. No file remains in uploads/tmp
  let tmpFiles = 0;
  if (fs.existsSync('./uploads/tmp')) {
    tmpFiles = fs.readdirSync('./uploads/tmp').length;
  }
  assert(tmpFiles === 0, 'No file remains in uploads/tmp after any request');
  
  // 10. Audit checks
  const verAudit = await AuditLog.countDocuments({ action: 'VERIFY' });
  const tampAudit = await AuditLog.countDocuments({ action: 'TAMPER_DETECTED' });
  // We ran verify successfully 4 times (1, 2, 3, 4)
  assert(verAudit === 4, 'VERIFY audit row exists for every result');
  // We had 1 actual tamper detection
  assert(tampAudit === 1, 'TAMPER_DETECTED only on mismatch');

  console.table(table);

  server.close();
  await mongoose.disconnect();
  await mongod.stop();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
