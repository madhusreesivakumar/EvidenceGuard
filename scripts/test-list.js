process.env.JWT_SECRET = 'supersecretlongkey12345678901234567890';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '1';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const Evidence = require('../models/Evidence');
const User = require('../models/User');
const Block = require('../models/Block');
const authRoutes = require('../routes/authRoutes');
const evidenceRoutes = require('../routes/evidenceRoutes');
const idService = require('../services/idService');

const table = [];
function assert(condition, message) {
  table.push({ Test: message, Status: condition ? 'PASS' : 'FAIL' });
  if (!condition) console.error(`FAILED: ${message}`);
}

async function runTests() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  
  await User.syncIndexes();
  await Evidence.syncIndexes();
  await Block.syncIndexes();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/evidence', evidenceRoutes);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  // Create Users
  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Admin", email: "admin@test.com", password: "Password1" }) });
  await User.updateOne({ email: "admin@test.com" }, { role: "ADMIN" });
  const adminCookie = (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "admin@test.com", password: "Password1" }) })).headers.get('set-cookie').split(';')[0];
  const adminUser = await User.findOne({ email: "admin@test.com" });

  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: "Viewer", email: "view@test.com", password: "Password1" }) });
  const viewCookie = (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: "view@test.com", password: "Password1" }) })).headers.get('set-cookie').split(';')[0];

  // Seed Evidence
  const d1 = new Date('2026-09-01T10:00:00Z');
  const d2 = new Date('2026-09-05T10:00:00Z');
  
  await Evidence.create([
    { evidenceId: 'EV-0001', caseId: 'EG-2026-0001', name: 'Weapon Image', type: 'Image', fileName: 'gun.jpg', hash: 'a'.repeat(64), status: 'Pending', uploadedBy: adminUser._id, createdAt: d1 },
    { evidenceId: 'EV-0002', caseId: 'EG-2026-0001', name: 'Suspect Video', type: 'Video', fileName: 'vid.mp4', hash: 'b'.repeat(64), status: 'Verified', uploadedBy: adminUser._id, createdAt: d2 },
    { evidenceId: 'EV-0003', caseId: 'EG-2026-0002', name: 'Deleted Doc', type: 'Document', fileName: 'del.pdf', hash: 'c'.repeat(64), status: 'Pending', uploadedBy: adminUser._id, isDeleted: true },
  ]);

  // Test 1: Search by evidenceId
  let res = await fetch(`${baseUrl}/evidence?q=EV-0002`, { headers: { 'Cookie': adminCookie } });
  let json = await res.json();
  assert(json.success && json.items.length === 1 && json.items[0].evidenceId === 'EV-0002', 'Search by evidenceId');
  assert(json.items[0].uploadedByName === 'Admin', 'uploadedBy populated with name');
  assert(!json.items[0].storageKey, 'storageKey is excluded');

  // Test 2: Search by caseId
  res = await fetch(`${baseUrl}/evidence?q=EG-2026-0001`, { headers: { 'Cookie': adminCookie } });
  json = await res.json();
  assert(json.success && json.items.length === 2, 'Search by caseId');

  // Test 3: Search by name (contains)
  res = await fetch(`${baseUrl}/evidence?q=Video`, { headers: { 'Cookie': adminCookie } });
  json = await res.json();
  assert(json.success && json.items.length === 1 && json.items[0].name === 'Suspect Video', 'Search by name');

  // Test 4: Search by fileName
  res = await fetch(`${baseUrl}/evidence?q=gun`, { headers: { 'Cookie': adminCookie } });
  json = await res.json();
  assert(json.success && json.items.length === 1 && json.items[0].fileName === 'gun.jpg', 'Search by fileName');

  // Test 5: Search by hash
  res = await fetch(`${baseUrl}/evidence?q=${'a'.repeat(64)}`, { headers: { 'Cookie': adminCookie } });
  json = await res.json();
  assert(json.success && json.items.length === 1 && json.items[0].hash === 'a'.repeat(64), 'Search by hash');

  // Test 6: Filters (type, status)
  res = await fetch(`${baseUrl}/evidence?type=Video&status=Verified`, { headers: { 'Cookie': adminCookie } });
  json = await res.json();
  assert(json.success && json.items.length === 1 && json.items[0].evidenceId === 'EV-0002', 'Filter by type and status');

  // Test 7: Date Range
  res = await fetch(`${baseUrl}/evidence?dateFrom=2026-09-02&dateTo=2026-09-10`, { headers: { 'Cookie': adminCookie } });
  json = await res.json();
  assert(json.success && json.items.length === 1 && json.items[0].evidenceId === 'EV-0002', 'Filter by date range');

  // Test 8: Sort (asc/desc)
  res = await fetch(`${baseUrl}/evidence?sortBy=createdAt&sortOrder=asc`, { headers: { 'Cookie': adminCookie } });
  let jsonAsc = await res.json();
  res = await fetch(`${baseUrl}/evidence?sortBy=createdAt&sortOrder=desc`, { headers: { 'Cookie': adminCookie } });
  let jsonDesc = await res.json();
  assert(jsonAsc.items[0].evidenceId === 'EV-0001' && jsonDesc.items[0].evidenceId === 'EV-0002', 'Sorting works (asc and desc)');

  // Test 9: Pagination
  res = await fetch(`${baseUrl}/evidence?limit=1&page=1`, { headers: { 'Cookie': adminCookie } });
  json = await res.json();
  assert(json.items.length === 1 && json.total === 2 && json.totalPages === 2, 'Pagination totals and clamping');

  // Test 10: Injection strings
  const inj1 = await fetch(`${baseUrl}/evidence?q={"$ne":null}`, { headers: { 'Cookie': adminCookie } });
  const inj2 = await fetch(`${baseUrl}/evidence?q=.*`, { headers: { 'Cookie': adminCookie } });
  const inj3 = await fetch(`${baseUrl}/evidence?q=(a+)+$`, { headers: { 'Cookie': adminCookie } });
  
  assert(inj1.status === 200 && (await inj1.json()).items.length === 0, 'Injection {"$ne":null} is safe');
  assert(inj2.status === 200 && (await inj2.json()).items.length === 0, 'Injection .* is safe (escaped)');
  assert(inj3.status === 200 && (await inj3.json()).items.length === 0, 'Injection (a+)+$ is safe (escaped)');

  // Test 11: Permissions
  const vRes = await fetch(`${baseUrl}/evidence`, { headers: { 'Cookie': viewCookie } });
  assert(vRes.status === 200, 'VIEWER can read');
  
  const uRes = await fetch(`${baseUrl}/evidence`);
  assert(uRes.status === 401, 'Logged out gets 401');
  
  // Test 12: Details API
  const dRes = await fetch(`${baseUrl}/evidence/EV-0001`, { headers: { 'Cookie': adminCookie } });
  const dJson = await dRes.json();
  assert(dJson.success && dJson.data.evidenceId === 'EV-0001', 'Get details by evidenceId works');
  assert(dJson.data.verificationSummary.totalVerifications === 0, 'Verification summary included');
  assert(!dJson.data.storageKey, 'Details API excludes storageKey');

  // Explain Query
  const explain = await Evidence.find({ type: 'Video', createdAt: { $gte: new Date('2026-09-01') } }).explain();
  console.log("\nEXPLAIN OUTPUT:");
  console.log(JSON.stringify(explain.queryPlanner.winningPlan, null, 2));
  let indexName = null;
  const findIndex = (plan) => {
    if (!plan) return;
    if (plan.indexName) indexName = plan.indexName;
    if (plan.inputStage) findIndex(plan.inputStage);
    if (plan.inputStages) plan.inputStages.forEach(findIndex);
  };
  findIndex(explain.queryPlanner.winningPlan);
  console.log("Index used:", indexName || "None");
  assert(indexName != null, 'Index is used for query');

  console.table(table);

  server.close();
  await mongoose.disconnect();
  await mongod.stop();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
