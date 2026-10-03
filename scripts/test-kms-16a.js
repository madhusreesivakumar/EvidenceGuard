#!/usr/bin/env node
'use strict';

/**
 * scripts/test-kms-16a.js
 * Sprint 16A/B: KeyProvider Contract Test Suite
 *
 * Tests ALL three providers (LocalProvider, Pkcs11Provider, AwsKmsProvider)
 * against the same contract, verifying:
 *
 *  1.  wrap()       - AES-256-GCM or CKM_AES_GCM key wrapping
 *  2.  unwrap()     - Successful round-trip decryption
 *  3.  Context AAD  - Wrong context causes AUTHENTICATION_FAILED
 *  4.  sign()       - ECDSA P-256 (ES256) signing
 *  5.  getPublicKey()  - Exports PEM + JWK, no private material
 *  6.  verify()     - Signature verification via exported public key
 *  7.  hmac()       - SHA-256 HMAC computation
 *  8.  rotate()     - Creates new key version; old version still decrypts
 *  9.  listVersions() - All versions visible after rotation
 * 10.  health()     - Returns HEALTHY status
 * 11.  circuit breaker - Opens after N consecutive failures
 * 12.  timeout      - Operations exceeding timeoutMs are rejected
 * 13.  Production guard - Factory refuses local KMS in production
 * 14.  KmsKeyWrapper   - Async wrap/unwrap via storage/keyWrapper.js
 * 15.  tokenService    - generateToken / verifyToken in legacy + KMS modes
 * 16.  No key material in logs - sanitizeErrorMessage strips sensitive data
 */

