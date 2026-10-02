/**
 * ==============================================================================
 * SCRIPT: backfill-audit-chain.js
 * ------------------------------------------------------------------------------
 * One-time migration script to initialize and backfill the cryptographic
 * hash-chain for existing unchained AuditLog records.
 * 
 * IMPORTANT ARCHITECTURAL NOTE:
 * This script uses the native MongoDB driver (collection.updateOne) to update
 * existing audit log rows. This is the ONLY code in the entire system permitted
 * to modify existing audit records, specifically for schema migration purposes.
 * ==============================================================================
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { computeAuditHash } = require('../services/auditHash');

async function main() {
  const args = process.argv.slice(2);
  const isConfirmed = args.includes('--confirm');
  const isForce = args.includes('--force');
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isConfirmed) {
    console.error('ERROR: Migration requires --confirm flag to execute.');
    console.error('Usage: node scripts/backfill-audit-chain.js --confirm [--force]');
    process.exit(1);
  }

  if (isProduction && !isForce) {
    console.error('ERROR: Running in production requires --force flag.');
    console.error('Usage: node scripts/backfill-audit-chain.js --confirm --force');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/evidenceguard';
  console.log(`Connecting to database...`);
  await mongoose.connect(mongoUri);

  try {
    console.log('Fetching audit records...');

    // Find highest already-chained entry
    const lastChained = await AuditLog.findOne({ seq: { $ne: null } }).sort({ seq: -1 }).lean();
    let currentSeq = lastChained && typeof lastChained.seq === 'number' ? lastChained.seq : 0;
    let prevHash = lastChained && lastChained.entryHash ? lastChained.entryHash : '0000000000000000';

    console.log(`Current chain head: seq=${currentSeq}, prevHash=${prevHash}`);

    // Fetch unchained entries ordered by timestamp asc, then eventId asc
    const unchained = await AuditLog.find({
      $or: [
        { seq: null },
        { seq: { $exists: false } },
        { entryHash: null },
        { entryHash: { $exists: false } }
      ]
    }).sort({ timestamp: 1, eventId: 1 }).lean();

    if (unchained.length === 0) {
      console.log('SUCCESS: All audit entries are already chained. Nothing to backfill.');
      return;
    }

    console.log(`Found ${unchained.length} unchained audit entries. Beginning migration...`);

    let updatedCount = 0;
    for (const entry of unchained) {
      currentSeq += 1;
      const seq = currentSeq;
      const entryPrevHash = prevHash;

      const entryHash = computeAuditHash({
        seq,
        eventId: entry.eventId,
        userId: entry.userId || null,
        userName: entry.userName || null,
        role: entry.role || null,
        action: entry.action || null,
        evidenceId: entry.evidenceId || null,
        caseId: entry.caseId || null,
        description: entry.description || null,
        timestamp: entry.timestamp,
        ipAddress: entry.ipAddress || null,
        prevHash: entryPrevHash
      });

      // Update directly via native MongoDB collection to bypass Mongoose immutable pre-hooks
      await AuditLog.collection.updateOne(
        { _id: entry._id },
        {
          $set: {
            seq,
            prevHash: entryPrevHash,
            entryHash
          }
        }
      );

      prevHash = entryHash;
      updatedCount++;
    }

    console.log('====================================================');
    console.log(`BACKFILL SUMMARY:`);
    console.log(`- Total unchained entries migrated: ${updatedCount}`);
    console.log(`- Final chain sequence: ${currentSeq}`);
    console.log(`- Final chain head hash: ${prevHash}`);
    console.log('====================================================');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
