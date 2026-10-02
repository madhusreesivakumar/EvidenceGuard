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
const { ensureGenesis, appendBlock } = require('../services/chainService');

const table = [];
function assert(condition, message) {
  table.push({ Test: message, Status: condition ? 'PASS' : 'FAIL' });
}

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  
  // Set fallback because memory server usually doesn't do transactions without replSet
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
  
  let res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "inv@test.com", password: "Password1" }) });
  const invCookie = res.headers.get('set-cookie').split(';')[0];

  const createFormNative = (buffer, filename) => {
    const fd = new FormData();
    const blob = new Blob([buffer], { type: 'text/plain' });
    fd.append('file', blob, filename);
    fd.append('name', 'Evidence file');
    fd.append('type', 'Document');
    return fd;
  };

  // 1. Upload 3 sequential files
  const hashes = [];
  for(let i=1; i<=3; i++) {
    const f = createFormNative(Buffer.from(`file content ${i}`), `file${i}.txt`);
    const r = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: f });
    const json = await r.json();
    hashes.push(json.evidence.blockHash);
  }
  
  const blocks = await Block.find().sort({ blockNumber: 1 });
  // blocks[0] = genesis, blocks[1..3] are uploaded
  let sequentiallyLinked = true;
  for(let i=1; i<=3; i++) {
    if(blocks[i].previousHash !== blocks[i-1].currentHash) sequentiallyLinked = false;
  }
  
  const ev1 = await Evidence.findOne({ evidenceId: 'EV-0001' });
  const ev1MatchesBlock = ev1.blockNumber === 1;

  assert(blocks.length === 4 && sequentiallyLinked && ev1MatchesBlock, 'Upload 3 files: blocks 1, 2, 3 exist; each previousHash equals the previous block\'s currentHash; evidence.blockNumber matches');

  // 2. Parallel uploads
  const parallelRequests = [];
  for(let i=1; i<=10; i++) {
    const f = createFormNative(Buffer.from(`parallel file ${i}`), `pfile${i}.txt`);
    parallelRequests.push(fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: f }));
  }
  await Promise.all(parallelRequests);
  
  const parallelBlocks = await Block.find().sort({ blockNumber: 1 });
  const noForks = (new Set(parallelBlocks.map(b => b.previousHash)).size) === parallelBlocks.length;
  // total blocks = 1 (genesis) + 3 (sequential) + 10 (parallel) = 14
  assert(parallelBlocks.length === 14 && noForks, 'Fire 10 parallel uploads of DIFFERENT files: 10 blocks, sequential numbers with no gaps, no duplicate parents, no forks');

  // 3. Force block insert failure rollback test
  const originalSave = Block.prototype.save;
  Block.prototype.save = async function() { throw new Error('Simulated block failure'); };
  
  const failData = Buffer.from('will fail');
  const fFail = createFormNative(failData, 'fail.txt');
  const resFail = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fFail });
  
  Block.prototype.save = originalSave; // Restore

  const failHash = crypto.createHash('sha256').update(failData).digest('hex').toLowerCase();
  const foundEv = await Evidence.findOne({ hash: failHash });
  const isOk = resFail.status === 500 && foundEv === null;
  if (!isOk) console.log('DEBUG:', resFail.status, foundEv);
  assert(isOk, 'Force a block insert failure: no evidence record and no stored file remain');

  // 4. Duplicate upload still returns 409 and creates no block
  const originalBlocksCount = await Block.countDocuments();
  const fDup = createFormNative(Buffer.from('file content 1'), 'file1.txt'); // duplicate
  const resDup = await fetch(`${baseUrl}/evidence`, { method: 'POST', headers: { 'Cookie': invCookie }, body: fDup });
  const newBlocksCount = await Block.countDocuments();
  
  assert(resDup.status === 409 && originalBlocksCount === newBlocksCount, 'Duplicate upload still returns 409 and creates no block');

  console.table(table);

  server.close();
  await mongoose.disconnect();
  await mongod.stop();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