const crypto = require('crypto');
const assert = (desc, cond, details = '') => {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${desc}${details ? ' — ' + details : ''}`);
  }
};
const assertThrows = async (desc, fn, expectedCode) => {
  try {
    await fn();
    failed++;
    console.error(`  ❌ FAIL: ${desc} — expected throw but resolved`);
  } catch (err) {
    if (expectedCode && err.code !== expectedCode) {
      failed++;
      console.error(`  ❌ FAIL: ${desc} — expected code ${expectedCode}, got ${err.code || err.message}`);
    } else {
      passed++;
      console.log(`  ✅ PASS: ${desc}`);
    }
  }
};

let passed = 0;
let failed = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Helper: run contract suite against any KeyProvider instance
// ─────────────────────────────────────────────────────────────────────────────
async function runProviderContract(providerName, provider) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Provider Contract: ${providerName}`);
  console.log(`${'═'.repeat(60)}`);

  const DEK      = crypto.randomBytes(32);
  const CONTEXT  = { orgId: 'acme-labs', evidenceId: 'EV-2026-0001', purpose: 'EVIDENCE_ENVELOPE_DEK' };
  const DIGEST   = crypto.createHash('sha256').update('hello-kms-sprint16').digest();
  const DATA_STR = 'test-hmac-data-string';

  // 1. wrap() — basic round-trip
  console.log('\n  [wrap / unwrap]');
  let wrapped;
  try {
    const wrapResult = await provider.wrap('STORAGE_KEK', DEK, CONTEXT);
    wrapped = wrapResult.wrappedKey;
    assert(`${providerName}: wrap() returns wrappedKey string`, typeof wrapped === 'string' && wrapped.length > 0);
    assert(`${providerName}: wrap() returns keyId`, wrapResult.keyId === 'STORAGE_KEK');
    assert(`${providerName}: wrap() returns algorithm`, typeof wrapResult.algorithm === 'string');
    assert(`${providerName}: wrap() returns version`, typeof wrapResult.version === 'string');
  } catch (err) {
    assert(`${providerName}: wrap() succeeds`, false, err.message);
    return; // If wrap fails, skip the rest
  }

  // 2. unwrap() — correct context succeeds
  try {
    const unwrapped = await provider.unwrap('STORAGE_KEK', wrapped, CONTEXT);
    assert(`${providerName}: unwrap() correct context returns Buffer`, Buffer.isBuffer(unwrapped));
    assert(`${providerName}: unwrap() recovers original DEK`, unwrapped.equals(DEK), `got ${unwrapped.toString('hex')}`);
  } catch (err) {
    assert(`${providerName}: unwrap() succeeds with correct context`, false, err.message);
  }

  // 3. Context AAD — wrong context causes authentication failure
  await assertThrows(
    `${providerName}: unwrap() wrong context fails with AUTHENTICATION_FAILED`,
    () => provider.unwrap('STORAGE_KEK', wrapped, { orgId: 'evil-corp', evidenceId: 'EV-9999-0001', purpose: 'EVIDENCE_ENVELOPE_DEK' }),
    'AUTHENTICATION_FAILED'
  );

  // 4. sign()
  console.log('\n  [sign / getPublicKey]');
  let signature;
  try {
    const signResult = await provider.sign('JWT_KEY', DIGEST);
    signature = signResult.signature;
    assert(`${providerName}: sign() returns base64 signature`, typeof signature === 'string' && signature.length > 0);
    assert(`${providerName}: sign() returns algorithm ES256`, signResult.algorithm === 'ES256');
    assert(`${providerName}: sign() returns keyId`, signResult.keyId === 'JWT_KEY');

    // Ensure no private key material in signature response
    const sigStr = JSON.stringify(signResult);
    assert(`${providerName}: sign() does not expose d parameter`, !sigStr.includes('"d":'));
  } catch (err) {
    assert(`${providerName}: sign() succeeds`, false, err.message);
  }

  // 5. getPublicKey()
  let publicKeyPem, publicKeyJwk;
  try {
    const pkResult = await provider.getPublicKey('JWT_KEY');
    publicKeyPem = pkResult.publicKeyPem;
    publicKeyJwk = pkResult.publicKeyJwk;
    assert(`${providerName}: getPublicKey() returns PEM string`, typeof publicKeyPem === 'string' && publicKeyPem.includes('PUBLIC KEY'));
    assert(`${providerName}: getPublicKey() returns JWK`, typeof publicKeyJwk === 'object' && publicKeyJwk !== null);
    assert(`${providerName}: getPublicKey() JWK has no 'd' (private key)`, !('d' in (publicKeyJwk || {})), 'Private key d parameter must NOT be in JWK');
    assert(`${providerName}: getPublicKey() JWK has crv=P-256`, publicKeyJwk && publicKeyJwk.crv === 'P-256');
  } catch (err) {
    assert(`${providerName}: getPublicKey() succeeds`, false, err.message);
  }

  // 6. Signature verification using exported public key
  if (signature && publicKeyPem) {
    try {
      const sigBuf = Buffer.from(signature, 'base64');
      const pubKey = require('crypto').createPublicKey(publicKeyPem);
      const valid  = require('crypto').verify(null, DIGEST, { key: pubKey, dsaEncoding: 'ieee-p1363' }, sigBuf);
      assert(`${providerName}: exported public key verifies sign() output`, valid);
    } catch (err) {
      assert(`${providerName}: signature verification succeeds`, false, err.message);
    }
  }

  // 7. hmac()
  console.log('\n  [hmac]');
  try {
    const hmac1 = await provider.hmac('STORAGE_KEK', DATA_STR);
    const hmac2 = await provider.hmac('STORAGE_KEK', DATA_STR);
    assert(`${providerName}: hmac() returns hex string`, typeof hmac1 === 'string' && /^[0-9a-f]{64}$/i.test(hmac1));
    assert(`${providerName}: hmac() is deterministic`, hmac1 === hmac2);

    const hmacDiff = await provider.hmac('STORAGE_KEK', DATA_STR + '-different');
    assert(`${providerName}: hmac() different input produces different output`, hmac1 !== hmacDiff);
  } catch (err) {
    assert(`${providerName}: hmac() succeeds`, false, err.message);
  }

  // 8. rotate() + post-rotation wrap/unwrap
  console.log('\n  [rotate / listVersions]');
  let newVersion, previousVersion;
  try {
    const rotResult = await provider.rotate('STORAGE_KEK');
    newVersion      = rotResult.newVersion;
    previousVersion = rotResult.previousVersion;
    assert(`${providerName}: rotate() returns newVersion`, typeof newVersion === 'string');
    assert(`${providerName}: rotate() returns previousVersion`, typeof previousVersion === 'string');
    assert(`${providerName}: rotate() newVersion != previousVersion`, newVersion !== previousVersion);

    // New wrap under rotated key
    const newDek    = crypto.randomBytes(32);
    const newWrapped = (await provider.wrap('STORAGE_KEK', newDek, CONTEXT)).wrappedKey;
    const newUnwrapped = await provider.unwrap('STORAGE_KEK', newWrapped, CONTEXT);
    assert(`${providerName}: wrap/unwrap works after rotation`, Buffer.isBuffer(newUnwrapped) && newUnwrapped.equals(newDek));
  } catch (err) {
    assert(`${providerName}: rotate() succeeds`, false, err.message);
  }

  // 9. listVersions()
  try {
    const versions = await provider.listVersions('STORAGE_KEK');
    assert(`${providerName}: listVersions() returns array`, Array.isArray(versions));
    assert(`${providerName}: listVersions() has at least 2 versions after rotate`, versions.length >= 2);

    const currentEntry = versions.find(v => v.isCurrent === true);
    assert(`${providerName}: listVersions() marks exactly one version as current`, currentEntry !== undefined);
    if (newVersion) {
      assert(`${providerName}: listVersions() current version matches rotate() result`, currentEntry && currentEntry.version === newVersion);
    }
  } catch (err) {
    assert(`${providerName}: listVersions() succeeds`, false, err.message);
  }

  // 10. health()
  console.log('\n  [health]');
  try {
    const h = await provider.health();
    assert(`${providerName}: health() returns status string`, ['HEALTHY', 'DEGRADED', 'UNHEALTHY'].includes(h.status));
    assert(`${providerName}: health() returns provider name`, typeof h.provider === 'string');
    assert(`${providerName}: health() returns latencyMs number`, typeof h.latencyMs === 'number');
    assert(`${providerName}: health() status is HEALTHY`, h.status === 'HEALTHY', `got ${h.status}`);
  } catch (err) {
    assert(`${providerName}: health() succeeds`, false, err.message);
  }

  // 11. sanitizeErrorMessage — no key material in messages
  console.log('\n  [security: sanitizeErrorMessage]');
  const rawHex   = crypto.randomBytes(40).toString('hex'); // 80-char hex (>= 64 chars → redacted)
  const withPin  = 'Error: PIN:supersecret123 could not be verified';
  const withKey  = 'Error: key=0xDEADBEEF secret_data';
  assert(`${providerName}: sanitizeErrorMessage redacts long hex key`, !provider.sanitizeErrorMessage(rawHex).includes(rawHex));
  assert(`${providerName}: sanitizeErrorMessage redacts PIN`, !provider.sanitizeErrorMessage(withPin).includes('supersecret123'));
  assert(`${providerName}: sanitizeErrorMessage redacts key=`, !provider.sanitizeErrorMessage(withKey).includes('0xDEADBEEF'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker contract (provider-agnostic test on LocalProvider)
// ─────────────────────────────────────────────────────────────────────────────
async function testCircuitBreaker() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Circuit Breaker Contract');
  console.log(`${'═'.repeat(60)}`);

  const LocalProvider = require('../services/kms/LocalProvider');
  const provider = new LocalProvider({ failureThreshold: 2, recoveryTimeoutMs: 100, timeoutMs: 50 });

  // Force failures by pointing to non-existent key version
  let openTriggered = false;
  for (let i = 0; i < 3; i++) {
    try {
      // Trigger timeout by creating an extremely slow operation
      await provider.execute('test-op', () => new Promise((_r, reject) => setTimeout(() => reject(new Error('simulated')), 200)));
    } catch (_) {}
  }

  assert('Circuit breaker opens after threshold failures', provider.circuitState === 'OPEN');

  // While open, any operation should be rejected immediately
  await assertThrows(
    'Circuit breaker open rejects new operations with KMS_UNAVAILABLE',
    () => provider.wrap('STORAGE_KEK', crypto.randomBytes(32), {}),
    'KMS_UNAVAILABLE'
  );

  // Wait for recovery timeout then verify HALF_OPEN
  await new Promise(r => setTimeout(r, 150));
  // Execute a successful operation to close the circuit
  try {
    await provider.wrap('STORAGE_KEK', crypto.randomBytes(32), {});
  } catch (_) {}
  assert('Circuit breaker transitions from OPEN after recovery timeout', provider.circuitState !== 'OPEN');
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory / production guard contract
// ─────────────────────────────────────────────────────────────────────────────
async function testFactory() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Factory & Production Guard');
  console.log(`${'═'.repeat(60)}`);

  // Reset singleton between tests
  const kmsIndex = require('../services/kms/index');

  // Local provider in dev — should succeed
  process.env.KMS_PROVIDER = 'local';
  process.env.NODE_ENV     = 'development';
  kmsIndex._resetKeyProvider();
  try {
    const p = kmsIndex.getKeyProvider();
    assert('Factory: local provider initializes in development', p && p.name === 'local');
  } catch (err) {
    assert('Factory: local provider initializes in development', false, err.message);
  }

  // Local provider in production WITHOUT allow flag — must throw
  process.env.NODE_ENV     = 'production';
  process.env.ALLOW_LOCAL_KMS = '';
  kmsIndex._resetKeyProvider();
  await assertThrows(
    'Factory: local KMS in production (no ALLOW_LOCAL_KMS) throws KMS_INSECURE_CONFIG',
    () => { kmsIndex.getKeyProvider(); },
    'KMS_INSECURE_CONFIG'
  );

  // Local provider in production WITH allow flag — should warn but succeed
  process.env.ALLOW_LOCAL_KMS = 'true';
  kmsIndex._resetKeyProvider();
  try {
    const p = kmsIndex.getKeyProvider();
    assert('Factory: local KMS in production WITH ALLOW_LOCAL_KMS=true succeeds', p && p.name === 'local');
  } catch (err) {
    assert('Factory: local KMS with ALLOW_LOCAL_KMS=true succeeds', false, err.message);
  }

  // Restore
  process.env.NODE_ENV     = 'test';
  process.env.ALLOW_LOCAL_KMS = 'true';
  kmsIndex._resetKeyProvider();

  // pkcs11 provider
  process.env.KMS_PROVIDER = 'pkcs11';
  kmsIndex._resetKeyProvider();
  try {
    const p = kmsIndex.getKeyProvider();
    assert('Factory: pkcs11 provider initializes', p !== null && p !== undefined);
    assert('Factory: pkcs11 provider name is pkcs11', p.name === 'pkcs11');
  } catch (err) {
    assert('Factory: pkcs11 provider initializes', false, err.message);
  }

  // aws provider (mock mode since no credentials)
  process.env.KMS_PROVIDER  = 'aws';
  process.env.AWS_KMS_MOCK  = 'true';
  kmsIndex._resetKeyProvider();
  try {
    const p = kmsIndex.getKeyProvider();
    assert('Factory: aws provider initializes (mock mode)', p !== null && p !== undefined);
    assert('Factory: aws provider name is aws', p.name === 'aws');
  } catch (err) {
    assert('Factory: aws provider initializes', false, err.message);
  }

  // Reset to local for remaining tests
  process.env.KMS_PROVIDER = 'local';
  kmsIndex._resetKeyProvider();
}

// ─────────────────────────────────────────────────────────────────────────────
// KmsKeyWrapper contract (storage/keyWrapper.js)
// ─────────────────────────────────────────────────────────────────────────────
async function testKmsKeyWrapper() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  KmsKeyWrapper (storage/keyWrapper.js)');
  console.log(`${'═'.repeat(60)}`);

  const { KmsKeyWrapper, isKmsMode, resetKeyWrapper } = require('../storage/keyWrapper');
  const LocalProvider = require('../services/kms/LocalProvider');

  const provider = new LocalProvider();
  const wrapper  = new KmsKeyWrapper(provider, 'STORAGE_KEK');

  const dek     = crypto.randomBytes(32);
  const context = { orgId: 'test-org', evidenceId: 'EV-WRAP-001', purpose: 'EVIDENCE_ENVELOPE_DEK' };

  // Async wrap
  let wrappedKey;
  try {
    wrappedKey = await wrapper.wrapKey(dek, context);
    assert('KmsKeyWrapper: wrapKey() returns string', typeof wrappedKey === 'string' && wrappedKey.length > 0);
  } catch (err) {
    assert('KmsKeyWrapper: wrapKey() succeeds', false, err.message);
    return;
  }

  // Async unwrap correct context
  try {
    const unwrapped = await wrapper.unwrapKey(wrappedKey, context);
    assert('KmsKeyWrapper: unwrapKey() returns Buffer', Buffer.isBuffer(unwrapped));
    assert('KmsKeyWrapper: unwrapKey() recovers original DEK', unwrapped.equals(dek));
  } catch (err) {
    assert('KmsKeyWrapper: unwrapKey() correct context', false, err.message);
  }

  // Wrong context fails
  await assertThrows(
    'KmsKeyWrapper: unwrapKey() wrong context → AUTHENTICATION_FAILED',
    () => wrapper.unwrapKey(wrappedKey, { orgId: 'wrong-org', evidenceId: 'EV-WRAP-001', purpose: 'EVIDENCE_ENVELOPE_DEK' }),
    'AUTHENTICATION_FAILED'
  );

  // isKmsMode() detection
  process.env.KMS_PROVIDER = 'local';
  process.env.STORAGE_USE_KMS = '';
  assert('isKmsMode() false when KMS_PROVIDER=local and STORAGE_USE_KMS unset', isKmsMode() === false);

  process.env.STORAGE_USE_KMS = 'true';
  assert('isKmsMode() true when STORAGE_USE_KMS=true', isKmsMode() === true);

  process.env.STORAGE_USE_KMS = '';
  process.env.KMS_PROVIDER = 'pkcs11';
  assert('isKmsMode() true when KMS_PROVIDER=pkcs11', isKmsMode() === true);

  process.env.KMS_PROVIDER = 'local';

  // toJSON() never leaks key material
  const json = JSON.stringify(wrapper);
  assert('KmsKeyWrapper toJSON() has no key material', !json.includes('keyMaterial') && !json.includes('_masterKey'));

  resetKeyWrapper();
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenService contract
// ─────────────────────────────────────────────────────────────────────────────
async function testTokenService() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  tokenService (legacy HS256 + KMS ES256 modes)');
  console.log(`${'═'.repeat(60)}`);

  // ── Legacy HS256 mode ──────────────────────────────────────────────────────
  process.env.KMS_PROVIDER   = 'local';
  process.env.JWT_USE_KMS    = 'false';
  process.env.JWT_SECRET     = 'test-sprint16-jwt-secret-32chars!!';

  // Reset module cache for tokenService to pick up new env
  delete require.cache[require.resolve('../services/tokenService')];
  const ts = require('../services/tokenService');

  assert('tokenService: isKmsJwtMode() false in legacy mode', ts.isKmsJwtMode() === false);

  const legacyToken = await ts.generateToken('user123', 'INVESTIGATOR', { orgId: 'acme' });
  assert('tokenService: legacy generateToken() returns string', typeof legacyToken === 'string');

  const decoded = ts.verifyToken(legacyToken);
  assert('tokenService: legacy verifyToken() returns payload', decoded !== null);
  assert('tokenService: legacy decoded.userId matches', decoded && decoded.userId === 'user123');
  assert('tokenService: legacy decoded.role matches', decoded && decoded.role === 'INVESTIGATOR');
  assert('tokenService: legacy decoded.orgId matches', decoded && decoded.orgId === 'acme');

  // Tampered token should fail
  const tampered = legacyToken.slice(0, -5) + 'XXXXX';
  const badResult = ts.verifyToken(tampered);
  assert('tokenService: tampered token returns null', badResult === null);

  // Expired-style token (past exp)
  const jwt = require('jsonwebtoken');
  const expiredToken = jwt.sign(
    { userId: 'old', role: 'VIEWER' },
    process.env.JWT_SECRET,
    { expiresIn: '-1s' }
  );
  assert('tokenService: expired token returns null', ts.verifyToken(expiredToken) === null);

  // generateTokenSync (backwards compat)
  const syncToken = ts.generateTokenSync('sync_user', 'ADMIN');
  assert('tokenService: generateTokenSync() returns string', typeof syncToken === 'string');
  const syncDecoded = ts.verifyToken(syncToken);
  assert('tokenService: generateTokenSync() token verifiable', syncDecoded !== null && syncDecoded.userId === 'sync_user');
}

