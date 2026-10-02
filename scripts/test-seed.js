'use strict';

/**
 * Sprint 8C Acceptance Test Suite
 * Tests demo seeding, safety flags, idempotency, genuine verifications,
 * cryptographic ledger validity, and role authentication.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '50';
process.env.SEED_DEMO_PASSWORD = 'DemoPassword2026!';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const Evidence = require('../models/Evidence');
const Verification = require('../models/Verification');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');

const { validateChain } = require('../services/chainValidator');
const { validateAuditChain } = require('../services/auditHash');

const results = [];
function assert(condition, testName, details = '') {
  if (condition) {
    results.push({ test: testName, status: 'PASS' });
    console.log(`  [PASS] ${testName}`);
  } else {
    results.push({ test: testName, status: 'FAIL', details });
    console.error(`  [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`);
  }
}

function runChild(args, env = {}, silent = false) {
  return new Promise((resolve, reject) => {
    const cp = spawn(process.execPath, args, {
      env: { ...process.env, ...env },
      stdio: silent ? 'pipe' : 'inherit'
    });
    cp.on('error', reject);
    cp.on('exit', (code) => resolve(code));
  });
}

async function runAcceptanceTests() {
  console.log('======================================================================');
  console.log('       EvidenceGuard – Sprint 8C Demo Seeding Test Suite             ');
  console.log('======================================================================\n');

  // --- [1] Safety & Refusal Checks ---
  console.log('--- [1] Safety & Confirmation Guards ---');

  // Test production refusal
  const prodCode = await runChild(['scripts/seed.js'], { NODE_ENV: 'production' }, true);
  assert(prodCode !== 0, 'Seed script refuses when NODE_ENV=production');

  // Test missing --confirm refusal
  const missingConfirmCode = await runChild(['scripts/seed.js'], { NODE_ENV: 'development' }, true);
  assert(missingConfirmCode !== 0, 'Seed script refuses when --confirm is missing');

  // --- [2] Fresh Database Seeding ---
  console.log('\n--- [2] Fresh Database Seeding & Verification ---');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;

  // Run seed script via child process pointing to the memory DB
  const seedCode = await runChild(['scripts/seed.js', '--confirm', '--uri', uri], {
    MONGODB_URI: uri,
    SEED_DEMO_PASSWORD: 'DemoPassword2026!'
  }, false);
  assert(seedCode === 0, 'Seed execution completed with status 0');

  await mongoose.connect(uri);

  // Users check
  const adminUser = await User.findOne({ email: 'demo.admin@evidenceguard.local' }).select('+passwordHash');
  const invUser = await User.findOne({ email: 'demo.investigator@evidenceguard.local' });
  const viewUser = await User.findOne({ email: 'demo.viewer@evidenceguard.local' });

  assert(adminUser !== null && adminUser.role === 'ADMIN', 'Demo Admin user created with ADMIN role');
  assert(invUser !== null && invUser.role === 'INVESTIGATOR', 'Demo Investigator user created with INVESTIGATOR role');
  assert(viewUser !== null && viewUser.role === 'VIEWER', 'Demo Viewer user created with VIEWER role');

  // Password check: must be bcrypt hashed, not plaintext
  assert(adminUser && adminUser.passwordHash.startsWith('$2'), 'Demo Admin password is encrypted with bcrypt');
  const adminPassMatch = await bcrypt.compare('DemoPassword2026!', adminUser.passwordHash);
  assert(adminPassMatch, 'Demo Admin password verifies with bcrypt');

  // Evidence records check
  const evidenceList = await Evidence.find().sort({ evidenceId: 1 });
  assert(evidenceList.length === 5, `Expected 5 demo evidence records, found ${evidenceList.length}`);

  const allDemo = evidenceList.every(e => e.isDemo === true);
  assert(allDemo, 'All 5 seeded evidence records have isDemo: true');

  const allDescriptionsDemo = evidenceList.every(e => e.description && e.description.startsWith('[DEMO]'));
  assert(allDescriptionsDemo, 'All 5 seeded descriptions start with "[DEMO]"');

  // Verify target statuses
  const r1 = evidenceList.find(e => e.name === 'CCTV Footage');
  const r2 = evidenceList.find(e => e.name === 'Crime Scene Image');
  const r3 = evidenceList.find(e => e.name === 'Case Document');
  const r4 = evidenceList.find(e => e.name === 'Audio Recording');
  const r5 = evidenceList.find(e => e.name === 'Witness Statement');

  assert(r1 && r1.type === 'Video' && r1.status === 'Verified', 'EV-0001 (CCTV Footage) target status is Verified');
  assert(r2 && r2.type === 'Image' && r2.status === 'Verified', 'EV-0002 (Crime Scene Image) target status is Verified');
  assert(r3 && r3.type === 'Document' && r3.status === 'Pending', 'EV-0003 (Case Document) target status is Pending');
  assert(r4 && r4.type === 'Audio' && r4.status === 'Tampered', 'EV-0004 (Audio Recording) target status is Tampered');
  assert(r5 && r5.type === 'Document' && r5.status === 'Verified', 'EV-0005 (Witness Statement) target status is Verified');

  // --- [3] Verification History & Audit Rows ---
  console.log('\n--- [3] Verification History & Audit Records ---');
  const verifications = await Verification.find();
  assert(verifications.length === 4, `Expected 4 verification records (3 verified + 1 tampered), found ${verifications.length}`);

  const allVerDemo = verifications.every(v => v.isDemo === true);
  assert(allVerDemo, 'All verification records have isDemo: true');

  const tamperedVer = await Verification.findOne({ evidenceId: r4.evidenceId });
  assert(tamperedVer && tamperedVer.result === 'TAMPERED', 'EV-0004 history table has TAMPERED verification row');

  const tamperAudit = await AuditLog.findOne({ action: 'TAMPER_DETECTED', evidenceId: r4.evidenceId });
  assert(tamperAudit !== null, 'Audit trail contains TAMPER_DETECTED event for EV-0004');

  // --- [4] Cryptographic Chain Integrity ---
  console.log('\n--- [4] Cryptographic Ledger & Audit Chain Integrity ---');
  const chainResult = await validateChain();
  assert(chainResult.valid === true, `Blockchain ledger validation is VALID (${chainResult.blocksChecked} blocks checked)`);

  const auditResult = await validateAuditChain();
  assert(auditResult.valid === true, `Audit hash-chain validation is VALID (${auditResult.entriesChecked} entries checked)`);

  // --- [5] Idempotency Check (Running Seed Twice) ---
  console.log('\n--- [5] Idempotency Verification ---');
  const secondSeedCode = await runChild(['scripts/seed.js', '--confirm', '--uri', uri], {
    MONGODB_URI: uri,
    SEED_DEMO_PASSWORD: 'DemoPassword2026!'
  }, false);
  assert(secondSeedCode === 0, 'Second seed execution completed with status 0');

  const countAfterSecond = await Evidence.countDocuments();
  assert(countAfterSecond === 5, `Idempotent: Evidence count remains 5 (no duplicates created)`);

  const blockCountAfterSecond = await Block.countDocuments();
  assert(blockCountAfterSecond === 6, `Idempotent: Block count remains 6 (Genesis + 5 blocks, no duplicates)`);

  const chainAfterSecond = await validateChain();
  assert(chainAfterSecond.valid === true, 'Blockchain ledger remains VALID after re-running seed');

  // --- Summary ---
  console.log('\n======================================================================');
  console.log('                   SPRINT 8C TEST REPORT                              ');
  console.log('======================================================================');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`TOTAL TESTS : ${results.length}`);
  console.log(`PASSED      : ${passed}`);
  console.log(`FAILED      : ${failed}`);
  console.log('======================================================================\n');

  await mongoose.disconnect();
  await mongod.stop();

  if (failed > 0) process.exit(1);
}

runAcceptanceTests().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
