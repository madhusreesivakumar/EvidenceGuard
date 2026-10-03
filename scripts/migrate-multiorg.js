'use strict';

/**
 * scripts/migrate-multiorg.js
 * Sprint 15A: Multi-Organization Migration Script
 *
 * Requirements:
 * - Dry-run by default, --confirm to run
 * - Idempotent
 * - Takes a backup (mongodump or full JSON collection dump) before migrating
 * - Creates "Default Organization"
 * - Assigns orgId: 'default' to all existing data
 * - Maps ADMIN to ORG_ADMIN
 * - Replaces old unique indexes with compound ones
 * - Generates publicTokens (128-bit random, base64url, unique) & flags legacy records legacyPublic: true
 * - Validates both chains per organization (must be VALID)
 * - Prints counts
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const connectDB = require('../config/db');
const Organization = require('../models/Organization');
const User = require('../models/User');
const Evidence = require('../models/Evidence');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');
const Verification = require('../models/Verification');
const CustodyEvent = require('../models/CustodyEvent');
const Notification = require('../models/Notification');
const ForensicReport = require('../models/ForensicReport');
const UserKey = require('../models/UserKey');
const Counter = require('../models/Counter');
const Anchor = require('../models/Anchor');

const { validateChain } = require('../services/chainValidator');
const { validateAuditChain } = require('../services/auditHash');
const { ensureGenesis } = require('../services/chainService');

const isConfirm = process.argv.includes('--confirm');

/**
 * Perform backup before making any modifications
 */
async function performBackup(db) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups', `pre-migration-dump-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log(`[Backup] Initiating pre-migration backup...`);
  let dumpedViaTool = false;

  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri && !mongoUri.startsWith('mongodb+srv')) {
    try {
      execSync(`mongodump --uri="${mongoUri}" --out="${backupDir}"`, { stdio: 'pipe' });
      dumpedViaTool = true;
      console.log(`[Backup] Successfully exported database via mongodump -> ${backupDir}`);
    } catch (_) {
      // mongodump not installed or failed, fall back to native dump
    }
  }

  if (!dumpedViaTool) {
    const collections = await db.listCollections().toArray();
    for (const colInfo of collections) {
      const colName = colInfo.name;
      if (colName.startsWith('system.')) continue;
      const docs = await db.collection(colName).find({}).toArray();
      const filePath = path.join(backupDir, `${colName}.json`);
      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf8');
    }
    console.log(`[Backup] Successfully exported native JSON snapshot of ${collections.length} collections -> ${backupDir}`);
  }

  return backupDir;
}

/**
 * Drop old single-field index if present
 */
async function dropIndexIfPresent(collection, indexName, keyPattern) {
  try {
    const indexes = await collection.indexes();
    const match = indexes.find(idx => {
      if (idx.name === '_id_') return false;
      if (idx.name === indexName) return true;
      if (keyPattern && JSON.stringify(idx.key) === JSON.stringify(keyPattern)) return true;
      return false;
    });

    if (match) {
      await collection.dropIndex(match.name);
      return match.name;
    }
  } catch (err) {
    // Ignore if doesn't exist
  }
  return null;
}

