require('dotenv').config();
const args8a = process.argv.slice(2);
if (process.env.NODE_ENV === 'production') {
  console.error('ERROR: Refusing to run backfill-blocks in production.');
  process.exit(1);
}
if (!args8a.includes('--confirm')) {
  console.error('ERROR: backfill-blocks.js requires --confirm flag.');
  console.error('Usage: node scripts/backfill-blocks.js --confirm');
  process.exit(1);
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Evidence = require('../models/Evidence');
const { appendBlock, ensureGenesis } = require('../services/chainService');
const { logEvent } = require('../services/auditService');

async function backfill() {
  await connectDB();
  await ensureGenesis();

  const missingEvidence = await Evidence.find({ blockNumber: null }).sort({ createdAt: 1 });
  
  if (missingEvidence.length === 0) {
    console.log('No evidence found without a blockNumber. Backfill is complete.');
    process.exit(0);
  }

  console.log(`Found ${missingEvidence.length} evidence records without blocks. Starting backfill...`);

  let successCount = 0;
  let failCount = 0;

  for (const evidence of missingEvidence) {
    try {
      if (global.TRANSACTIONS_SUPPORTED) {
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
          const block = await appendBlock({ evidence, session });
          evidence.blockNumber = block.blockNumber;
          await evidence.save({ session });
        });
        session.endSession();
      } else {
        const block = await appendBlock({ evidence, session: null });
        evidence.blockNumber = block.blockNumber;
        await evidence.save();
      }

      await logEvent({
        action: 'BLOCK_CREATED',
        user: { _id: null }, // System action
        evidenceId: evidence.evidenceId,
        caseId: evidence.caseId,
        description: `Block #${evidence.blockNumber} created for ${evidence.evidenceId} (Backfill)`,
        req: null
      });

      console.log(`[OK] Backfilled block #${evidence.blockNumber} for Evidence ${evidence.evidenceId}`);
      successCount++;
    } catch (err) {
      console.error(`[ERROR] Failed to backfill Evidence ${evidence.evidenceId}:`, err.message);
      failCount++;
    }
  }

  console.log(`\nBackfill Summary:`);
  console.log(`Total processed: ${missingEvidence.length}`);
  console.log(`Successfully backfilled: ${successCount}`);
  console.log(`Failed: ${failCount}`);

  process.exit(0);
}

backfill();
