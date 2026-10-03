'use strict';

/**
 * scripts/migrate-custody.js
 * Sprint 12: Chain of Custody Migration & Backfill
 * Idempotently backfills initial COLLECTED custody events for pre-existing evidence records.
 * 
 * Usage:
 *   node scripts/migrate-custody.js           # Dry-run mode (no changes applied)
 *   node scripts/migrate-custody.js --confirm # Apply changes
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const connectDB = require('../config/db');
const Evidence = require('../models/Evidence');
const User = require('../models/User');
const CustodyEvent = require('../models/CustodyEvent');
const { computeCustodyHash, GENESIS_PREV_HASH } = require('../services/custodyService');
const { validateChain } = require('../services/chainValidator');
const { validateAuditChain } = require('../services/auditHash');

const isConfirm = process.argv.includes('--confirm');

async function runMigration() {
  console.log('======================================================================');
  console.log(`     EvidenceGuard Sprint 12 – Custody Migration & Backfill           `);
  console.log(`     Mode: ${isConfirm ? 'LIVE APPLY (--confirm)' : 'DRY RUN (preview only)'}    `);
  console.log('======================================================================\n');

  let mongod = null;
  if (!process.env.MONGODB_URI) {
    console.log('[Notice] No MONGODB_URI configured. Starting temporary in-memory database...');
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
  }

  await connectDB();

  const allEvidence = await Evidence.find({ isDeleted: false }).sort({ createdAt: 1 }).lean();
  console.log(`[Scan] Total active evidence records found: ${allEvidence.length}`);

  let toBackfill = [];

  for (const ev of allEvidence) {
    const existingEventsCount = await CustodyEvent.countDocuments({ evidenceId: ev.evidenceId });
    if (existingEventsCount === 0) {
      toBackfill.push(ev);
    }
  }

  console.log(`[Scan] Evidence records requiring custody backfill: ${toBackfill.length}`);

  if (toBackfill.length === 0) {
    console.log('\n[PASS] All evidence records already have custody tracking established. Nothing to do.');
    await checkChains();
    process.exit(0);
  }

  // Pre-load users
  const users = await User.find({}).lean();
  const userMap = new Map();
  users.forEach(u => userMap.set(String(u._id), u));
  const fallbackAdmin = users.find(u => u.role === 'ADMIN') || users[0];

  let appliedCount = 0;

  for (const ev of toBackfill) {
    const uploader = (ev.uploadedBy && userMap.get(String(ev.uploadedBy))) || fallbackAdmin;
    const custodyId = crypto.randomUUID();
    const eventTime = ev.createdAt || new Date();

    const eventData = {
      custodyId,
      evidenceId: ev.evidenceId,
      seq: 1,
      type: 'COLLECTED',
      actorUserId: uploader ? uploader._id : null,
      actorName: uploader ? (uploader.name || uploader.email) : 'System Uploader',
      toUserId: null,
      toUserName: '',
      externalParty: { name: null, organization: null },
      reason: 'Backfilled initial evidence intake registration',
      location: 'Digital Intake Repository',
      conditionNotes: 'Imported from pre-custody legacy records',
      occurredAt: eventTime,
      recordedAt: new Date(),
      auto: true,
      backfilled: true,
      prevHash: GENESIS_PREV_HASH
    };

    const entryHash = computeCustodyHash(eventData);
    eventData.entryHash = entryHash;

    if (isConfirm) {
      await CustodyEvent.create(eventData);
      appliedCount++;
      console.log(`  [APPLIED] Evidence ${ev.evidenceId}: Created COLLECTED event (seq #1, hash: ${entryHash.substring(0, 12)}...)`);
    } else {
      console.log(`  [DRY-RUN] Evidence ${ev.evidenceId}: Would create COLLECTED event for user "${eventData.actorName}"`);
    }
  }

  if (!isConfirm) {
    console.log(`\n[DRY RUN COMPLETE] ${toBackfill.length} records would be backfilled.`);
    console.log('Run with --confirm to apply changes: node scripts/migrate-custody.js --confirm\n');
  } else {
    console.log(`\n[SUCCESS] Successfully backfilled ${appliedCount} custody records.`);
  }

  await checkChains();
  if (mongod) await mongod.stop();
  process.exit(0);
}

async function checkChains() {
  console.log('\n[Integrity Check] Validating system chains...');
  try {
    const blockchainResult = await validateChain();
    console.log(`  Blockchain Ledger: ${blockchainResult.valid ? '✅ VALID' : '❌ INVALID'}`);
    if (!blockchainResult.valid) {
      console.error('  Blockchain issues:', blockchainResult.issues);
    }

    const auditResult = await validateAuditChain();
    console.log(`  Audit Chain:       ${auditResult.valid ? '✅ VALID' : '❌ INVALID'}`);
    if (!auditResult.valid) {
      console.error('  Audit chain issues:', auditResult.issues);
    }
  } catch (err) {
    console.warn('  [WARN] Chain check skipped or failed:', err.message);
  }
}

runMigration().catch(err => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});
