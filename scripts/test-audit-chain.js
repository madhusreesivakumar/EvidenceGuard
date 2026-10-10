'use strict';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production.');
  process.exit(1);
}
const args = process.argv.slice(2);
if (!args.includes('--confirm')) {
  console.error('Requires explicit flag --confirm');
  process.exit(1);
}

process.env.JWT_SECRET = 'test-audit-chain-jwt-secret-key-32chars!';
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
const SystemStatus = require('../models/SystemStatus');
const authRoutes = require('../routes/authRoutes');
const auditRoutes = require('../routes/auditRoutes');
const { ensureGenesis } = require('../services/chainService');
const { generateToken } = require('../services/tokenService');
const { logEvent } = require('../services/auditService');

async function runTests() {
  console.log('--- Starting Sprint 7A Audit Chain & Tampering Tests ---');
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
      email: 'admin@chain.test',
      passwordHash: pwdHash,
      role: 'ADMIN'
    });
    const adminToken = await generateToken(admin._id, admin.role);

    const investigator = await User.create({
      name: 'Detective Jones',
      email: 'investigator@chain.test',
      passwordHash: pwdHash,
      role: 'INVESTIGATOR'
    });
    const investigatorToken = await generateToken(investigator._id, investigator.role);

    const viewer = await User.create({
      name: 'Viewer Bob',
      email: 'viewer@chain.test',
      passwordHash: pwdHash,
      role: 'VIEWER'
    });
    const viewerToken = await generateToken(viewer._id, viewer.role);

    // Create a series of chained audit events
    console.log('Generating sequential audit entries...');
    await logEvent({ user: admin, action: 'LOGIN', description: 'Admin login', req: { ip: '127.0.0.1' } });
    await logEvent({ user: investigator, action: 'UPLOAD', evidenceId: 'EV-0001', caseId: 'EG-2026-0001', description: 'Upload file 1' });
    await logEvent({ user: investigator, action: 'VERIFY', evidenceId: 'EV-0001', caseId: 'EG-2026-0001', description: 'Verify file 1' });
    await logEvent({ user: admin, action: 'USER_CREATED', description: 'Created new user account' });

    // 1. Check healthy audit chain validation
    {
      const res = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (res.status !== 200) throw new Error(`Expected 200 for validate, got ${res.status}`);
      const body = await res.json();
      if (!body.success || !body.valid || body.firstBrokenSeq !== null) {
        throw new Error(`Expected healthy audit chain to be valid, got: ${JSON.stringify(body)}`);
      }
      
      // Verify cached in SystemStatus
      const sysStatus = await SystemStatus.findOne({ key: 'auditValidation' }).lean();
      if (!sysStatus || !sysStatus.value || sysStatus.value.valid !== true) {
        throw new Error('SystemStatus missing valid auditValidation cache');
      }
      console.log('PASS 1: Healthy audit hash-chain validates as VALID and caches in SystemStatus');
    }

    // 2. Authorization checks on POST /api/audit/validate
    {
      // Logged out -> 401
      const res1 = await fetch(`${baseUrl}/api/audit/validate`, { method: 'POST' });
      if (res1.status !== 401) throw new Error(`Expected 401 for logged-out validate, got ${res1.status}`);

      // Viewer -> 403
      const res2 = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${viewerToken}` }
      });
      if (res2.status !== 403) throw new Error(`Expected 403 for viewer validate, got ${res2.status}`);

      // Investigator -> 403
      const res3 = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${investigatorToken}` }
      });
      if (res3.status !== 403) throw new Error(`Expected 403 for investigator validate, got ${res3.status}`);
      console.log('PASS 2: validateAudit is strictly ADMIN only (401 for guest, 403 for viewer/investigator)');
    }

    // 3. Tamper Mode: edit-description (Tamper seq 2 description via native driver)
    {
      const entry2 = await AuditLog.findOne({ seq: 2 }).lean();
      const origDesc = entry2.description;

      await AuditLog.collection.updateOne(
        { _id: entry2._id },
        { $set: { description: 'Tampered malicious description' } }
      );

      const res = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      if (body.valid !== false || body.firstBrokenSeq !== 2) {
        throw new Error(`Expected invalid at seq 2, got: ${JSON.stringify(body)}`);
      }

      // Restore
      await AuditLog.collection.updateOne(
        { _id: entry2._id },
        { $set: { description: origDesc } }
      );

      const restoreRes = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const restoreBody = await restoreRes.json();
      if (restoreBody.valid !== true) throw new Error('Expected valid after restore');
      console.log('PASS 3: Tamper mode "edit-description" yields INVALID at seq 2 and VALID after restore');
    }

    // 4. Tamper Mode: edit-username (Tamper seq 3 userName)
    {
      const entry3 = await AuditLog.findOne({ seq: 3 }).lean();
      const origName = entry3.userName;

      await AuditLog.collection.updateOne(
        { _id: entry3._id },
        { $set: { userName: 'Imposter User' } }
      );

      const res = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      if (body.valid !== false || body.firstBrokenSeq !== 3) {
        throw new Error(`Expected invalid at seq 3, got: ${JSON.stringify(body)}`);
      }

      // Restore
      await AuditLog.collection.updateOne(
        { _id: entry3._id },
        { $set: { userName: origName } }
      );

      const restoreRes = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const restoreBody = await restoreRes.json();
      if (restoreBody.valid !== true) throw new Error('Expected valid after restore');
      console.log('PASS 4: Tamper mode "edit-username" yields INVALID at seq 3 and VALID after restore');
    }

    // 5. Tamper Mode: delete-entry (Delete seq 2)
    {
      const entry2 = await AuditLog.findOne({ seq: 2 }).lean();
      await AuditLog.collection.deleteOne({ _id: entry2._id });

      const res = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      // Deleting seq 2 breaks contiguity and prevHash linkage starting at seq 3
      if (body.valid !== false || body.firstBrokenSeq !== 3) {
        throw new Error(`Expected invalid at seq 3, got: ${JSON.stringify(body)}`);
      }

      // Restore
      await AuditLog.collection.insertOne(entry2);

      const restoreRes = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const restoreBody = await restoreRes.json();
      if (restoreBody.valid !== true) throw new Error('Expected valid after restore');
      console.log('PASS 5: Tamper mode "delete-entry" yields INVALID at seq 3 and VALID after reinsertion');
    }

    // 6. Tamper Mode: edit-entryhash (Tamper entryHash on seq 2)
    {
      const entry2 = await AuditLog.findOne({ seq: 2 }).lean();
      const origHash = entry2.entryHash;

      await AuditLog.collection.updateOne(
        { _id: entry2._id },
        { $set: { entryHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' } }
      );

      const res = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      if (body.valid !== false || body.firstBrokenSeq !== 2) {
        throw new Error(`Expected invalid at seq 2, got: ${JSON.stringify(body)}`);
      }

      // Restore
      await AuditLog.collection.updateOne(
        { _id: entry2._id },
        { $set: { entryHash: origHash } }
      );

      const restoreRes = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const restoreBody = await restoreRes.json();
      if (restoreBody.valid !== true) throw new Error('Expected valid after restore');
      console.log('PASS 6: Tamper mode "edit-entryhash" yields INVALID at seq 2 and VALID after restore');
    }

    // 7. Concurrent 30 parallel audit writes
    {
      console.log('Firing 30 concurrent audit writes...');
      const startCount = await AuditLog.countDocuments();
      const promises = [];
      for (let i = 0; i < 30; i++) {
        promises.push(
          logEvent({
            user: admin,
            action: 'LOGIN',
            description: `Concurrent action ${i + 1}`,
            req: { ip: `192.168.1.${i + 1}` }
          })
        );
      }
      await Promise.all(promises);

      const allEntries = await AuditLog.find({ seq: { $ne: null } }).sort({ seq: 1 }).lean();
      if (allEntries.length !== startCount + 30) {
        throw new Error(`Expected ${startCount + 30} entries, found ${allEntries.length}`);
      }

      // Check contiguity & uniqueness
      const seqs = allEntries.map(e => e.seq);
      for (let i = 0; i < seqs.length; i++) {
        if (seqs[i] !== i + 1) {
          throw new Error(`Broken sequence at index ${i}: expected ${i + 1}, got ${seqs[i]}`);
        }
      }

      // Verify validation passes across entire concurrent chain
      const res = await fetch(`${baseUrl}/api/audit/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      if (body.valid !== true) throw new Error('Concurrent chain failed cryptographic validation');
      console.log(`PASS 7: 30 concurrent writes created a strictly contiguous, unforked chain of ${allEntries.length} entries`);
    }

    // 8. Test append-only pre-hooks on AuditLog model
    {
      let updateBlocked = false;
      try {
        await AuditLog.updateOne({ seq: 1 }, { description: 'Hacked' });
      } catch (err) {
        updateBlocked = true;
      }
      if (!updateBlocked) throw new Error('AuditLog.updateOne should have been rejected by pre-hook');

      let deleteBlocked = false;
      try {
        await AuditLog.deleteOne({ seq: 1 });
      } catch (err) {
        deleteBlocked = true;
      }
      if (!deleteBlocked) throw new Error('AuditLog.deleteOne should have been rejected by pre-hook');
      console.log('PASS 8: Direct model updates and deletes are strictly rejected by pre-hooks');
    }

    console.log('\n========================================');
    console.log('ALL AUDIT CHAIN & TAMPER TESTS PASSED (100%)');
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