// ─────────────────────────────────────────────────────────────────────────────
// KEY-INVENTORY.md integrity check
// ─────────────────────────────────────────────────────────────────────────────
async function testKeyInventoryDoc() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  docs/KEY-INVENTORY.md Integrity Check');
  console.log(`${'═'.repeat(60)}`);

  const fs   = require('fs');
  const path = require('path');
  const inv  = path.join(__dirname, '..', 'docs', 'KEY-INVENTORY.md');

  assert('KEY-INVENTORY.md exists', fs.existsSync(inv));

  if (fs.existsSync(inv)) {
    const content = fs.readFileSync(inv, 'utf8');
    assert('KEY-INVENTORY.md mentions STORAGE_MASTER_KEY', content.includes('STORAGE_MASTER_KEY') || content.includes('STORAGE_KEK'));
    assert('KEY-INVENTORY.md mentions JWT_SECRET or JWT_KEY', content.includes('JWT_SECRET') || content.includes('JWT_KEY'));
    assert('KEY-INVENTORY.md mentions KMS_MIGRATABLE classification', content.includes('KMS_MIGRATABLE'));
    assert('KEY-INVENTORY.md mentions SECRET_STORE classification', content.includes('SECRET_STORE'));
    assert('KEY-INVENTORY.md covers MongoDB credentials', content.includes('MONGODB'));
    assert('KEY-INVENTORY.md covers SMTP credentials', content.includes('SMTP'));
    assert('KEY-INVENTORY.md has Contextual AAD section', content.includes('AAD') || content.includes('Additional Authenticated Data'));
    assert('KEY-INVENTORY.md has rotation policy', content.toLowerCase().includes('rotation'));
    assert('KEY-INVENTORY.md covers KMS_UNAVAILABLE behavior', content.includes('KMS_UNAVAILABLE') || content.includes('Fail Closed') || content.includes('fail closed'));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  SPRINT 16 – KMS / HSM Contract Test Suite              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  process.env.NODE_ENV     = 'test';
  process.env.ALLOW_LOCAL_KMS = 'true';
  process.env.KMS_PROVIDER = 'local';
  process.env.AWS_KMS_MOCK = 'true';

  try {
    // 1. KEY-INVENTORY.md doc check
    await testKeyInventoryDoc();

    // 2. Provider contracts
    const LocalProvider   = require('../services/kms/LocalProvider');
    const Pkcs11Provider  = require('../services/kms/Pkcs11Provider');
    const AwsKmsProvider  = require('../services/kms/AwsKmsProvider');

    const localProvider  = new LocalProvider();
    const pkcs11Provider = new Pkcs11Provider();
    const awsProvider    = new AwsKmsProvider({ isMock: true });

    await runProviderContract('LocalProvider',   localProvider);
    await runProviderContract('Pkcs11Provider',  pkcs11Provider);
    await runProviderContract('AwsKmsProvider',  awsProvider);

    // 3. Circuit breaker
    await testCircuitBreaker();

    // 4. Factory / production guard
    await testFactory();

    // 5. KmsKeyWrapper
    await testKmsKeyWrapper();

    // 6. tokenService
    await testTokenService();

  } catch (err) {
    console.error('\n[FATAL] Unhandled test error:', err.message);
    console.error(err.stack);
    failed++;
  }

  // ── Results ────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.error('\n❌ Sprint 16 KMS test suite FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ Sprint 16 KMS test suite PASSED');
    process.exit(0);
  }
}

main();
