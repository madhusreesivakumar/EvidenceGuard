const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const AuditLog = require('../models/AuditLog');
const { logEvent } = require('../services/auditService');

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  console.log("Connected to in-memory DB");

  await AuditLog.syncIndexes();

  console.log("\\n--- CHECK: Write 3 Events ---");
  await logEvent({ action: 'LOGIN', description: 'User login' });
  await logEvent({ action: 'UPLOAD', description: 'Evidence uploaded' });
  await logEvent({ action: 'VERIFY', description: 'Evidence verified' });
  
  const count = await AuditLog.countDocuments();
  if (count === 3) {
    console.log("PASS: 3 events written successfully.");
  } else {
    console.error(`FAIL: Expected 3 events, found ${count}`);
  }

  const firstLog = await AuditLog.findOne({ action: 'LOGIN' });

  console.log("\\n--- CHECK: Attempt Update ---");
  try {
    await AuditLog.updateOne({ _id: firstLog._id }, { $set: { description: 'Tampered desc' } });
    console.error("FAIL: Update was allowed!");
  } catch (err) {
    if (err.message.includes('append-only')) {
      console.log("PASS: Update cleanly rejected.");
    } else {
      console.error("FAIL: Unexpected update error:", err.message);
    }
  }

  console.log("\\n--- CHECK: Attempt Delete ---");
  try {
    await AuditLog.deleteOne({ _id: firstLog._id });
    console.error("FAIL: Delete was allowed!");
  } catch (err) {
    if (err.message.includes('append-only')) {
      console.log("PASS: Delete cleanly rejected.");
    } else {
      console.error("FAIL: Unexpected delete error:", err.message);
    }
  }

  await mongoose.disconnect();
  await mongod.stop();
  console.log("\\nTests Complete");
}

runTests().catch(console.error);