async function run() {
  console.log('======================================================================');
  console.log('     EvidenceGuard Sprint 15A – Multi-Org Data Migration              ');
  console.log(`     Execution Mode: ${isConfirm ? 'LIVE APPLY (--confirm)' : 'DRY RUN (Preview Only)'}`);
  console.log('======================================================================\n');

  let mongod = null;
  if (!process.env.MONGODB_URI) {
    console.log('[Notice] No MONGODB_URI configured. Starting temporary in-memory database...');
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
  }

  await connectDB();
  const db = mongoose.connection.db;

  const targetCollections = [
    { name: 'users', model: User },
    { name: 'evidences', model: Evidence },
    { name: 'blocks', model: Block },
    { name: 'auditlogs', model: AuditLog },
    { name: 'verifications', model: Verification },
    { name: 'custodyevents', model: CustodyEvent },
    { name: 'notifications', model: Notification },
    { name: 'forensicreports', model: ForensicReport },
    { name: 'userkeys', model: UserKey },
    { name: 'counters', model: Counter },
    { name: 'anchors', model: Anchor }
  ];

  // ── Step 0: Backup (Only on --confirm) ──
  if (isConfirm) {
    await performBackup(db);
  } else {
    console.log('[Backup] DRY RUN: Pre-migration backup will be generated automatically when run with --confirm.');
  }

  // ── Step 1: Default Organization ──
  const existingDefaultOrg = await Organization.findOne({ orgId: 'default' });
  if (!existingDefaultOrg) {
    if (isConfirm) {
      await Organization.create({
        orgId: 'default',
        name: 'Default Organization',
        type: 'INVESTIGATION_AGENCY',
        status: 'active',
        createdAt: new Date()
      });
      console.log('✅ Created Default Organization (orgId: "default")');
    } else {
      console.log('[Preview] Would create Default Organization (orgId: "default")');
    }
  } else {
    console.log('ℹ️  Default Organization already exists.');
  }

  // ── Step 2: Assign orgId: 'default' to all tenant data ──
  console.log('\n--- Scanning Tenant Data for orgId assignment ---');
  for (const { name } of targetCollections) {
    const col = db.collection(name);
    const countMissing = await col.countDocuments({
      $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    });

    if (countMissing > 0) {
      if (isConfirm) {
        const updateRes = await col.updateMany(
          { $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: '' }] },
          { $set: { orgId: 'default' } }
        );
        console.log(`✅ [${name}] Assigned orgId: 'default' to ${updateRes.modifiedCount} records.`);
      } else {
        console.log(`[Preview] [${name}] Would assign orgId: 'default' to ${countMissing} records.`);
      }
    } else {
      console.log(`ℹ️  [${name}] All records already have orgId.`);
    }
  }

  // ── Step 3: Map ADMIN to ORG_ADMIN ──
  console.log('\n--- Mapping User Roles (ADMIN -> ORG_ADMIN) ---');
  const legacyAdminCount = await db.collection('users').countDocuments({ role: 'ADMIN' });
  if (legacyAdminCount > 0) {
    if (isConfirm) {
      const roleRes = await db.collection('users').updateMany(
        { role: 'ADMIN' },
        { $set: { role: 'ORG_ADMIN' } }
      );
      console.log(`✅ Converted ${roleRes.modifiedCount} users from ADMIN to ORG_ADMIN.`);
    } else {
      console.log(`[Preview] Would convert ${legacyAdminCount} users from ADMIN to ORG_ADMIN.`);
    }
  } else {
    console.log('ℹ️  No legacy ADMIN users found to map.');
  }

  // ── Step 4: Generate publicToken & flag legacyPublic for Evidence ──
  console.log('\n--- Checking Evidence Public Tokens & Legacy Public Flags ---');
  const evidencesMissingToken = await db.collection('evidences').find({
    $or: [{ publicToken: { $exists: false } }, { publicToken: null }]
  }).toArray();

  if (evidencesMissingToken.length > 0) {
    if (isConfirm) {
      let tokenCount = 0;
      for (const ev of evidencesMissingToken) {
        const publicToken = crypto.randomBytes(16).toString('base64url');
        await db.collection('evidences').updateOne(
          { _id: ev._id },
          {
            $set: {
              publicToken,
              legacyPublic: ev.legacyPublic !== undefined ? ev.legacyPublic : true
            }
          }
        );
        tokenCount++;
      }
      console.log(`✅ Generated 128-bit publicToken and enabled legacyPublic for ${tokenCount} evidence records.`);
    } else {
      console.log(`[Preview] Would generate publicTokens for ${evidencesMissingToken.length} evidence records (with legacyPublic: true).`);
    }
  } else {
    console.log('ℹ️  All evidence records have publicToken populated.');
  }

  // ── Step 5: Replace old unique indexes with compound ones ──
  console.log('\n--- Updating Database Indexes (Single -> Compound per Org) ---');
  const indexDrops = [
    { col: 'blocks', indexName: 'blockNumber_1', key: { blockNumber: 1 } },
    { col: 'blocks', indexName: 'currentHash_1', key: { currentHash: 1 } },
    { col: 'blocks', indexName: 'previousHash_1', key: { previousHash: 1 } },
    { col: 'auditlogs', indexName: 'eventId_1', key: { eventId: 1 } },
    { col: 'auditlogs', indexName: 'seq_1', key: { seq: 1 } },
    { col: 'auditlogs', indexName: 'entryHash_1', key: { entryHash: 1 } },
    { col: 'evidences', indexName: 'hash_1', key: { hash: 1 } },
    { col: 'evidences', indexName: 'evidenceId_1', key: { evidenceId: 1 } },
    { col: 'verifications', indexName: 'verificationId_1', key: { verificationId: 1 } },
    { col: 'custodyevents', indexName: 'custodyId_1', key: { custodyId: 1 } },
    { col: 'userkeys', indexName: 'keyId_1', key: { keyId: 1 } },
    { col: 'userkeys', indexName: 'fingerprint_1', key: { fingerprint: 1 } },
    { col: 'counters', indexName: 'name_1', key: { name: 1 } }
  ];

  if (isConfirm) {
    for (const drop of indexDrops) {
      const col = db.collection(drop.col);
      const droppedName = await dropIndexIfPresent(col, drop.indexName, drop.key);
      if (droppedName) {
        console.log(`  [Index] Dropped legacy single index ${drop.col}.${droppedName}`);
      }
    }

    // Synchronize all models' indexes from current schema definitions
    for (const { name, model } of targetCollections) {
      try {
        await model.syncIndexes();
        console.log(`✅ [${name}] Compound unique indexes synchronized successfully.`);
      } catch (idxErr) {
        console.warn(`  [Warning] [${name}] syncIndexes message:`, idxErr.message);
      }
    }
  } else {
    console.log('[Preview] Would drop legacy single indexes and sync compound schema indexes for all tenant models.');
  }

  // ── Step 6: Ensure Genesis Block for Default Organization ──
  if (isConfirm) {
    await ensureGenesis('default');
  }

  // ── Step 7: Cryptographic Chain Integrity Validations ──
  console.log('\n--- Cryptographic Chain Integrity Verification ---');
  const orgs = isConfirm 
    ? await Organization.find({}).lean() 
    : [{ orgId: 'default', name: 'Default Organization' }];

  for (const org of orgs) {
    const orgId = org.orgId;
    console.log(`\nVerifying chains for Organization: [${orgId}] (${org.name})...`);

    const blockRes = await validateChain(orgId);
    if (!blockRes.valid) {
      console.error(`❌ Blockchain Ledger validation FAILED for org [${orgId}]:`, blockRes.issues);
      throw new Error(`Blockchain validation failed for org ${orgId}`);
    }
    console.log(`  Blockchain Ledger: ✅ VALID (${blockRes.blocksChecked} blocks checked)`);

    const auditRes = await validateAuditChain(orgId);
    if (!auditRes.valid) {
      console.error(`❌ Audit Chain validation FAILED for org [${orgId}]:`, auditRes.issues);
      throw new Error(`Audit chain validation failed for org ${orgId}`);
    }
    console.log(`  Audit Chain:       ✅ VALID (${auditRes.count || 0} entries checked)`);
  }

  // ── Step 8: Print Summary Counts ──
  console.log('\n======================================================================');
  console.log('                       Migration Summary Counts                       ');
  console.log('======================================================================');

  const summary = [
    { Entity: 'Organizations', Count: await db.collection('organizations').countDocuments() },
    { Entity: 'Users (Total)', Count: await db.collection('users').countDocuments() },
    { Entity: '  - SUPER_ADMIN', Count: await db.collection('users').countDocuments({ role: 'SUPER_ADMIN' }) },
    { Entity: '  - ORG_ADMIN', Count: await db.collection('users').countDocuments({ role: 'ORG_ADMIN' }) },
    { Entity: '  - INVESTIGATOR', Count: await db.collection('users').countDocuments({ role: 'INVESTIGATOR' }) },
    { Entity: '  - LAB_ANALYST', Count: await db.collection('users').countDocuments({ role: 'LAB_ANALYST' }) },
    { Entity: '  - COURT_OFFICER', Count: await db.collection('users').countDocuments({ role: 'COURT_OFFICER' }) },
    { Entity: '  - AUDITOR', Count: await db.collection('users').countDocuments({ role: 'AUDITOR' }) },
    { Entity: '  - VIEWER', Count: await db.collection('users').countDocuments({ role: 'VIEWER' }) },
    { Entity: 'Evidence (Total)', Count: await db.collection('evidences').countDocuments() },
    { Entity: '  - With publicToken', Count: await db.collection('evidences').countDocuments({ publicToken: { $exists: true, $ne: null } }) },
    { Entity: '  - Legacy Public', Count: await db.collection('evidences').countDocuments({ legacyPublic: true }) },
    { Entity: 'Blocks', Count: await db.collection('blocks').countDocuments() },
    { Entity: 'Audit Logs', Count: await db.collection('auditlogs').countDocuments() },
    { Entity: 'Custody Events', Count: await db.collection('custodyevents').countDocuments() },
    { Entity: 'Verifications', Count: await db.collection('verifications').countDocuments() },
    { Entity: 'Anchors', Count: await db.collection('anchors').countDocuments() }
  ];

  console.table(summary);

  if (!isConfirm) {
    console.log('\n⚡ DRY RUN COMPLETED: No database records were modified.');
    console.log('To execute this migration, re-run with --confirm:');
    console.log('  node scripts/migrate-multiorg.js --confirm\n');
  } else {
    console.log('\n🎉 SPRINT 15A MIGRATION COMPLETED SUCCESSFULLY.\n');
  }

  if (mongod) await mongod.stop();
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\n❌ Migration failed with error:', err);
  process.exit(1);
});
