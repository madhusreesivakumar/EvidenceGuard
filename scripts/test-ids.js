const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { nextEvidenceId, nextCaseId } = require('../services/idService');
const Counter = require('../models/Counter');

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  
  await mongoose.connect(uri);
  console.log("Connected to in-memory DB");
  
  console.log("\\n--- CHECK: Concurrent Evidence IDs ---");
  const evPromises = [];
  for (let i = 0; i < 50; i++) {
    evPromises.push(nextEvidenceId());
  }
  const evResults = await Promise.all(evPromises);
  const evSet = new Set(evResults);
  if (evSet.size === 50 && evResults.includes('EV-0001') && evResults.includes('EV-0050')) {
    console.log("PASS: 50 concurrent Evidence IDs are unique and sequential.");
  } else {
    console.error("FAIL: Evidence IDs are not unique or sequential.");
    console.log(evResults);
  }

  console.log("\\n--- CHECK: Concurrent Case IDs ---");
  const casePromises = [];
  for (let i = 0; i < 50; i++) {
    casePromises.push(nextCaseId());
  }
  const caseResults = await Promise.all(casePromises);
  const caseSet = new Set(caseResults);
  const year = new Date().getFullYear();
  if (caseSet.size === 50 && caseResults.includes(`EG-${year}-0001`) && caseResults.includes(`EG-${year}-0050`)) {
    console.log("PASS: 50 concurrent Case IDs are unique and sequential.");
  } else {
    console.error("FAIL: Case IDs are not unique or sequential.");
    console.log(caseResults);
  }
  
  console.log("\\n--- CHECK: Restart Simulation ---");
  await mongoose.disconnect();
  // Simulate a server restart where the DB connection drops but data persists
  await mongoose.connect(uri);
  const nextEv = await nextEvidenceId();
  if (nextEv === 'EV-0051') {
    console.log("PASS: Numbering continues after reconnecting (EV-0051).");
  } else {
    console.error(`FAIL: Expected EV-0051, got ${nextEv}`);
  }
  
  await mongoose.disconnect();
  await mongod.stop();
  console.log("\\nTests Complete");
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
