const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ensureGenesis } = require('../services/chainService');
const Block = require('../models/Block');

async function testIdempotency() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Block.syncIndexes(); // Ensure indexes are ready to catch E11000

  // Fire 3 concurrently
  const p1 = ensureGenesis();
  const p2 = ensureGenesis();
  const p3 = ensureGenesis();
  
  await Promise.all([p1, p2, p3]);

  const count = await Block.countDocuments();
  console.log('Total genesis blocks:', count);
  const genesis = await Block.findOne({ blockNumber: 0 });
  console.log('Genesis previousHash:', genesis.previousHash);
  
  await mongoose.disconnect();
  await mongod.stop();
}

testIdempotency().catch(console.error);
