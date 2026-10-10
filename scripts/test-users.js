#!/usr/bin/env node
'use strict';

/**
 * Sprint 7C - live integration test for User Management API
 * Can run against external server (via TEST_BASE_URL) or spins up an in-process
 * test server with MongoMemoryServer automatically.
 * Usage: node scripts/test-users.js
 */

const http  = require('http');
const https = require('https');
const dotenv = require('dotenv');

dotenv.config();

let BASE = process.env.TEST_BASE_URL || null;
const externalServer = Boolean(process.env.TEST_BASE_URL);

// --- HTTP helper --------------------------------------------------------------

function request(method, path, body, cookies) {
  return new Promise((resolve, reject) => {
    const url      = new URL(BASE + path);
    const isHttps  = url.protocol === 'https:';
    const lib      = isHttps ? https : http;
    const bodyStr  = body ? JSON.stringify(body) : null;
    const headers  = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    if (cookies) headers['Cookie'] = cookies;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const rawCookies = res.headers['set-cookie'] || [];
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, rawCookies });
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

// --- Test runner --------------------------------------------------------------

let passed = 0, failed = 0;
function assert(label, cond, extra) {
  if (cond) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}`, extra || '');
    failed++;
  }
}

// --- Main ---------------------------------------------------------------------

(async () => {
  const ADMIN_EMAIL    = process.env.TEST_ADMIN_EMAIL    || process.env.SEED_ADMIN_EMAIL    || 'admin@evidenceguard.local';
  const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || 'Admin1234!';

  // Credentials for a second non-admin user (used to test 403 behaviour)
  const INV_EMAIL    = process.env.TEST_INV_EMAIL    || 'inv_test_7c@evidenceguard.local';
  const INV_PASSWORD = process.env.TEST_INV_PASSWORD || 'Inv12345!';

  // A fresh user we will create during the test
  const NEW_EMAIL    = `newuser_${Date.now()}@test.local`;
  const NEW_PASSWORD = 'NewUser1!';

  console.log('\n=== Sprint 7C - User Management API Tests ===\n');

  let server;
  let mongod;
  let externalServer = false;

  try {
    const health = await request('GET', '/api/health');
    if (health.status === 200) externalServer = true;
  } catch (_) {}

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-users-suite-jwt-secret-key-32chars-min!';

  const mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const bcrypt = require('bcrypt');
  const User = require('../models/User');
  const Evidence = require('../models/Evidence');
  const Block = require('../models/Block');
  const AuditLog = require('../models/AuditLog');
  const { ensureGenesis } = require('../services/chainService');

  if (!externalServer) {
    console.log('[Setup] Starting in-memory test environment...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);

    await Promise.all([
      User.syncIndexes(),
      Evidence.syncIndexes(),
      Block.syncIndexes(),
      AuditLog.syncIndexes()
    ]);
    await ensureGenesis();

    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const invHash = await bcrypt.hash(INV_PASSWORD, 10);
    await User.create([
      { name: 'Admin Chief', email: ADMIN_EMAIL.toLowerCase(), passwordHash: adminHash, role: 'ADMIN', isActive: true },
      { name: 'Detective Miller', email: INV_EMAIL.toLowerCase(), passwordHash: invHash, role: 'INVESTIGATOR', isActive: true }
    ]);

    const app = require('../server');
    server = app.listen(0);
    const port = server.address().port;
    BASE = `http://localhost:${port}`;
  }

  // -- 1. Login as ADMIN ------------------------------------------------------
  console.log('[1] Admin login');
  const adminLogin = await request('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert('Admin login -> 200', adminLogin.status === 200, adminLogin.body);
  const adminCookies = extractCookie(adminLogin.rawCookies);

  // -- 2. List users (ADMIN) --------------------------------------------------
  console.log('\n[2] GET /api/users');
  const list = await request('GET', '/api/users', null, adminCookies);
  assert('List -> 200', list.status === 200, list.body);
  assert('List has users array', Array.isArray(list.body.users));
  assert('List has total', typeof list.body.total === 'number');
  if (list.body.users.length > 0) {
    assert('passwordHash not in response', !('passwordHash' in list.body.users[0]));
  }

  // -- 3. List with q search --------------------------------------------------
  console.log('\n[3] GET /api/users?q=admin');
  const listQ = await request('GET', '/api/users?q=admin', null, adminCookies);
  assert('List q -> 200', listQ.status === 200, listQ.body);

  // -- 4. List with role filter -----------------------------------------------
  console.log('\n[4] GET /api/users?role=ADMIN');
  const listRole = await request('GET', '/api/users?role=ADMIN', null, adminCookies);
  assert('List role -> 200', listRole.status === 200, listRole.body);

  // -- 5. List with invalid role -> 400 ---------------------------------------
  console.log('\n[5] GET /api/users?role=INVALID');
  const listBadRole = await request('GET', '/api/users?role=INVALID', null, adminCookies);
  assert('Bad role filter -> 400', listBadRole.status === 400, listBadRole.body);

  // -- 6. Create user (POST /api/users) ---------------------------------------
  console.log('\n[6] POST /api/users (create user)');
  const createRes = await request('POST', '/api/users', {
    name:     'Test Subject',
    email:    NEW_EMAIL,
    password: NEW_PASSWORD,
    role:     'VIEWER'
  }, adminCookies);
  assert('Create user -> 201', createRes.status === 201, createRes.body);
  assert('Response does not leak passwordHash', !('passwordHash' in (createRes.body.user || {})));
  const newUserId = createRes.body.user ? createRes.body.user._id || createRes.body.user.id : null;

  // -- 7. Create duplicate email -> 409 --------------------------------------
  console.log('\n[7] POST /api/users (duplicate email)');
  const dupRes = await request('POST', '/api/users', {
    name:     'Duplicate',
    email:    NEW_EMAIL,
    password: NEW_PASSWORD,
    role:     'VIEWER'
  }, adminCookies);
  assert('Duplicate email -> 409', dupRes.status === 409, dupRes.body);

  // -- 8. Change role to INVESTIGATOR ----------------------------------------
  console.log('\n[8] PATCH /api/users/:id/role -> INVESTIGATOR');
  if (newUserId) {
    const patchRole = await request('PATCH', `/api/users/${newUserId}/role`, { role: 'INVESTIGATOR' }, adminCookies);
    assert('Role change -> 200', patchRole.status === 200, patchRole.body);
    assert('Role updated to INVESTIGATOR', patchRole.body.user && patchRole.body.user.role === 'INVESTIGATOR');
  } else {
    assert('Role change -> 200 (skipped, no user ID)', false);
  }

  // -- 9. Change role with invalid role -> 400 --------------------------------
  console.log('\n[9] PATCH /api/users/:id/role with invalid role');
  if (newUserId) {
    const patchBad = await request('PATCH', `/api/users/${newUserId}/role`, { role: 'SUPERUSER' }, adminCookies);
    assert('Invalid role value -> 400', patchBad.status === 400, patchBad.body);
  }

  // -- 10. Self-demotion guard ------------------------------------------------
  console.log('\n[10] Self-demotion guard (admin cannot change their own role)');
  const adminMe = await request('GET', '/api/auth/me', null, adminCookies);
  const adminId = adminMe.body.user ? adminMe.body.user._id || adminMe.body.user.id : null;
  if (adminId) {
    const selfDemote = await request('PATCH', `/api/users/${adminId}/role`, { role: 'VIEWER' }, adminCookies);
    assert('Self-demotion -> 409', selfDemote.status === 409, selfDemote.body);
  }

  // -- 11. Deactivate user (DELETE /api/users/:id) ---------------------------
  console.log('\n[11] DELETE /api/users/:id (deactivate)');
  if (newUserId) {
    const deactRes = await request('DELETE', `/api/users/${newUserId}`, null, adminCookies);
    assert('Deactivate -> 200', deactRes.status === 200, deactRes.body);
    assert('isActive is false', deactRes.body.user && deactRes.body.user.isActive === false);
  }

  // -- 12. Self-deactivation guard -------------------------------------------
  console.log('\n[12] Self-deactivation guard (admin cannot deactivate themselves)');
  if (adminId) {
    const selfDeact = await request('DELETE', `/api/users/${adminId}`, null, adminCookies);
    assert('Self-deactivate -> 409', selfDeact.status === 409, selfDeact.body);
  }

  // -- 13. Login as deactivated user -> 401 -----------------------------------
  console.log('\n[13] Login as deactivated user -> 401');
  const deactLogin = await request('POST', '/api/auth/login', { email: NEW_EMAIL, password: NEW_PASSWORD });
  assert('Deactivated login -> 401', deactLogin.status === 401, deactLogin.body);

  // -- 14. INVESTIGATOR gets 403 on all user routes -------------------------
  console.log('\n[14] INVESTIGATOR permission check');
  const invLogin = await request('POST', '/api/auth/login', { email: INV_EMAIL, password: INV_PASSWORD });
  if (invLogin.status === 200) {
    const invCookies = extractCookie(invLogin.rawCookies);
    const invList = await request('GET', '/api/users', null, invCookies);
    assert('INVESTIGATOR list -> 403', invList.status === 403, invList.body);
  } else {
    console.log('  [SKIP] INVESTIGATOR user not found; skipping 403 checks');
  }

  // -- 15. Unauthenticated -> 401 ---------------------------------------------
  console.log('\n[15] Unauthenticated -> 401');
  const noAuth = await request('GET', '/api/users');
  assert('No auth -> 401', noAuth.status === 401, noAuth.body);

  // Clean up in-process server if we spawned one
  if (!externalServer) {
    if (server) server.close();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }

  // -- Summary ---------------------------------------------------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
