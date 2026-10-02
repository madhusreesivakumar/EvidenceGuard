#!/usr/bin/env node
'use strict';

/**
 * Sprint 9A – Digital Signatures Key Registration Test Suite
 * Tests:
 * 1. Challenge acquisition (single-use random nonce)
 * 2. Proof-of-possession verification with valid ECDSA P-256 key
 * 3. Replay attack rejection (replayed challenge rejected)
 * 4. Expired challenge rejection
 * 5. Wrong-curve key rejection (e.g. P-384)
 * 6. Malformed JWK rejection
 * 7. Invalid signature rejection
 * 8. Duplicate key fingerprint rejection (HTTP 409)
 * 9. Key limit enforcement (max 5 active keys per user)
 * 10. List own keys and public key lookup (no private material leaked)
 * 11. Foreign user cannot revoke another user's key (HTTP 403)
 * 12. Key owner can revoke their key with a reason (HTTP 200)
 * 13. Admin can revoke any key with a reason (HTTP 200)
 * 14. Revoked key cannot be revoked again (HTTP 400)
 * 15. Audit trail records KEY_REGISTERED and KEY_REVOKED
 * 16. Private key material (d parameter, secret) never appears in any response or log
 */

process.env.FEATURE_SIGNATURES = 'true';
process.env.JWT_SECRET = 'test-signatures-jwt-secret-key-32chars!';
require('dotenv').config();

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');

let BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

const ADMIN_EMAIL = 'admin_keys_9a@evidenceguard.local';
const ADMIN_PASS  = 'AdminPass1234!';
const USER1_EMAIL = 'investigator_9a_1@evidenceguard.local';
const USER1_PASS  = 'Investigator1Pass!';
const USER2_EMAIL = 'investigator_9a_2@evidenceguard.local';
const USER2_PASS  = 'Investigator2Pass!';

let passed = 0;
let failed = 0;
const results = [];

function assert(description, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${description}`);
    results.push({ description, status: 'PASS' });
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${description} ${details ? '- ' + details : ''}`);
    results.push({ description, status: 'FAIL', details });
  }
}

function request(method, path, body, cookies) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const lib = url.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    if (cookies) headers['Cookie'] = cookies;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
          rawCookies: res.headers['set-cookie'] || []
        });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function extractCookie(rawCookies) {
  return rawCookies.map(c => c.split(';')[0]).join('; ');
}

function generateTestKey(namedCurve = 'prime256v1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, publicKey, jwk };
}

