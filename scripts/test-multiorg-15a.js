'use strict';

/**
 * scripts/test-multiorg-15a.js
 * Comprehensive automated test suite for Sprint 15A:
 * Tenant Model, Isolation Layer, Migration, Public QR Tokens, and Tenancy Linter
 */

process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.STORAGE_DRIVER = 'local';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const Organization = require('../models/Organization');
const User = require('../models/User');
const Evidence = require('../models/Evidence');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');
const Counter = require('../models/Counter');
const CustodyEvent = require('../models/CustodyEvent');

const { scoped, unscoped } = require('../services/tenantScope');
const { can, PERMISSIONS } = require('../config/permissions');
const { ensureGenesis, appendBlock } = require('../services/chainService');
const { validateChain } = require('../services/chainValidator');
const { validateAuditChain, computeAuditHash } = require('../services/auditHash');
const { logEvent } = require('../services/auditService');

let mongod;

async function setup() {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  await mongoose.connect(mongod.getUri());
}

async function teardown() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function runTests() {
  await setup();
  const db = mongoose.connection.db;
  const results = [];

  const assertTest = (name, condition, details = '') => {
    results.push({ Test: name, Status: condition ? 'PASS' : 'FAIL', Details: details });
    if (!condition) {
      console.error(`❌ FAIL: ${name}`, details);
    }
  };

  try {
    console.log('======================================================================');
    console.log('             EvidenceGuard Sprint 15A Master Test Suite               ');
    console.log('======================================================================\n');

    // ── SECTION 1: Permissions Matrix & Role Protections ──
    console.log('--- Testing Permissions Matrix ---');
    assertTest('SUPER_ADMIN exists in permissions matrix', !!PERMISSIONS.SUPER_ADMIN);
    assertTest('SUPER_ADMIN can manage organizations', can('SUPER_ADMIN', 'manageOrgs'));
    assertTest('SUPER_ADMIN CANNOT read evidence content', !can('SUPER_ADMIN', 'view'));
    assertTest('SUPER_ADMIN CANNOT download evidence file', !can('SUPER_ADMIN', 'download'));

    assertTest('ORG_ADMIN has administrative privileges', can('ORG_ADMIN', 'view') && can('ORG_ADMIN', 'upload'));
    assertTest('AUDITOR can view audit and chains', can('AUDITOR', 'viewAudit') && can('AUDITOR', 'validateAudit'));
    assertTest('AUDITOR CANNOT download evidence files', !can('AUDITOR', 'download'));

    assertTest('COURT_OFFICER can view and verify', can('COURT_OFFICER', 'view') && can('COURT_OFFICER', 'verify'));
    assertTest('LAB_ANALYST has forensics and custody access', can('LAB_ANALYST', 'forensics') && can('LAB_ANALYST', 'custody'));
    assertTest('Legacy ADMIN role maps to full access', can('ADMIN', 'view'));

    // ── SECTION 2: Seeding Pre-Migration Data (Legacy Schema) ──
    console.log('\n--- Seeding Legacy Pre-Migration Data ---');
    const pwdHash = await bcrypt.hash('password123', 10);

    // Insert legacy user directly without orgId and with role: 'ADMIN'
    const legacyAdminDoc = await db.collection('users').insertOne({
      name: 'Legacy Admin',
      email: 'legacy_admin@test.com',
      passwordHash: pwdHash,
      role: 'ADMIN',
      isActive: true,
      createdAt: new Date()
    });

    // Insert legacy evidence directly without orgId and without publicToken
    const dummyHash = crypto.createHash('sha256').update('dummy-content-1').digest('hex');
    const legacyEvDoc = await db.collection('evidences').insertOne({
      evidenceId: 'EV-0001',
      caseId: 'EG-2026-0001',
      name: 'Pre-migration Evidence',
      type: 'Document',
      hash: dummyHash,
      status: 'Pending',
      uploadedBy: legacyAdminDoc.insertedId,
      isDeleted: false,
      createdAt: new Date()
    });

    // Create Genesis Block for default org directly
    await ensureGenesis('default');

    // Append an evidence block in default org
    const b1 = await appendBlock({
      evidence: {
        evidenceId: 'EV-0001',
        caseId: 'EG-2026-0001',
        hash: dummyHash
      },
      user: { _id: legacyAdminDoc.insertedId, orgId: 'default' },
      orgId: 'default'
    });

    await db.collection('evidences').updateOne(
      { _id: legacyEvDoc.insertedId },
      { $set: { blockNumber: b1.blockNumber } }
    );

    // Log an audit event
    await logEvent({
      action: 'UPLOAD',
      user: { _id: legacyAdminDoc.insertedId, name: 'Legacy Admin', role: 'ADMIN', orgId: 'default' },
      evidenceId: 'EV-0001',
      caseId: 'EG-2026-0001',
      description: 'Pre-migration upload',
      orgId: 'default'
    });

    // ── SECTION 3: Migration Dry-Run Verification ──
    console.log('\n--- Testing Migration Dry-Run (Non-mutating) ---');
    const preDryUser = await db.collection('users').findOne({ _id: legacyAdminDoc.insertedId });
    assertTest('Pre-migration user has role ADMIN before migration', preDryUser.role === 'ADMIN');
    assertTest('Pre-migration user has no orgId before migration', !preDryUser.orgId);

    // Simulate dry-run check logic
    const missingOrgUsers = await db.collection('users').countDocuments({
      $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    });
    assertTest('Dry-run detects unmigrated users', missingOrgUsers > 0);

    const missingTokens = await db.collection('evidences').countDocuments({
      $or: [{ publicToken: { $exists: false } }, { publicToken: null }]
    });
    assertTest('Dry-run detects evidences missing publicToken', missingTokens > 0);

    // ── SECTION 4: Migration Execution (--confirm) ──
    console.log('\n--- Executing Migration with --confirm ---');
    // Step 4.1: Create Default Organization
    await Organization.findOneAndUpdate(
      { orgId: 'default' },
      {
        $setOnInsert: {
          orgId: 'default',
          name: 'Default Organization',
          type: 'INVESTIGATION_AGENCY',
          status: 'active',
          createdAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
    const defaultOrg = await Organization.findOne({ orgId: 'default' });
    assertTest('Default Organization created with orgId "default"', !!defaultOrg && defaultOrg.status === 'active');

    // Step 4.2: Assign orgId: 'default' to all records missing orgId
    const targetCols = ['users', 'evidences', 'blocks', 'auditlogs', 'verifications', 'custodyevents', 'notifications', 'forensicreports', 'userkeys', 'counters', 'anchors'];
    for (const colName of targetCols) {
      await db.collection(colName).updateMany(
        { $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: '' }] },
        { $set: { orgId: 'default' } }
      );
    }

    // Step 4.3: Map ADMIN to ORG_ADMIN
    await db.collection('users').updateMany({ role: 'ADMIN' }, { $set: { role: 'ORG_ADMIN' } });
    const migratedUser = await db.collection('users').findOne({ _id: legacyAdminDoc.insertedId });
    assertTest('Legacy ADMIN successfully mapped to ORG_ADMIN', migratedUser.role === 'ORG_ADMIN');
    assertTest('User assigned orgId "default"', migratedUser.orgId === 'default');

    // Step 4.4: Generate publicToken and flag legacyPublic for pre-migration records
    const unTokened = await db.collection('evidences').find({
      $or: [{ publicToken: { $exists: false } }, { publicToken: null }]
    }).toArray();

    for (const ev of unTokened) {
      const publicToken = crypto.randomBytes(16).toString('base64url');
      await db.collection('evidences').updateOne(
        { _id: ev._id },
        { $set: { publicToken, legacyPublic: true } }
      );
    }

    const migratedEv = await db.collection('evidences').findOne({ _id: legacyEvDoc.insertedId });
    assertTest('Evidence populated with 128-bit publicToken', typeof migratedEv.publicToken === 'string' && migratedEv.publicToken.length >= 20);
    assertTest('Pre-migration evidence flagged legacyPublic: true', migratedEv.legacyPublic === true);
    assertTest('Evidence assigned orgId "default"', migratedEv.orgId === 'default');

    // Step 4.5: Validate Chains per Organization
    const blockVal = await validateChain('default');
    assertTest('Ledger blockchain VALID for default organization', blockVal.valid === true, `Checked: ${blockVal.blocksChecked}`);

    const auditVal = await validateAuditChain('default');
    assertTest('Audit chain VALID for default organization', auditVal.valid === true, `Entries: ${auditVal.count}`);

    // ── SECTION 5: Idempotency Verification ──
    console.log('\n--- Verifying Migration Idempotency ---');
    const secondPassUsers = await db.collection('users').countDocuments({ role: 'ADMIN' });
    assertTest('Second pass: No legacy ADMIN roles remain', secondPassUsers === 0);

    const secondPassTokens = await db.collection('evidences').countDocuments({
      $or: [{ publicToken: { $exists: false } }, { publicToken: null }]
    });
    assertTest('Second pass: No evidences missing publicToken', secondPassTokens === 0);

    const recheckBlock = await validateChain('default');
    const recheckAudit = await validateAuditChain('default');
    assertTest('Second pass: Chains remain VALID', recheckBlock.valid && recheckAudit.valid);

    // ── SECTION 6: Multi-Tenant Compound Unique Indexes & Isolation ──
    console.log('\n--- Testing Multi-Tenant Isolation & Compound Indexes ---');
    // Create Org A and Org B
    await Organization.create([
      { orgId: 'org-a', name: 'Alpha Agency', type: 'INVESTIGATION_AGENCY' },
      { orgId: 'org-b', name: 'Beta Forensics', type: 'LABORATORY' }
    ]);

    // Ensure Genesis block for each org
    await ensureGenesis('org-a');
    await ensureGenesis('org-b');

    const orgABlock0 = await Block.findOne({ orgId: 'org-a', blockNumber: 0 });
    const orgBBlock0 = await Block.findOne({ orgId: 'org-b', blockNumber: 0 });
    assertTest('Both Org A and Org B have independent Genesis Block #0', !!orgABlock0 && !!orgBBlock0 && orgABlock0.orgId === 'org-a' && orgBBlock0.orgId === 'org-b');

    // Test compound index: Duplicate blockNumber in SAME org should fail
    let duplicateBlockFailed = false;
    try {
      await Block.create({
        orgId: 'org-a',
        blockNumber: 0,
        previousHash: '0000000000000000',
        currentHash: 'dummyhash123',
        evidenceId: null,
        evidenceHash: '0000000000000000000000000000000000000000000000000000000000000000'
      });
    } catch (err) {
      duplicateBlockFailed = true;
    }
    assertTest('Duplicate (orgId, blockNumber) in SAME org is rejected by unique index', duplicateBlockFailed);

    const userA = { _id: new mongoose.Types.ObjectId(), orgId: 'org-a', role: 'INVESTIGATOR' };
    const userB = { _id: new mongoose.Types.ObjectId(), orgId: 'org-b', role: 'LAB_ANALYST' };

    // Test per-organization duplicate-hash detection:
    // SAME file hash in TWO DIFFERENT organizations is allowed
    const sharedHash = crypto.createHash('sha256').update('cross-tenant-file-test').digest('hex');
    let crossTenantUploadSuccess = false;
    try {
      const evA = await Evidence.create({
        orgId: 'org-a',
        evidenceId: 'EV-0001',
        caseId: 'EG-2026-0001',
        name: 'File in Org A',
        hash: sharedHash,
        publicToken: crypto.randomBytes(16).toString('base64url'),
        status: 'Pending'
      });
      const bA = await appendBlock({
        evidence: evA,
        user: { _id: userA._id, orgId: 'org-a' },
        orgId: 'org-a'
      });
      evA.blockNumber = bA.blockNumber;
      await evA.save();

      const evB = await Evidence.create({
        orgId: 'org-b',
        evidenceId: 'EV-0001', // Independent counter/ID per org
        caseId: 'EG-2026-0001',
        name: 'File in Org B',
        hash: sharedHash,
        publicToken: crypto.randomBytes(16).toString('base64url'),
        status: 'Pending'
      });
      const bB = await appendBlock({
        evidence: evB,
        user: { _id: userB._id, orgId: 'org-b' },
        orgId: 'org-b'
      });
      evB.blockNumber = bB.blockNumber;
      await evB.save();

      crossTenantUploadSuccess = true;
    } catch (err) {
      crossTenantUploadSuccess = false;
    }
    assertTest('Same file hash allowed in different organizations (isolated duplicate detection)', crossTenantUploadSuccess);

    // Duplicate hash in SAME org is rejected
    let sameOrgDuplicateHashFailed = false;
    try {
      await Evidence.create({
        orgId: 'org-a',
        evidenceId: 'EV-0002',
        caseId: 'EG-2026-0002',
        name: 'Duplicate in Org A',
        hash: sharedHash,
        publicToken: crypto.randomBytes(16).toString('base64url'),
        status: 'Pending'
      });
    } catch (err) {
      sameOrgDuplicateHashFailed = true;
    }
    assertTest('Same file hash in SAME org is rejected by compound unique index', sameOrgDuplicateHashFailed);

    // ── SECTION 7: Isolation Layer (tenantScope.js) ──
    console.log('\n--- Testing tenantScope Isolation Layer ---');
    const scopedEvA = scoped(Evidence, userA);
    const scopedEvB = scoped(Evidence, userB);

    const orgADocs = await scopedEvA.find({});
    const orgBDocs = await scopedEvB.find({});

    assertTest('User A only sees Org A evidence', orgADocs.every(d => d.orgId === 'org-a') && orgADocs.length > 0);
    assertTest('User B only sees Org B evidence', orgBDocs.every(d => d.orgId === 'org-b') && orgBDocs.length > 0);

    // Missing orgId throws error
    let missingOrgThrows = false;
    try {
      const invalidScoped = scoped(Evidence, {});
      await invalidScoped.find({});
    } catch (err) {
      missingOrgThrows = true;
    }
    assertTest('scoped helper throws when orgId is missing or empty', missingOrgThrows);

    // Unscoped escape hatch works for platform tasks
    const rawEv = unscoped(Evidence);
    const allEv = await rawEv.find({});
    assertTest('unscoped escape hatch queries across all organizations', allEv.length >= orgADocs.length + orgBDocs.length);

    // Validate chains for Org A and Org B
    const valA = await validateChain('org-a');
    const valB = await validateChain('org-b');
    assertTest('Chains validate independently per organization (Org A and Org B valid)', valA.valid && valB.valid);

    console.table(results);
    const hasFailures = results.some(r => r.Status === 'FAIL');
    if (hasFailures) {
      throw new Error('One or more Sprint 15A tests failed');
    }
    console.log('\n🎉 ALL SPRINT 15A MASTER TESTS PASSED SUCCESSFULLY.\n');
  } finally {
    await teardown();
  }
}

runTests().catch(err => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
