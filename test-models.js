const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('./models/User');
const Evidence = require('./models/Evidence');
const Block = require('./models/Block');
const AuditLog = require('./models/AuditLog');

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  
  await mongoose.connect(uri);
  console.log("Connected to in-memory DB");
  
  await Promise.all([
    User.syncIndexes(),
    Evidence.syncIndexes(),
    Block.syncIndexes(),
    AuditLog.syncIndexes()
  ]);

  console.log("\n--- INDEXES ---");
  for (const model of [User, Evidence, Block, AuditLog]) {
    const indexes = await model.collection.indexes();
    console.log(`\n${model.modelName} Indexes:`);
    console.log(JSON.stringify(indexes, null, 2));
  }

  console.log("\n--- CHECK: User duplicate email ---");
  try {
    await User.create({ name: "User 1", email: "test@example.com", passwordHash: "123" });
    await User.create({ name: "User 2", email: "test@example.com", passwordHash: "456" });
    console.error("FAIL: Duplicate user did not throw");
  } catch (err) {
    if (err.code === 11000) {
      console.log("PASS: Duplicate-key error thrown on email.");
    } else {
      console.error("FAIL: Unexpected error:", err.message);
    }
  }

  console.log("\n--- CHECK: Evidence invalid hash ---");
  try {
    await Evidence.create({
      evidenceId: "E1", caseId: "C1", hash: "invalid-hash-too-short", status: "Pending"
    });
    console.error("FAIL: Invalid hash did not throw");
  } catch (err) {
    if (err.name === 'ValidationError') {
      console.log("PASS: Validation error thrown on hash.");
    } else {
      console.error("FAIL: Unexpected error:", err.message);
    }
  }

  console.log("\n--- CHECK: User JSON output (no passwordHash) ---");
  const userDoc = await User.findOne({ email: "test@example.com" });
  const userJson = userDoc.toJSON();
  if (userJson.passwordHash === undefined && userDoc.passwordHash === "123") {
    console.log("PASS: passwordHash is stripped in toJSON, but was saved in DB.");
  } else {
    console.error("FAIL: JSON output contains passwordHash or not saved:", userJson);
  }

  await mongoose.disconnect();
  await mongod.stop();
  console.log("\nTests Complete");
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
