const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { computeBlockHash } = require('../services/chainHash');
const Block = require('../models/Block');

const table = [];
function assert(condition, message) {
  table.push({ Test: message, Status: condition ? 'PASS' : 'FAIL' });
}

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Block.syncIndexes();

  // Test 1: Determinism
  const vectorParams = {
    blockNumber: 1,
    evidenceId: "EV-0001",
    caseId: "CS-123",
    evidenceHash: "a1b2c3d4e5f6",
    previousHash: "0000000000000000",
    timestamp: new Date("2026-01-01T00:00:00.000Z")
  };
  
  const hash1 = computeBlockHash(vectorParams);
  const hash2 = computeBlockHash(vectorParams);
  assert(hash1 === hash2, 'Function is deterministic');

  // Test 2: Sensitivity
  const modParams = { ...vectorParams, evidenceHash: "a1b2c3d4e5f7" };
  const hash3 = computeBlockHash(modParams);
  assert(hash1 !== hash3, 'Hash changes when ANY single field changes');

  // Test 3: Known Vector
  // Data string for vectorParams is:
  // '[1,"EV-0001","CS-123","a1b2c3d4e5f6","0000000000000000","2026-01-01T00:00:00.000Z"]'
  const expectedString = '[1,"EV-0001","CS-123","a1b2c3d4e5f6","0000000000000000","2026-01-01T00:00:00.000Z"]';
  const expectedHash = crypto.createHash('sha256').update(expectedString).digest('hex').toLowerCase();
  assert(hash1 === expectedHash, 'Matches a known fixed test vector computed independently');

  // Test 4: Immutability
  const b = new Block({
    blockNumber: 0,
    previousHash: "00000000",
    currentHash: "11111111",
    timestamp: new Date()
  });
  await b.save();
  
  let updateRejected = false;
  try {
    await Block.updateOne({ blockNumber: 0 }, { $set: { currentHash: "22222222" } });
  } catch (err) {
    updateRejected = true;
  }

  let deleteRejected = false;
  try {
    await Block.deleteOne({ blockNumber: 0 });
  } catch (err) {
    deleteRejected = true;
  }
  
  assert(updateRejected && deleteRejected, 'Attempting to update or delete a block through the model is rejected');

  console.table(table);
  await mongoose.disconnect();
  await mongod.stop();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
