if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production.');
  process.exit(1);
}
const args = process.argv.slice(2);
if (!args.includes('--confirm')) {
  console.error('Requires explicit flag --confirm');
  process.exit(1);
}

process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '1';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const Evidence = require('../models/Evidence');
const User = require('../models/User');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');
const Counter = require('../models/Counter');
const authRoutes = require('../routes/authRoutes');
const evidenceRoutes = require('../routes/evidenceRoutes');
const blockchainRoutes = require('../routes/blockchainRoutes');
const { ensureGenesis } = require('../services/chainService');

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
  app.use('/api/blockchain', blockchainRoutes);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  // Create Users
  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Admin", email: "admin@test.com", password: "Password1" }) });
  await User.updateOne({ email: "admin@test.com" }, { role: "ADMIN" });
  let res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "admin@test.com", password: "Password1" }) });
  const adminCookie = res.headers.get('set-cookie').split(';')[0];

  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Inv", email: "inv@test.com", password: "Password1" }) });
  await User.updateOne({ email: "inv@test.com" }, { role: "INVESTIGATOR" });
  res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "inv@test.com", password: "Password1" }) });
  const invCookie = res.headers.get('set-cookie').split(';')[0];

  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Viewer", email: "view@test.com", password: "Password1" }) });
  res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "view@test.com", password: "Password1" }) });
  const viewCookie = res.headers.get('set-cookie').split(';')[0];

  const createFormNative = (buffer, filename) => {
    const fd = new FormData();
    const blob = new Blob([buffer], { type: 'text/plain' });
    fd.append('file', blob, filename);
    fd.append('name', 'Evidence');
    fd.append('type', 'Document');
    return fd;
  };

  // Upload some evidence
  for(let i=1; i<=3; i++) {
    const f = createFormNative(Buffer.from(`file content ${i}`), `file${i}.txt`);
    await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: f });
  }

  // 1. Role Checks
  const resAdminVal = await fetch(`${baseUrl}/blockchain/validate`, { method: 'POST', headers: { 'Cookie': adminCookie } });
  const resInvVal = await fetch(`${baseUrl}/blockchain/validate`, { method: 'POST', headers: { 'Cookie': invCookie } });
  const resViewVal = await fetch(`${baseUrl}/blockchain/validate`, { method: 'POST', headers: { 'Cookie': viewCookie } });
  const resViewGet = await fetch(`${baseUrl}/blockchain`, { method: 'GET', headers: { 'Cookie': viewCookie } });
  const resInvGet = await fetch(`${baseUrl}/blockchain`, { method: 'GET', headers: { 'Cookie': invCookie } });
  
  assert(resAdminVal.status === 200 && resInvVal.status === 403 && resViewVal.status === 403 && resViewGet.status === 403 && resInvGet.status === 200, 
    'Role checks: VIEWER 403 GET/POST, INV 200 GET / 403 POST, ADMIN 200 POST');

  // 2. Healthy Chain
  const healthyJson = await resAdminVal.json();
  assert(healthyJson.valid === true, 'Healthy chain: VALID');

  const collection = mongoose.connection.db.collection('blocks');
  const targetBlock = await collection.findOne({ blockNumber: 1 });

  const modes = [
    { name: 'change-block-hash', update: { currentHash: 'fff' } },
    { name: 'change-previous-hash', update: { previousHash: 'fff' } },
    { name: 'change-evidence-hash', update: { evidenceHash: 'fff' } },
    { name: 'delete-block', delete: true }
  ];

  for (const mode of modes) {
    if (mode.delete) {
      await collection.deleteOne({ blockNumber: 1 });
    } else {
      await collection.updateOne({ blockNumber: 1 }, { $set: mode.update });
    }

    const r = await fetch(`${baseUrl}/blockchain/validate`, { method: 'POST', headers: { 'Cookie': adminCookie } });
    const j = await r.json();
    assert(j.valid === false && (j.firstBrokenBlock === 1 || j.firstBrokenBlock === 2), `Tamper mode ${mode.name}: INVALID with correct broken block (${j.firstBrokenBlock})`);

    // Restore
    if (mode.delete) {
      await collection.insertOne(targetBlock);
    } else {
      await collection.updateOne({ blockNumber: 1 }, { $set: targetBlock });
    }

    const r2 = await fetch(`${baseUrl}/blockchain/validate`, { method: 'POST', headers: { 'Cookie': adminCookie } });
    const j2 = await r2.json();
    assert(j2.valid === true, `After restore ${mode.name}: VALID again`);
  }

  // 3. Performance (1000 blocks)
  console.log("Seeding 1000 blocks for performance test...");
  const blocks = [];
  let prevHash = targetBlock.currentHash; // from block 3 actually wait target block is block 1.
  
  const headBlock = await Block.findOne().sort({ blockNumber: -1 });
  prevHash = headBlock.currentHash;
  let bn = headBlock.blockNumber + 1;

  for(let i = 0; i < 1000; i++) {
    const bData = {
      blockNumber: bn++,
      evidenceId: `EV-PERF-${i}`,
      caseId: `CS-PERF-${i}`,
      evidenceHash: `hash-${i}`,
      previousHash: prevHash,
      timestamp: new Date(),
    };
    const cHash = require('../services/chainHash').computeBlockHash(bData);
    blocks.push({ ...bData, currentHash: cHash });
    prevHash = cHash;
  }
  await collection.insertMany(blocks);
  
  const start = Date.now();
  const perfRes = await fetch(`${baseUrl}/blockchain/validate`, { method: 'POST', headers: { 'Cookie': adminCookie } });
  const perfJson = await perfRes.json();
  const end = Date.now();
  
  assert(perfJson.valid === true, '1000 blocks validates in ' + (end - start) + 'ms');

  // Audit test
  const audit = await AuditLog.findOne({ action: 'BLOCKCHAIN_VALIDATED' });
  assert(audit !== null, 'Audit shows BLOCKCHAIN_VALIDATED entries');

  console.table(table);

  server.close();
  await mongoose.disconnect();
  await mongod.stop();

  const anyFailed = table.some(t => t.Status === 'FAIL');
  if (anyFailed) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
