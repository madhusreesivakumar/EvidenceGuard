require('dotenv').config();
const mongoose = require('mongoose');

async function tamper() {
  if (process.env.NODE_ENV === 'production') {
    console.error("Refusing to run in production.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (!args.includes('--confirm')) {
    console.error("Requires explicit flag --confirm");
    process.exit(1);
  }

  const mode = args.find(a => !a.startsWith('--'));
  if (!['change-block-hash', 'change-previous-hash', 'change-evidence-hash', 'delete-block'].includes(mode)) {
    console.error("Invalid mode. Use: change-block-hash, change-previous-hash, change-evidence-hash, delete-block");
    process.exit(1);
  }

  const connectDB = require('../config/db');
  await connectDB();

  const collection = mongoose.connection.db.collection('blocks');
  const targetBlock = await collection.findOne({ blockNumber: 1 });
  if (!targetBlock) {
    console.error("Block 1 not found.");
    process.exit(1);
  }

  const { validateChain } = require('../services/chainValidator');

  console.log(`\n--- TAMPERING BLOCK 1 WITH MODE: ${mode} ---`);
  
  let restoreQuery = null;

  if (mode === 'change-block-hash') {
    await collection.updateOne({ blockNumber: 1 }, { $set: { currentHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' } });
    restoreQuery = { $set: { currentHash: targetBlock.currentHash } };
  } else if (mode === 'change-previous-hash') {
    await collection.updateOne({ blockNumber: 1 }, { $set: { previousHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' } });
    restoreQuery = { $set: { previousHash: targetBlock.previousHash } };
  } else if (mode === 'change-evidence-hash') {
    await collection.updateOne({ blockNumber: 1 }, { $set: { evidenceHash: '1111111111111111111111111111111111111111111111111111111111111111' } });
    restoreQuery = { $set: { evidenceHash: targetBlock.evidenceHash } };
  } else if (mode === 'delete-block') {
    await collection.deleteOne({ blockNumber: 1 });
    restoreQuery = targetBlock;
  }

  const result = await validateChain();
  console.log(`Result: ${result.message}`);
  console.log(`First broken block: ${result.firstBrokenBlock}`);
  console.log(`Issues:`, result.issues);

  console.log(`\n--- RESTORING ---`);
  if (mode === 'delete-block') {
    await collection.insertOne(restoreQuery);
  } else {
    await collection.updateOne({ blockNumber: 1 }, restoreQuery);
  }

  const restoreResult = await validateChain();
  console.log(`Restored Blockchain Result: ${restoreResult.message}`);
  if (!restoreResult.valid) {
    console.error("FATAL: Failed to restore blockchain integrity!");
    await mongoose.disconnect();
    process.exit(1);
  }

  const { validateAuditChain } = require('../services/auditHash');
  const auditResult = await validateAuditChain();
  console.log(`Restored Audit Chain Result: ${auditResult.message}`);
  if (!auditResult.valid) {
    console.error("FATAL: Audit chain is not valid!");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('\n[PASS] Both chains confirmed VALID after tamper demo.');
  await mongoose.disconnect();
  process.exit(0);
}

tamper().catch(err => {
  console.error(err);
  process.exit(1);
});
