'use strict';
/**
 * scripts/test-rbac.js
 * Sprint 8A – RBAC tests via real routes (no dev routes).
 * Uses in-memory MongoDB via mongodb-memory-server.
 */

process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
process.env.STORAGE_DRIVER = 'local';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes  = require('../routes/authRoutes');
const auditRoutes = require('../routes/auditRoutes');
const userRoutes  = require('../routes/userRoutes');
const User = require('../models/User');
const { authenticate, authorizeAction } = require('../middleware/auth');
const { generateToken } = require('../services/tokenService');

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { console.log('  [PASS]', message); passed++; }
  else           { console.error('  [FAIL]', message); failed++; }
}

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await User.syncIndexes();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth',  authRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/users', userRoutes);
  app.get('/api/health', (req, res) => res.json({ success: true }));

  const rateLimit = require('express-rate-limit');
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://localhost:${port}/api`;

  // Create users directly
  const admin = await User.create({ name: 'Admin', email: 'admin@rbac.test', passwordHash: 'x', role: 'ADMIN', isActive: true });
  const inv   = await User.create({ name: 'Inv',   email: 'inv@rbac.test',   passwordHash: 'x', role: 'INVESTIGATOR', isActive: true });
  const viewer= await User.create({ name: 'Viewer',email: 'viewer@rbac.test',passwordHash: 'x', role: 'VIEWER', isActive: true });

  const adminCookie  = `token=${generateToken(admin._id,  admin.role)}`;
  const invCookie    = `token=${generateToken(inv._id,    inv.role)}`;
  const viewerCookie = `token=${generateToken(viewer._id, viewer.role)}`;

  console.log('\n--- [1] Unauthenticated access ---');
  const r1 = await fetch(`${base}/audit`);
  assert(r1.status === 401, 'No cookie → 401');

  console.log('\n--- [2] VIEWER on audit (requires viewAudit = INVESTIGATOR+) ---');
  const r2 = await fetch(`${base}/audit`, { headers: { Cookie: viewerCookie } });
  assert(r2.status === 403, 'VIEWER /api/audit → 403');

  console.log('\n--- [3] INVESTIGATOR on audit ---');
  const r3 = await fetch(`${base}/audit`, { headers: { Cookie: invCookie } });
  assert(r3.status === 200, 'INVESTIGATOR /api/audit → 200');

  console.log('\n--- [4] VIEWER on user management (requires manageUsers = ADMIN only) ---');
  const r4 = await fetch(`${base}/users`, { headers: { Cookie: viewerCookie } });
  assert(r4.status === 403, 'VIEWER /api/users → 403');

  console.log('\n--- [5] INVESTIGATOR on user management ---');
  const r5 = await fetch(`${base}/users`, { headers: { Cookie: invCookie } });
  assert(r5.status === 403, 'INVESTIGATOR /api/users → 403');

  console.log('\n--- [6] ADMIN on user management ---');
  const r6 = await fetch(`${base}/users`, { headers: { Cookie: adminCookie } });
  assert(r6.status === 200, 'ADMIN /api/users → 200');

  console.log('\n--- [7] ADMIN audit chain validate ---');
  const r7 = await fetch(`${base}/audit/validate`, { method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(r7.status === 200, 'ADMIN POST /api/audit/validate → 200');

  console.log('\n--- [8] INVESTIGATOR audit chain validate (validateAudit = ADMIN only) ---');
  const r8 = await fetch(`${base}/audit/validate`, { method: 'POST', headers: { Cookie: invCookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(r8.status === 403, 'INVESTIGATOR POST /api/audit/validate → 403');

  console.log('\n--- [9] VIEWER audit chain validate ---');
  const r9 = await fetch(`${base}/audit/validate`, { method: 'POST', headers: { Cookie: viewerCookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(r9.status === 403, 'VIEWER POST /api/audit/validate → 403');

  console.log('\n--- [10] Inactive user token rejected ---');
  const inactive = await User.create({ name: 'Dead', email: 'dead@rbac.test', passwordHash: 'x', role: 'ADMIN', isActive: false });
  const deadCookie = `token=${generateToken(inactive._id, inactive.role)}`;
  const r10 = await fetch(`${base}/audit`, { headers: { Cookie: deadCookie } });
  assert(r10.status === 401, 'Inactive user token → 401');

  server.close();
  await mongoose.connection.close();
  await mongod.stop();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error('[FATAL]', err); process.exit(1); });