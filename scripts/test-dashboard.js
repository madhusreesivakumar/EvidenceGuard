'use strict';

process.env.JWT_SECRET = 'test-dashboard-jwt-secret-key-32chars!';
process.env.STORAGE_DRIVER = 'local';
process.env.MAX_UPLOAD_MB = '5';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Evidence = require('../models/Evidence');
const Block = require('../models/Block');
const Verification = require('../models/Verification');
const AuditLog = require('../models/AuditLog');
const SystemStatus = require('../models/SystemStatus');

const authRoutes = require('../routes/authRoutes');
const evidenceRoutes = require('../routes/evidenceRoutes');
const blockchainRoutes = require('../routes/blockchainRoutes');
const publicRoutes = require('../routes/publicRoutes');
const dashboardRoutes = require('../routes/dashboardRoutes');
const { ensureGenesis } = require('../services/chainService');
const { generateToken } = require('../services/tokenService');

async function runTests() {
  console.log('--- Starting Sprint 6D Dashboard & Stats Integration Tests ---');
  let mongod;
  let server;
  let baseUrl;

  try {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    console.log('Connected to In-Memory MongoDB');

    // Ensure Genesis block
    await ensureGenesis();

    const app = express();
    app.use(express.json());
    app.use(cookieParser());

    app.use('/api/auth', authRoutes);
    app.use('/api/evidence', evidenceRoutes);
    app.use('/api/blockchain', blockchainRoutes);
    app.use('/api/public', publicRoutes);
    app.use('/api/dashboard', dashboardRoutes);

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
      name: 'Admin User',
      email: 'admin@dashboard.test',
      passwordHash: pwdHash,
      role: 'ADMIN'
    });
    const adminToken = generateToken(admin._id, admin.role);

    const investigator = await User.create({
      name: 'Investigator User',
      email: 'investigator@dashboard.test',
      passwordHash: pwdHash,
      role: 'INVESTIGATOR'
    });
    const investigatorToken = generateToken(investigator._id, investigator.role);

    const viewer = await User.create({
      name: 'Viewer User',
      email: 'viewer@dashboard.test',
      passwordHash: pwdHash,
      role: 'VIEWER'
    });
    const viewerToken = generateToken(viewer._id, viewer.role);

    // 1. Unauthenticated request to /api/dashboard/stats -> 401
    {
      const res = await fetch(`${baseUrl}/api/dashboard/stats`);
      if (res.status === 401) {
        console.log('PASS 1: Unauthenticated request rejected with 401');
      } else {
        throw new Error(`Expected 401 for unauthenticated request, got ${res.status}`);
      }
    }

    // 2. Initial stats check for VIEWER (Role field restrictions)
    {
      const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${viewerToken}` }
      });
      if (res.status !== 200) throw new Error(`Expected 200 for viewer, got ${res.status}`);
      const body = await res.json();
      if (!body.success || !body.data) throw new Error('Viewer response missing data payload');
      
      const d = body.data;
      if (d.evidence.total !== 0 || d.evidence.verified !== 0 || d.evidence.pending !== 0 || d.evidence.tampered !== 0) {
        throw new Error('Initial evidence counts mismatch');
      }
      if (d.verificationStats.total !== 0 || !Array.isArray(d.verificationStats.last7Days) || d.verificationStats.last7Days.length !== 7) {
        throw new Error('Initial verification stats mismatch (must have 7 zero-filled days)');
      }
      if (d.users !== null) throw new Error(`Viewer should receive users: null, got ${d.users}`);
      if (d.auditEvents !== null) throw new Error(`Viewer should receive auditEvents: null, got ${d.auditEvents}`);
      if (d.blocks !== null) throw new Error(`Viewer should receive blocks: null, got ${d.blocks}`);
      if (d.chain !== null) throw new Error(`Viewer should receive chain: null, got ${d.chain}`);
      if (d.recentActivity !== null) throw new Error(`Viewer should receive recentActivity: null, got ${d.recentActivity}`);
      console.log('PASS 2: VIEWER role receives exact null restrictions for unauthorized collections');
    }

    // 3. Initial stats check for INVESTIGATOR (Auditing & Blockchain visible, Users null)
    {
      const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${investigatorToken}` }
      });
      if (res.status !== 200) throw new Error(`Expected 200 for investigator, got ${res.status}`);
      const body = await res.json();
      const d = body.data;

      if (d.users !== null) throw new Error(`Investigator should receive users: null, got ${d.users}`);
      if (typeof d.auditEvents !== 'number') throw new Error('Investigator should receive auditEvents number');
      if (typeof d.blocks !== 'number' || d.blocks < 1) throw new Error('Investigator should receive blocks count >= 1 (genesis)');
      if (!d.chain || typeof d.chain.blocksSinceValidation !== 'number') throw new Error('Investigator should receive chain object');
      if (!Array.isArray(d.recentActivity)) throw new Error('Investigator should receive recentActivity array');
      console.log('PASS 3: INVESTIGATOR role receives audit & blockchain stats, users: null');
    }

    // 4. Initial stats check for ADMIN (All fields populated)
    {
      const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (res.status !== 200) throw new Error(`Expected 200 for admin, got ${res.status}`);
      const body = await res.json();
      const d = body.data;

      if (d.users !== 3) throw new Error(`Admin should receive users: 3, got ${d.users}`);
      if (typeof d.auditEvents !== 'number') throw new Error('Admin should receive auditEvents number');
      if (typeof d.blocks !== 'number') throw new Error('Admin should receive blocks count');
      if (!d.chain) throw new Error('Admin should receive chain object');
      if (!Array.isArray(d.recentActivity)) throw new Error('Admin should receive recentActivity array');

      // Verify no ipAddress in recentActivity
      const hasIp = d.recentActivity.some(act => act.ipAddress !== undefined);
      if (hasIp) throw new Error('recentActivity should NOT expose ipAddress');
      console.log('PASS 4: ADMIN role receives all fields, no ipAddress exposed in activity');
    }

    // 5. Upload evidence and check stats update
    let evId1, evId2;
    {
      const form1 = new FormData();
      const blob1 = new Blob(['Sample digital contract payload for testing dashboard'], { type: 'text/plain' });
      form1.append('file', blob1, 'contract.txt');
      form1.append('name', 'Contract Document');
      form1.append('type', 'Document');
      form1.append('description', 'Test contract description');

      const uploadRes1 = await fetch(`${baseUrl}/api/evidence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form1
      });
      const uploadBody1 = await uploadRes1.json();
      if (!uploadRes1.ok || !uploadBody1.success) throw new Error('Failed to upload evidence 1: ' + JSON.stringify(uploadBody1));
      evId1 = uploadBody1.evidence.evidenceId;

      const form2 = new FormData();
      const blob2 = new Blob(['Second piece of evidence for tampering test'], { type: 'text/plain' });
      form2.append('file', blob2, 'photo.txt');
      form2.append('name', 'Crime Photo');
      form2.append('type', 'Image');
      form2.append('description', 'Test photo description');

      const uploadRes2 = await fetch(`${baseUrl}/api/evidence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form2
      });
      const uploadBody2 = await uploadRes2.json();
      if (!uploadRes2.ok || !uploadBody2.success) throw new Error('Failed to upload evidence 2: ' + JSON.stringify(uploadBody2));
      evId2 = uploadBody2.evidence.evidenceId;

      // Check stats after upload
      const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      const d = body.data;

      if (d.evidence.total !== 2 || d.evidence.pending !== 2 || d.evidence.verified !== 0) {
        throw new Error(`Expected total: 2, pending: 2 after uploads. Got: ${JSON.stringify(d.evidence)}`);
      }
      if (d.recentEvidence.length !== 2) throw new Error(`Expected recentEvidence length 2, got ${d.recentEvidence.length}`);
      console.log('PASS 5: Stats updated correctly after evidence upload (total=2, pending=2)');
    }

    // 6. Verify evidence 1 (VERIFIED) & Evidence 2 (TAMPERED)
    {
      // Verify evId1 with original content
      const vForm1 = new FormData();
      vForm1.append('file', new Blob(['Sample digital contract payload for testing dashboard'], { type: 'text/plain' }), 'contract.txt');
      const vRes1 = await fetch(`${baseUrl}/api/evidence/${evId1}/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: vForm1
      });
      const vBody1 = await vRes1.json();
      if (vBody1.result !== 'VERIFIED') throw new Error(`Expected VERIFIED, got ${vBody1.result}`);

      // Verify evId2 with modified content -> TAMPERED
      const vForm2 = new FormData();
      vForm2.append('file', new Blob(['Modified content causing hash mismatch'], { type: 'text/plain' }), 'photo.txt');
      const vRes2 = await fetch(`${baseUrl}/api/evidence/${evId2}/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: vForm2
      });
      const vBody2 = await vRes2.json();
      if (vBody2.result !== 'TAMPERED') throw new Error(`Expected TAMPERED, got ${vBody2.result}`);

      // Check stats
      const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      const d = body.data;

      if (d.evidence.total !== 2 || d.evidence.verified !== 1 || d.evidence.tampered !== 1 || d.evidence.pending !== 0) {
        throw new Error(`Evidence counts mismatch after verification: ${JSON.stringify(d.evidence)}`);
      }
      if (d.verificationStats.total !== 2 || d.verificationStats.verified !== 1 || d.verificationStats.tampered !== 1) {
        throw new Error(`Verification stats mismatch: ${JSON.stringify(d.verificationStats)}`);
      }
      console.log('PASS 6: Stats accurately reflect VERIFIED and TAMPERED counts');
    }

    // 7. Soft-delete an evidence and verify non-deleted stats
    {
      const delRes = await fetch(`${baseUrl}/api/evidence/${evId2}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: 'Test soft delete for dashboard count exclusion' })
      });
      if (delRes.status !== 200) throw new Error(`Soft delete failed with status ${delRes.status}`);

      const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      const d = body.data;

      if (d.evidence.total !== 1 || d.evidence.tampered !== 0 || d.evidence.verified !== 1) {
        throw new Error(`Soft deleted evidence must be excluded from total & status counts: ${JSON.stringify(d.evidence)}`);
      }
      if (d.recentEvidence.length !== 1) {
        throw new Error(`Soft deleted evidence must be excluded from recentEvidence, got ${d.recentEvidence.length}`);
      }
      console.log('PASS 7: Soft-deleted evidence correctly excluded from dashboard counts and recent list');
    }

    // 8. Blockchain Integrity Validation Cache in SystemStatus
    {
      // Run validation as ADMIN
      const valRes = await fetch(`${baseUrl}/api/blockchain/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const valBody = await valRes.json();
      if (!valBody.success || !valBody.valid) throw new Error('Blockchain validation failed');

      // Check dashboard stats chain info
      const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();
      const chainInfo = body.data.chain;

      if (!chainInfo || !chainInfo.lastValidation) throw new Error('Missing lastValidation in chainInfo');
      if (chainInfo.lastValidation.valid !== true) throw new Error('Expected lastValidation.valid to be true');
      if (chainInfo.blocksSinceValidation !== 0) throw new Error(`Expected 0 blocks since validation, got ${chainInfo.blocksSinceValidation}`);
      console.log('PASS 8: Blockchain validation cached in SystemStatus and reflected in dashboard stats');
    }

    // 9. Tamper with blockchain data and verify INVALID status cache
    {
      // Directly corrupt block 1 evidenceHash to simulate database tampering
      const blocks = await Block.find().sort({ blockNumber: 1 });
      if (blocks.length > 1) {
        const origHash = blocks[1].evidenceHash;
        await Block.collection.updateOne(
          { _id: blocks[1]._id },
          { $set: { evidenceHash: '0000000000000000000000000000000000000000000000000000000000000000' } }
        );
        
        // Re-validate
        const valRes = await fetch(`${baseUrl}/api/blockchain/validate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        const valBody = await valRes.json();
        if (valBody.valid !== false) throw new Error('Expected validation to return valid: false after tampering');

        // Check dashboard stats
        const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        const body = await res.json();
        const chainInfo = body.data.chain;

        if (chainInfo.lastValidation.valid !== false) throw new Error('Expected dashboard to show lastValidation.valid: false');
        if (chainInfo.lastValidation.firstBrokenBlock !== 1) throw new Error(`Expected firstBrokenBlock: 1, got ${chainInfo.lastValidation.firstBrokenBlock}`);
        console.log('PASS 9: Tampering detected and correctly cached in SystemStatus with firstBrokenBlock');

        // Restore block
        await Block.collection.updateOne(
          { _id: blocks[1]._id },
          { $set: { evidenceHash: origHash } }
        );
        await fetch(`${baseUrl}/api/blockchain/validate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` }
        });
      }
    }

    console.log('\n========================================');
    console.log('ALL SPRINT 6D TESTS PASSED SUCCESSFULLY (100%)');
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
