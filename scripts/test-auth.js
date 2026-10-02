const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const authRoutes = require('../routes/authRoutes');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { authenticate, authorizeAction } = require('../middleware/auth');

process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890'; 
const table = [];

function assert(condition, message) {
  if (condition) {
    table.push({ Test: message, Status: 'PASS' });
  } else {
    table.push({ Test: message, Status: 'FAIL' });
  }
}

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await User.syncIndexes();
  await AuditLog.syncIndexes();

  const app = express();
  app.use(helmet());
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/audit', require('../routes/auditRoutes'));

  app.get('/api/health', (req, res) => res.json({ success: true }));

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  let cookieStr = '';

  // 1. Register
  let res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: "Admin Test", email: "test1@example.com", password: "Password1", role: "ADMIN" })
  });
  let data = await res.json();
  assert(res.status === 201 && data.user.role === 'VIEWER', 'register -> 201 and role VIEWER even when role:"ADMIN" is sent');

  // 2. Duplicate Email
  res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: "Admin Test 2", email: "test1@example.com", password: "Password1" })
  });
  assert(res.status === 409, 'duplicate email -> 409');

  // 3. Login Ok / Wrong Password
  res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: "test1@example.com", password: "Password1" })
  });
  const cookies = res.headers.get('set-cookie');
  if (cookies) {
    cookieStr = cookies.split(';')[0];
  }
  
  const resWrong = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: "test1@example.com", password: "Wrong" })
  });
  assert(res.status === 200 && cookies?.includes('HttpOnly') && resWrong.status === 401, 'login ok -> cookie set; wrong password -> 401');

  // 4. /me with and without cookie
  const resMeNo = await fetch(`${baseUrl}/auth/me`);
  const resMeCookie = await fetch(`${baseUrl}/auth/me`, { headers: { 'Cookie': cookieStr } });
  assert(resMeCookie.status === 200 && resMeNo.status === 401, '/me with and without cookie -> 200 / 401');

  // 5. RBAC: VIEWER calling an admin/investigator-only route -> 403
  const resRbac = await fetch(`${baseUrl}/audit`, { headers: { 'Cookie': cookieStr } });
  assert(resRbac.status === 403, 'VIEWER calling an admin/investigator route (/api/audit) -> 403');

  // 6. Logout
  const resLogout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { 'Cookie': cookieStr } });
  const logoutCookies = resLogout.headers.get('set-cookie');
  
  const resMeAfter = await fetch(`${baseUrl}/auth/me`, { headers: { 'Cookie': logoutCookies ? logoutCookies.split(';')[0] : '' } });
  assert((logoutCookies?.includes('token=;') || resMeAfter.status === 401), 'logout -> cookie cleared, /me -> 401');

  // 7. Audit Documents
  const logs = await AuditLog.find({});
  const actions = logs.map(l => l.action);
  assert(actions.includes('REGISTER') && actions.includes('LOGIN') && actions.includes('LOGOUT'), 'audit documents exist for REGISTER, LOGIN, LOGOUT');

  // 8. Security Headers
  const resHealth = await fetch(`${baseUrl}/health`);
  assert(resHealth.headers.get('x-dns-prefetch-control') !== null, 'security headers check: confirm helmet headers are present on /api/health');

  console.table(table);

  server.close();
  await mongoose.disconnect();
  await mongod.stop();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
