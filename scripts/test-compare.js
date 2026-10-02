const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { resolveEvidence, compareHashes } = require('../services/verificationService');
const Evidence = require('../models/Evidence');

const table = [];
function assert(condition, message) {
  table.push({ Test: message, Status: condition ? 'PASS' : 'FAIL' });
  if (!condition) {
    console.error(`FAILED: ${message}`);
  }
}

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // 1. compareHashes unit checks
  const hash1 = 'a'.repeat(64);
  const hash2 = 'a'.repeat(64);
  const hash3 = 'a'.repeat(63) + 'b';
  const hashUpper = 'A'.repeat(64);
  const hashShort = 'a'.repeat(63);
  const hashNonHex = 'z'.repeat(64);
  
  assert(compareHashes(hash1, hash2) === true, 'compareHashes: exact match returns true');
  assert(compareHashes(hash1, hash3) === false, 'compareHashes: one char difference returns false');
  
  try { compareHashes(hash1, hashUpper); assert(false, 'compareHashes: uppercase should throw'); }
  catch(e) { assert(e.message.includes('Invalid format'), 'compareHashes: uppercase rejected'); }

  try { compareHashes(hash1, hashShort); assert(false, 'compareHashes: short input should throw'); }
  catch(e) { assert(e.message.includes('Invalid format'), 'compareHashes: short input rejected'); }

  try { compareHashes(hash1, hashNonHex); assert(false, 'compareHashes: non-hex should throw'); }
  catch(e) { assert(e.message.includes('Invalid format'), 'compareHashes: non-hex rejected'); }

  try { compareHashes(hash1, ''); assert(false, 'compareHashes: empty should throw'); }
  catch(e) { assert(e.message.includes('Invalid format'), 'compareHashes: empty rejected'); }


  // 2. resolveEvidence identifier validation
  await Evidence.create({ evidenceId: 'EV-1234', caseId: 'EG-1111-1111', hash: hash1 });
  await Evidence.create({ evidenceId: 'EV-9999', caseId: 'EG-1234-5678', hash: hash1 });

  try {
    await resolveEvidence('EV-1234');
    assert(true, 'resolveEvidence: valid EV format passes');
  } catch(e) { assert(false, 'resolveEvidence: valid EV format passes'); }

  try {
    await resolveEvidence('EG-1234-5678');
    assert(true, 'resolveEvidence: valid EG case format passes');
  } catch(e) { assert(false, 'resolveEvidence: valid EG case format passes'); }

  const badInputs = ['EV-1', 'EG-123-123', '../etc', '{$ne:null}', 'EV-1234 '];
  for (const bad of badInputs) {
    try {
      await resolveEvidence(bad);
      assert(false, `resolveEvidence: bad format ${bad} should throw 400`);
    } catch(e) {
      assert(e.status === 400, `resolveEvidence: bad format ${bad} rejected with 400`);
    }
  }

  // Soft delete check
  await Evidence.create({ evidenceId: 'EV-000000', caseId: 'EG-0000-0000', hash: hash1, isDeleted: true });
  try {
    await resolveEvidence('EV-000000');
    assert(false, 'resolveEvidence: soft-deleted should throw 404');
  } catch(e) {
    assert(e.status === 404, 'resolveEvidence: soft-deleted returns 404');
  }
  
  // Model immutability check
  const Verification = require('../models/Verification');
  const ver = await Verification.create({
    verificationId: 'VER-000001', evidenceId: 'EV-1234', originalHash: hash1, submittedHash: hash1,
    result: 'VERIFIED', chainConsistent: true
  });
  
  try {
    await Verification.updateOne({ verificationId: 'VER-000001' }, { result: 'TAMPERED' });
    assert(false, 'Verification model: updateOne should throw');
  } catch(e) {
    assert(e.message.includes('Updates and deletions are forbidden'), 'Verification model: updates rejected');
  }

  console.table(table);

  await mongoose.disconnect();
  await mongod.stop();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