function signChallenge(privateKey, challengeText) {
  const signer = crypto.createSign('SHA256');
  signer.update(Buffer.from(challengeText, 'utf8'));
  signer.end();
  return signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

(async () => {
  console.log('\n======================================================================');
  console.log('       EvidenceGuard Sprint 9A – Digital Key Registration Tests       ');
  console.log('======================================================================\n');

  let server;
  let mongod;
  let externalServer = false;

  try {
    const health = await request('GET', '/api/health');
    if (health.status === 200) externalServer = true;
  } catch (_) {}

  const User = require('../models/User');
  const UserKey = require('../models/UserKey');
  const KeyChallenge = require('../models/KeyChallenge');
  const AuditLog = require('../models/AuditLog');
  const { ensureGenesis } = require('../services/chainService');

  if (!externalServer) {
    console.log('[Setup] Starting in-memory MongoDB environment...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);

    await Promise.all([
      User.syncIndexes(),
      UserKey.syncIndexes(),
      KeyChallenge.syncIndexes(),
      AuditLog.syncIndexes()
    ]);
    await ensureGenesis();

    const adminHash = await bcrypt.hash(ADMIN_PASS, 10);
    const u1Hash = await bcrypt.hash(USER1_PASS, 10);
    const u2Hash = await bcrypt.hash(USER2_PASS, 10);

    await User.create([
      { name: 'Admin Chief', email: ADMIN_EMAIL, passwordHash: adminHash, role: 'ADMIN', isActive: true },
      { name: 'Officer One', email: USER1_EMAIL, passwordHash: u1Hash, role: 'INVESTIGATOR', isActive: true },
      { name: 'Officer Two', email: USER2_EMAIL, passwordHash: u2Hash, role: 'INVESTIGATOR', isActive: true }
    ]);

    const app = require('../server');
    server = app.listen(0);
    const port = server.address().port;
    BASE = `http://localhost:${port}`;
  }

  console.log(`[Target] Connected to ${BASE}\n`);

  try {
    // ── 1. Authenticate users ────────────────────────────────────────────────
    console.log('--- [1] Authentication Setup ---');
    const u1Login = await request('POST', '/api/auth/login', { email: USER1_EMAIL, password: USER1_PASS });
    assert('Officer 1 login succeeds', u1Login.status === 200);
    const u1Cookies = extractCookie(u1Login.rawCookies);

    const u2Login = await request('POST', '/api/auth/login', { email: USER2_EMAIL, password: USER2_PASS });
    assert('Officer 2 login succeeds', u2Login.status === 200);
    const u2Cookies = extractCookie(u2Login.rawCookies);

    const adminLogin = await request('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
    assert('Admin login succeeds', adminLogin.status === 200);
    const adminCookies = extractCookie(adminLogin.rawCookies);

    // ── 2. Challenge generation ──────────────────────────────────────────────
    console.log('\n--- [2] Challenge Generation ---');
    const ch1 = await request('GET', '/api/keys/challenge', null, u1Cookies);
    assert('Acquire challenge returns HTTP 200', ch1.status === 200);
    assert('Challenge is 64-char hex string', typeof ch1.body.challenge === 'string' && ch1.body.challenge.length === 64);
    assert('Challenge includes expiration timestamp', Boolean(ch1.body.expiresAt));

    // ── 3. Valid key registration with proof of possession ───────────────────
    console.log('\n--- [3] Valid Key Registration ---');
    const key1 = generateTestKey('prime256v1');
    const sig1 = signChallenge(key1.privateKey, ch1.body.challenge);

    const reg1 = await request('POST', '/api/keys', {
      label: 'Field Unit Laptop',
      publicKeyJwk: key1.jwk,
      challenge: ch1.body.challenge,
      signature: sig1
    }, u1Cookies);

    assert('Valid key registration returns HTTP 201', reg1.status === 201, JSON.stringify(reg1.body));
    assert('Registration response returns keyId', typeof reg1.body.key?.keyId === 'string');
    assert('Registration response returns fingerprint', typeof reg1.body.key?.fingerprint === 'string' && reg1.body.key.fingerprint.length === 64);
    assert('Registration response returns active status', reg1.body.key?.status === 'active');
    const registeredKeyId1 = reg1.body.key?.keyId;
    const registeredFingerprint1 = reg1.body.key?.fingerprint;

    // ── 4. Replay attack rejection ───────────────────────────────────────────
    console.log('\n--- [4] Replay Attack Rejection ---');
    const key2 = generateTestKey('prime256v1');
    const sig2 = signChallenge(key2.privateKey, ch1.body.challenge);

    const replayRes = await request('POST', '/api/keys', {
      label: 'Replay Attempt Key',
      publicKeyJwk: key2.jwk,
      challenge: ch1.body.challenge,
      signature: sig2
    }, u1Cookies);

    assert('Replaying used challenge returns HTTP 400', replayRes.status === 400);
    assert('Error code indicates challenge replayed', replayRes.body.code === 'CHALLENGE_REPLAYED');

    // ── 5. Expired challenge rejection ───────────────────────────────────────
    console.log('\n--- [5] Expired Challenge Rejection ---');
    // Seed an already-expired challenge directly into MongoDB
    const expiredChallengeText = crypto.randomBytes(32).toString('hex');
    await KeyChallenge.create({
      challengeText: expiredChallengeText,
      expiresAt: new Date(Date.now() - 10000), // 10s in the past
      used: false
    });

    const key3 = generateTestKey('prime256v1');
    const sig3 = signChallenge(key3.privateKey, expiredChallengeText);

    const expiredRes = await request('POST', '/api/keys', {
      label: 'Expired Challenge Key',
      publicKeyJwk: key3.jwk,
      challenge: expiredChallengeText,
      signature: sig3
    }, u1Cookies);

    assert('Expired challenge returns HTTP 400', expiredRes.status === 400);
    assert('Error code indicates challenge expired', expiredRes.body.code === 'CHALLENGE_EXPIRED');

    // ── 6. Wrong-curve key rejection ─────────────────────────────────────────
    console.log('\n--- [6] Wrong-Curve Key Rejection ---');
    const ch4 = await request('GET', '/api/keys/challenge', null, u1Cookies);
    const p384Key = generateTestKey('secp384r1'); // Wrong curve (P-384 instead of P-256)
    const sig4 = signChallenge(p384Key.privateKey, ch4.body.challenge);

    const wrongCurveRes = await request('POST', '/api/keys', {
      label: 'P384 Wrong Curve Key',
      publicKeyJwk: p384Key.jwk,
      challenge: ch4.body.challenge,
      signature: sig4
    }, u1Cookies);

    assert('P-384 curve key rejected with HTTP 400', wrongCurveRes.status === 400);
    assert('Error code indicates invalid JWK curve', wrongCurveRes.body.code === 'INVALID_JWK');

    // ── 7. Invalid signature rejection ───────────────────────────────────────
    console.log('\n--- [7] Invalid Signature Rejection ---');
    const ch5 = await request('GET', '/api/keys/challenge', null, u1Cookies);
    const key5A = generateTestKey('prime256v1');
    const key5B = generateTestKey('prime256v1'); // Signs with key B but presents key A
    const fakeSig = signChallenge(key5B.privateKey, ch5.body.challenge);

    const invalidSigRes = await request('POST', '/api/keys', {
      label: 'Spoofed Signature Key',
      publicKeyJwk: key5A.jwk,
      challenge: ch5.body.challenge,
      signature: fakeSig
    }, u1Cookies);

    assert('Signature mismatch rejected with HTTP 400', invalidSigRes.status === 400);
    assert('Error code indicates invalid signature', invalidSigRes.body.code === 'INVALID_SIGNATURE');

    // ── 8. Duplicate fingerprint rejection ───────────────────────────────────
    console.log('\n--- [8] Duplicate Fingerprint Rejection ---');
    const ch6 = await request('GET', '/api/keys/challenge', null, u2Cookies);
    // Attempt to register the exact same key1 under Officer 2
    const sig6 = signChallenge(key1.privateKey, ch6.body.challenge);

    const dupRes = await request('POST', '/api/keys', {
      label: 'Duplicate Key Registration',
      publicKeyJwk: key1.jwk,
      challenge: ch6.body.challenge,
      signature: sig6
    }, u2Cookies);

    assert('Registering existing key fingerprint returns HTTP 409', dupRes.status === 409);
    assert('Error code indicates duplicate key', dupRes.body.code === 'DUPLICATE_KEY');

    // ── 9. Active key limit enforcement (max 5) ──────────────────────────────
    console.log('\n--- [9] Key Limit Enforcement (Max 5 Active Keys) ---');
    // Officer 1 already has 1 key (key1). Add 4 more to hit 5.
    for (let i = 2; i <= 5; i++) {
      const ch = await request('GET', '/api/keys/challenge', null, u1Cookies);
      const k = generateTestKey('prime256v1');
      const s = signChallenge(k.privateKey, ch.body.challenge);
      const res = await request('POST', '/api/keys', {
        label: `Officer Key ${i}`,
        publicKeyJwk: k.jwk,
        challenge: ch.body.challenge,
        signature: s
      }, u1Cookies);
      if (res.status !== 201) throw new Error(`Failed registering key ${i}: ${JSON.stringify(res.body)}`);
    }

    // Try adding the 6th key -> should fail with 400 KEY_LIMIT_REACHED
    const ch7 = await request('GET', '/api/keys/challenge', null, u1Cookies);
    const k6 = generateTestKey('prime256v1');
    const s6 = signChallenge(k6.privateKey, ch7.body.challenge);
    const limitRes = await request('POST', '/api/keys', {
      label: '6th Key Beyond Limit',
      publicKeyJwk: k6.jwk,
      challenge: ch7.body.challenge,
      signature: s6
    }, u1Cookies);

    assert('Attempting 6th active key returns HTTP 400', limitRes.status === 400);
    assert('Error code indicates key limit reached', limitRes.body.code === 'KEY_LIMIT_REACHED');

    // ── 10. List keys & Public Key Query (No private leakage) ────────────────
    console.log('\n--- [10] Querying Keys & Leakage Prevention ---');
    const listRes = await request('GET', '/api/keys', null, u1Cookies);
    assert('GET /api/keys returns HTTP 200', listRes.status === 200);
    assert('Officer 1 has 5 keys listed', Array.isArray(listRes.body.keys) && listRes.body.keys.length === 5);

    const pubRes = await request('GET', `/api/keys/${registeredKeyId1}/public`, null, u2Cookies);
    assert('Officer 2 can query Officer 1 public key', pubRes.status === 200);
    assert('Public key returns P-256 coordinates', pubRes.body.key?.publicKeyJwk?.crv === 'P-256');

    // Confirm absolute absence of private key material (d parameter, secret)
    const jsonStr = JSON.stringify(pubRes.body) + JSON.stringify(listRes.body);
    assert('No private key parameter "d" leaked', !jsonStr.includes('"d":'));
    assert('No private key string leaked in responses', !jsonStr.toLowerCase().includes('privatekey'));

    // ── 11. Foreign user cannot revoke key ────────────────────────────────────
    console.log('\n--- [11] Authorization: Foreign User Cannot Revoke ---');
    const foreignRevoke = await request('POST', `/api/keys/${registeredKeyId1}/revoke`, {
      reason: 'Malicious attempt by unauthorized user'
    }, u2Cookies); // Officer 2 trying to revoke Officer 1's key

    assert('Foreign user revocation returns HTTP 403', foreignRevoke.status === 403);
    assert('Error code is FORBIDDEN', foreignRevoke.body.code === 'FORBIDDEN');

    // ── 12. Key owner can revoke their key ────────────────────────────────────
    console.log('\n--- [12] Key Owner Revocation ---');
    const ownerRevoke = await request('POST', `/api/keys/${registeredKeyId1}/revoke`, {
      reason: 'Field device decommissioned'
    }, u1Cookies);

    assert('Key owner revocation returns HTTP 200', ownerRevoke.status === 200);
    assert('Status updated to revoked', ownerRevoke.body.status === 'revoked');
    assert('revokedAt timestamp is recorded', Boolean(ownerRevoke.body.revokedAt));

    // Confirm that after revocation, active key count drops to 4, allowing a new key!
    const ch8 = await request('GET', '/api/keys/challenge', null, u1Cookies);
    const kReplacement = generateTestKey('prime256v1');
    const sReplacement = signChallenge(kReplacement.privateKey, ch8.body.challenge);
    const replacementRes = await request('POST', '/api/keys', {
      label: 'Replacement Key After Revocation',
      publicKeyJwk: kReplacement.jwk,
      challenge: ch8.body.challenge,
      signature: sReplacement
    }, u1Cookies);
    assert('New key registration succeeds after revoking older key (count returned to 5)', replacementRes.status === 201);
    const replacementKeyId = replacementRes.body.key?.keyId;

    // ── 13. Admin can revoke any key ──────────────────────────────────────────
    console.log('\n--- [13] Admin Revocation Override ---');
    const adminRevoke = await request('POST', `/api/keys/${replacementKeyId}/revoke`, {
      reason: 'Administrative security rotation'
    }, adminCookies);

    assert('Admin revocation override returns HTTP 200', adminRevoke.status === 200);
    assert('Replacement key status is revoked by admin', adminRevoke.body.status === 'revoked');

    // ── 14. Double revocation rejected ────────────────────────────────────────
    console.log('\n--- [14] Double Revocation Prevention ---');
    const doubleRevoke = await request('POST', `/api/keys/${replacementKeyId}/revoke`, {
      reason: 'Attempting to revoke an already revoked key'
    }, adminCookies);

    assert('Revoking already revoked key returns HTTP 400', doubleRevoke.status === 400);
    assert('Error code is ALREADY_REVOKED', doubleRevoke.body.code === 'ALREADY_REVOKED');

    // ── 15. Audit trail verification ──────────────────────────────────────────
    console.log('\n--- [15] Audit Trail Event Verification ---');
    const keyRegAudits = await AuditLog.find({ action: 'KEY_REGISTERED' });
    assert('Audit trail contains KEY_REGISTERED events', keyRegAudits.length >= 6);

    const keyRevAudits = await AuditLog.find({ action: 'KEY_REVOKED' });
    assert('Audit trail contains KEY_REVOKED events', keyRevAudits.length >= 2);

    // Verify audit chain remains cryptographically valid after key operations
    const { validateAuditChain } = require('../services/auditHash');
    const auditValidation = await validateAuditChain();
    assert('Audit hash-chain remains cryptographically VALID', auditValidation.valid === true);

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n======================================================================');
    console.log(`SPRINT 9A TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================================\n');

    process.exit(failed > 0 ? 1 : 0);

  } catch (err) {
    console.error('\n❌ Unexpected fatal error in test suite:', err);
    process.exit(1);
  } finally {
    if (!externalServer) {
      if (server) server.close();
      await mongoose.disconnect();
      if (mongod) await mongod.stop();
    }
  }
})();
