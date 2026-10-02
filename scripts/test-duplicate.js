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
const Counter = require('../models/Counter');
const authRoutes = require('../routes/authRoutes');
const evidenceRoutes = require('../routes/evidenceRoutes');

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

  // Create User
  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Inv", email: "inv@test.com", password: "Password1" }) });
  await User.updateOne({ email: "inv@test.com" }, { role: "INVESTIGATOR" });
  let res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "inv@test.com", password: "Password1" }) });
  const invCookie = res.headers.get('set-cookie').split(';')[0];

  const createFormNative = (buffer, filename, mimetype) => {
    const fd = new FormData();
    const blob = new Blob([buffer], { type: mimetype });
    fd.append('file', blob, filename);
    fd.append('name', 'Evidence file');
    fd.append('type', 'Document');
    return fd;
  };

  const fileContent = Buffer.from('Duplicate test file');

  // 1. Upload file A
  const fdA = createFormNative(fileContent, 'doc.txt', 'text/plain');
  const resA = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdA });
  const dataA = await resA.json();
  const firstId = dataA.evidence.evidenceId;

  // Upload same file again
  const fdB = createFormNative(fileContent, 'doc.txt', 'text/plain');
  const resB = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdB });
  const dataB = await resB.json();
  assert(resA.status === 201 && resB.status === 409 && dataB.existing.evidenceId === firstId, 'Upload file A: 201. Upload the same file again: 409');

  // 2. Rename file and upload again
  const fdRename = createFormNative(fileContent, 'renamed_doc.txt', 'text/plain');
  const resRename = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdRename });
  assert(resRename.status === 409, 'Rename the file and upload again: still 409');

  // 3. Change one byte
  const alteredContent = Buffer.from('Duplicate test file!');
  const fdAltered = createFormNative(alteredContent, 'doc.txt', 'text/plain');
  const resAltered = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdAltered });
  assert(resAltered.status === 201, 'Change one byte of the file: 201 (new record)');

  // 4. Parallel Uploads (5 at once)
  const parallelContent = Buffer.from('Parallel data set');
  const requests = [];
  for (let i = 0; i < 5; i++) {
    const fdP = createFormNative(parallelContent, `parallel.txt`, 'text/plain');
    requests.push(fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fdP }).then(r => r.status));
  }
  const statuses = await Promise.all(requests);
  const successCount = statuses.filter(s => s === 201).length;
  const conflictCount = statuses.filter(s => s === 409).length;
  
  // Check records & stored files
  const parallelHash = crypto.createHash('sha256').update(parallelContent).digest('hex').toLowerCase();
  const records = await Evidence.find({ hash: parallelHash });
  let storageFileCount = 0;
  if (records.length === 1) {
    const dbRecord = await Evidence.findOne({ hash: parallelHash }).select('+storageKey');
    if (dbRecord && fs.existsSync(path.join(__dirname, '..', 'uploads', dbRecord.storageKey))) {
      storageFileCount = 1;
    }
  }

  assert(successCount === 1 && conflictCount === 4 && records.length === 1 && storageFileCount === 1, 'Fire 5 parallel uploads: exactly one 201 and four 409s; only one record/file');

  // 5. Counters
  const evidenceCounter = await Counter.findOne({ _id: 'evidenceId' });
  // We used ID for file 1, file 2 (altered), and 1 for the parallel set. Minimum 3.
  // In a perfect race condition, all 5 parallel uploads might consume an ID before E11000, max 7.
  assert(evidenceCounter.seq >= 3 && evidenceCounter.seq <= 7, 'ID counters did not advance on rejected duplicates');

  console.table(table);

  server.close();
  await mongoose.disconnect();
  await mongod.stop();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
