'use strict';

process.env.JWT_SECRET = 'test-audit-api-jwt-secret-key-32chars!';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '5';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const authRoutes = require('../routes/authRoutes');
const auditRoutes = require('../routes/auditRoutes');
const { ensureGenesis } = require('../services/chainService');
const { generateToken } = require('../services/tokenService');
const { logEvent } = require('../services/auditService');

async function runTests() {
  console.log('--- Starting Sprint 7A Audit API Integration Tests ---');
  let mongod;
  let server;
  let baseUrl;

  try {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    console.log('Connected to In-Memory MongoDB');

    await ensureGenesis();

    const app = express();
    app.use(express.json());
    app.use(cookieParser());

    app.use('/api/auth', authRoutes);
    app.use('/api/audit', auditRoutes);

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
    console.log(`Test server running at ${baseUrl}`);

    // Create test users
    const pwdHash = await bcrypt.hash('password123', 10);
    const admin = await User.create({
      name: 'Admin Chief',
      email: 'admin@audit.test',
      passwordHash: pwdHash,
      role: 'ADMIN'
    });
    const adminToken = await generateToken(admin._id, admin.role);

    const investigator = await User.create({
      name: 'Detective Miller',
      email: 'investigator@audit.test',
      passwordHash: pwdHash,
      role: 'INVESTIGATOR'
    });
    const investigatorToken = await generateToken(investigator._id, investigator.role);

    const viewer = await User.create({
      name: 'Auditor Viewer',
      email: 'viewer@audit.test',
      passwordHash: pwdHash,
      role: 'VIEWER'
    });
    const viewerToken = await generateToken(viewer._id, viewer.role);

    // Populate multiple audit events across different actions, users, and cases
    console.log('Populating sample audit logs...');
    await logEvent({
      user: admin,
      action: 'LOGIN',
      description: 'Admin login from workstation 1',
      req: { ip: '10.0.0.1' }
    });
    await logEvent({
      user: investigator,
      action: 'UPLOAD',
      evidenceId: 'EV-0001',
      caseId: 'EG-2026-0001',
      description: 'Uploaded CCTV security recording',
      req: { ip: '10.0.0.2' }
    });
    await logEvent({
      user: investigator,
      action: 'VERIFY',
      evidenceId: 'EV-0001',
      caseId: 'EG-2026-0001',
      description: 'CCTV footage verified successfully',
      req: { ip: '10.0.0.2' }
    });
    await logEvent({
      user: investigator,
      action: 'TAMPER_DETECTED',
      evidenceId: 'EV-0002',
      caseId: 'EG-2026-0002',
      description: 'Hash mismatch detected on crime scene photo',
      req: { ip: '10.0.0.3' }
    });
    await logEvent({
      user: admin,
      action: 'DELETE',
      evidenceId: 'EV-0002',
      caseId: 'EG-2026-0002',
      description: 'Evidence deleted by court order request',
      req: { ip: '10.0.0.1' }
    });

    // 1. Unauthenticated request -> 401
    {
      const res = await fetch(`${baseUrl}/api/audit`);
      if (res.status !== 401) throw new Error(`Expected 401 for unauthenticated request, got ${res.status}`);
      console.log('PASS 1: Unauthenticated request rejected with 401');
    }

    // 2. VIEWER role request -> 403 Forbidden
    {
      const res = await fetch(`${baseUrl}/api/audit`, {
        headers: { Authorization: `Bearer ${viewerToken}` }
      });
      if (res.status !== 403) throw new Error(`Expected 403 for VIEWER role, got ${res.status}`);
      console.log('PASS 2: VIEWER role forbidden from viewing audit logs (403)');
    }

    // 3. INVESTIGATOR can view audit logs, but ipAddress MUST BE NULL
    {
      const res = await fetch(`${baseUrl}/api/audit`, {
        headers: { Authorization: `Bearer ${investigatorToken}` }
      });
      if (res.status !== 200) throw new Error(`Expected 200 for INVESTIGATOR, got ${res.status}`);
      const body = await res.json();
      if (!body.success || !Array.isArray(body.items)) throw new Error('Invalid response structure');
      
      const hasAnyIp = body.items.some(item => item.ipAddress !== null);
      if (hasAnyIp) throw new Error('INVESTIGATOR must receive ipAddress: null for all items!');
      
      const hasSecrets = body.items.some(item => item.userId !== undefined || item.prevHash !== undefined || item.entryHash !== undefined);
      if (hasSecrets) throw new Error('Audit list response leaked internal userId, prevHash, or entryHash!');
      console.log('PASS 3: INVESTIGATOR gets 200, ipAddress is strictly null, internal hashes/userId excluded');
    }

    // 4. ADMIN gets real ipAddress strings
    {
      const res = await fetch(`${baseUrl}/api/audit`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (res.status !== 200) throw new Error(`Expected 200 for ADMIN, got ${res.status}`);
      const body = await res.json();
      const nonNullIps = body.items.filter(item => item.ipAddress !== null && item.ipAddress !== 'unknown');
      if (nonNullIps.length === 0) throw new Error('ADMIN should see real IP addresses for logged events');
      console.log('PASS 4: ADMIN role successfully receives IP addresses');
    }

    // 5. Search filtering by text 'q'
    {
      const res = await fetch(`${baseUrl}/api/audit?q=CCTV`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      if (body.items.length !== 2) throw new Error(`Expected 2 items for q=CCTV, got ${body.items.length}`);
      console.log('PASS 5: Text search parameter q filters results correctly');
    }

    // 6. Action filter
    {
      const res = await fetch(`${baseUrl}/api/audit?action=TAMPER_DETECTED`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      if (body.items.length !== 1 || body.items[0].action !== 'TAMPER_DETECTED') {
        throw new Error('Action filter failed');
      }
      console.log('PASS 6: Action filter works accurately');
    }

    // 7. User filter (by name and ObjectId)
    {
      const res1 = await fetch(`${baseUrl}/api/audit?user=Detective Miller`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body1 = await res1.json();
      if (body1.items.length !== 3) throw new Error(`Expected 3 items for Detective Miller, got ${body1.items.length}`);

      const res2 = await fetch(`${baseUrl}/api/audit?user=${investigator._id}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body2 = await res2.json();
      if (body2.items.length !== 3) throw new Error(`Expected 3 items for investigator ObjectId, got ${body2.items.length}`);
      console.log('PASS 7: User filter works with both userName and ObjectId');
    }

    // 8. EvidenceId and CaseId filters
    {
      const res1 = await fetch(`${baseUrl}/api/audit?evidenceId=EV-0001`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body1 = await res1.json();
      if (body1.items.length !== 2) throw new Error(`Expected 2 items for EV-0001, got ${body1.items.length}`);

      const res2 = await fetch(`${baseUrl}/api/audit?caseId=EG-2026-0002`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body2 = await res2.json();
      if (body2.items.length !== 2) throw new Error(`Expected 2 items for EG-2026-0002, got ${body2.items.length}`);
      console.log('PASS 8: evidenceId and caseId filters work accurately');
    }

    // 9. Date range filtering and validation
    {
      const today = new Date().toISOString().split('T')[0];
      const res1 = await fetch(`${baseUrl}/api/audit?dateFrom=${today}&dateTo=${today}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body1 = await res1.json();
      if (body1.items.length < 5) throw new Error('Date filter for today should return all logged events');

      // Bad date range: dateFrom after dateTo -> 400
      const res2 = await fetch(`${baseUrl}/api/audit?dateFrom=2026-12-31&dateTo=2026-01-01`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (res2.status !== 400) throw new Error(`Expected 400 for invalid date range, got ${res2.status}`);
      console.log('PASS 9: Date range filter and dateFrom > dateTo validation work properly');
    }

    // 10. Sorting and pagination
    {
      const res1 = await fetch(`${baseUrl}/api/audit?sortBy=seq&sortOrder=asc&limit=2&page=1`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body1 = await res1.json();
      if (body1.items.length !== 2 || body1.page !== 1 || body1.limit !== 2) {
        throw new Error('Pagination page 1 failed');
      }
      if (body1.items[0].seq > body1.items[1].seq) {
        throw new Error('Ascending sort on seq failed');
      }
      console.log('PASS 10: Sorting and pagination work properly');
    }

    // 11. Injection resistance checks
    {
      const injections = ['{"$ne":null}', '.*', '(a+)+$', '<script>alert(1)</script>'];
      for (const inj of injections) {
        const res = await fetch(`${baseUrl}/api/audit?q=${encodeURIComponent(inj)}`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        if (res.status !== 200) {
          throw new Error(`Injection query ${inj} failed with status ${res.status}`);
        }
        const body = await res.json();
        if (!body.success) throw new Error(`Injection query failed to return success`);
      }
      console.log('PASS 11: All NoSQL / Regex injection strings safely handled');
    }

    // 12. GET /api/audit/filters
    {
      const res = await fetch(`${baseUrl}/api/audit/filters`, {
        headers: { Authorization: `Bearer ${investigatorToken}` }
      });
      if (res.status !== 200) throw new Error(`Expected 200 for /api/audit/filters, got ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body.actions) || body.actions.length < 13) {
        throw new Error('Filters response missing required audit actions');
      }
      if (!Array.isArray(body.users) || !body.users.includes('Detective Miller') || !body.users.includes('Admin Chief')) {
        throw new Error('Filters response missing distinct users');
      }
      console.log('PASS 12: GET /api/audit/filters returns actions and distinct user list');
    }

    console.log('\n========================================');
    console.log('ALL AUDIT API TESTS PASSED (100%)');
    console.log('========================================\n');
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
}

runTests();
