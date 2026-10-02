'use strict';

const crypto = require('crypto');
const { computeAuditHash } = require('../services/auditHash');

function runTestVector() {
  console.log('--- Running test-audithash.js ---');

  // Hardcoded test vector definition
  const rawCanonical = JSON.stringify([
    1,
    'EVT-000001',
    '60d5ec49f1b2c8b1f8e4e1a1',
    'Alice Smith',
    'ADMIN',
    'UPLOAD',
    'EV-0001',
    'EG-2026-0001',
    'Initial evidence upload test',
    '2026-01-15T12:00:00.000Z',
    '192.168.1.100',
    '0000000000000000'
  ]);
  const expectedHash = crypto.createHash('sha256').update(rawCanonical, 'utf8').digest('hex');

  const vectorInput = {
    seq: 1,
    eventId: 'EVT-000001',
    userId: '60d5ec49f1b2c8b1f8e4e1a1',
    userName: 'Alice Smith',
    role: 'ADMIN',
    action: 'UPLOAD',
    evidenceId: 'EV-0001',
    caseId: 'EG-2026-0001',
    description: 'Initial evidence upload test',
    timestamp: new Date('2026-01-15T12:00:00.000Z'),
    ipAddress: '192.168.1.100',
    prevHash: '0000000000000000'
  };

  const calculatedHash = computeAuditHash(vectorInput);

  if (calculatedHash !== expectedHash) {
    throw new Error(`Hash mismatch against fixed test vector!\nExpected: ${expectedHash}\nGot:      ${calculatedHash}`);
  }
  console.log(`PASS: computeAuditHash matches fixed test vector (${calculatedHash.slice(0, 16)}...)`);

  // Assert that changing ANY field produces a strictly different hash
  const fields = [
    { key: 'seq', val: 2 },
    { key: 'eventId', val: 'EVT-000002' },
    { key: 'userId', val: '60d5ec49f1b2c8b1f8e4e1a2' },
    { key: 'userName', val: 'Bob Jones' },
    { key: 'role', val: 'INVESTIGATOR' },
    { key: 'action', val: 'VERIFY' },
    { key: 'evidenceId', val: 'EV-0002' },
    { key: 'caseId', val: 'EG-2026-0002' },
    { key: 'description', val: 'Modified description' },
    { key: 'timestamp', val: new Date('2026-01-15T12:00:01.000Z') },
    { key: 'ipAddress', val: '192.168.1.101' },
    { key: 'prevHash', val: '1111111111111111' }
  ];

  for (const field of fields) {
    const mutated = { ...vectorInput, [field.key]: field.val };
    const mutatedHash = computeAuditHash(mutated);
    if (mutatedHash === expectedHash) {
      throw new Error(`Collision / undetected mutation on field: ${field.key}`);
    }
    console.log(`PASS: Mutation on field "${field.key}" successfully alters hash`);
  }

  // Assert handling of null / undefined fields
  const emptyHash1 = computeAuditHash({});
  const emptyHash2 = computeAuditHash({ seq: null, eventId: null });
  if (emptyHash1 !== emptyHash2) {
    throw new Error('computeAuditHash must be deterministic with null/missing values');
  }
  console.log('PASS: computeAuditHash handles null/missing fields deterministically');

  console.log('\nALL AUDIT HASH TESTS PASSED (100%)\n');
}

runTestVector();
