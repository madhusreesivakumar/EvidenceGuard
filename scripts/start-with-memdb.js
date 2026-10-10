'use strict';

/**
 * scripts/start-with-memdb.js
 * ────────────────────────────────────────────────────────────────────────────
 * Self-contained demo launcher — no external MongoDB required.
 *
 *  1. Starts an in-memory MongoDB (mongodb-memory-server)
 *  2. Sets MONGODB_URI + JWT_SECRET in process.env BEFORE server.js loads
 *     (dotenv.config() in config/env.js never overwrites already-set vars)
 *  3. require()s server.js which builds the Express app but does NOT call
 *     connectDB() or app.listen() (because require.main !== module)
 *  4. Connects to the in-memory DB, seeds demo accounts + one evidence record
 *  5. Calls app.listen() and prints the access URL + demo accounts
 *
 * Usage:  node scripts/start-with-memdb.js
 */

process.env.MONGODB_URI           = '__placeholder__'; // will be replaced below
process.env.JWT_SECRET            = require('crypto').randomBytes(48).toString('hex');
process.env.PORT                  = process.env.PORT || '3000';
process.env.PUBLIC_BASE_URL       = `http://localhost:${process.env.PORT || 3000}`;
process.env.NODE_ENV              = 'development';
process.env.FEATURE_CUSTODY       = 'true';
process.env.FEATURE_SIGNATURES    = 'false';
process.env.FEATURE_NOTIFICATIONS = 'false';
process.env.FEATURE_FORENSICS     = 'false';
process.env.FEATURE_REMOTE_STORAGE= 'false';
process.env.STORAGE_ENCRYPTION    = 'false';
process.env.FEATURE_KMS           = 'false';
process.env.ALLOW_LOCAL_KMS       = 'true';
process.env.KMS_PROVIDER          = 'local';

const { MongoMemoryServer } = require('mongodb-memory-server');
const path   = require('path');
const bcrypt = require('bcrypt');
const ROOT   = path.join(__dirname, '..');

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   EvidenceGuard  ·  In-Memory Demo Launcher                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── 1. Start in-memory MongoDB ─────────────────────────────────────────────
  console.log('⏳  Starting in-memory MongoDB …');
  const mongod   = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri() + 'evidenceguard_demo';
  process.env.MONGODB_URI = mongoUri;
  console.log('✅  In-memory MongoDB started.\n');

  // ── 2. Load the app (does NOT start listening because require.main !== module)
  const app = require(path.join(ROOT, 'server.js'));

  // ── 3. Connect to DB + genesis block ──────────────────────────────────────
  const connectDB      = require(path.join(ROOT, 'config/db'));
  const { ensureGenesis } = require(path.join(ROOT, 'services/chainService'));
  await connectDB();
  console.log('✅  Database connected.\n');
  await ensureGenesis();
  console.log('✅  Genesis block ready.\n');

  // ── 4. Seed demo data ──────────────────────────────────────────────────────
  console.log('⏳  Seeding demo accounts + evidence …');
  await seedDemoData();
  console.log('✅  Demo data ready.\n');

  // ── 5. Start listening ─────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT, 10);
  const server = app.listen(port, () => {
    printReadyBanner(port);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Demo] Shutting down …');
    server.close(async () => {
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      await mongod.stop();
      console.log('[Demo] Stopped. Bye!\n');
      process.exit(0);
    });
  });
}

// ── Demo data seeder ───────────────────────────────────────────────────────
async function seedDemoData() {
  const User    = require(path.join(ROOT, 'models/User'));
  const Counter = require(path.join(ROOT, 'models/Counter'));
  const fs      = require('fs');
  const os      = require('os');

  const ACCOUNTS = [
    { name: 'Demo Admin',        email: 'admin@eg.local',  password: 'Admin1234!', role: 'ADMIN'         },
    { name: 'Demo Investigator', email: 'invest@eg.local', password: 'Invest123!', role: 'INVESTIGATOR'  },
    { name: 'Demo Viewer',       email: 'viewer@eg.local', password: 'Viewer123!', role: 'VIEWER'        },
  ];

  // Create users
  for (const a of ACCOUNTS) {
    if (!await User.findOne({ email: a.email })) {
      const passwordHash = await bcrypt.hash(a.password, 12);
      await User.create({ name: a.name, email: a.email, passwordHash, role: a.role, isActive: true });
      console.log(`  ✓  Created ${a.role}: ${a.email}`);
    } else {
      console.log(`  –  ${a.email} already exists, skipping.`);
    }
  }

  // Seed one evidence record if none exists
  try {
    const existing = await Counter.findOne({ name: 'evidenceId' });
    if (!existing || existing.seq === 0) {
      const admin   = await User.findOne({ email: 'admin@eg.local' }).lean();
      const demoSrc = path.join(ROOT, 'demo-files', 'case_document.txt');
      if (admin && fs.existsSync(demoSrc)) {
        const tmpPath = path.join(os.tmpdir(), `eg-seed-${Date.now()}.txt`);
        fs.copyFileSync(demoSrc, tmpPath);
        const stat = fs.statSync(tmpPath);
        const { createEvidenceRecord } = require(path.join(ROOT, 'services/evidenceService'));
        await createEvidenceRecord({
          file: { path: tmpPath, originalname: 'case_document.txt', size: stat.size, mimetype: 'text/plain' },
          body: { name: 'Seeded Demo Document', type: 'Document', description: 'Pre-loaded demo evidence record', isDemo: true },
          user: { _id: admin._id, id: admin._id.toString(), role: admin.role, orgId: 'default' },
          req:  { ip: '127.0.0.1', headers: {}, user: admin }
        });
        console.log('  ✓  Seeded demo evidence record: case_document.txt');
      }
    } else {
      console.log('  –  Evidence records already exist, skipping seed.');
    }
  } catch (err) {
    console.log('  ⚠️  Evidence seed skipped (non-fatal):', err.message);
  }
}

// ── Ready banner ────────────────────────────────────────────────────────────
function printReadyBanner(port) {
  const hr = '═'.repeat(62);
  console.log('\n' + hr);
  console.log('  🚀  EvidenceGuard is RUNNING');
  console.log(hr);
  console.log(`\n  Open in browser  →  http://localhost:${port}\n`);
  console.log('  ┌─────────────────────────┬──────────────┬────────────────┐');
  console.log('  │  Email                  │  Password    │  Role          │');
  console.log('  ├─────────────────────────┼──────────────┼────────────────┤');
  console.log('  │  admin@eg.local         │  Admin1234!  │  ADMIN         │');
  console.log('  │  invest@eg.local        │  Invest123!  │  INVESTIGATOR  │');
  console.log('  │  viewer@eg.local        │  Viewer123!  │  VIEWER        │');
  console.log('  └─────────────────────────┴──────────────┴────────────────┘');
  console.log('\n  📋  Demo flow:');
  console.log('      1 → http://localhost:' + port + '/login.html');
  console.log('      2 → Login as admin@eg.local  /  Admin1234!');
  console.log('      3 → Upload → demo-files/case_document.txt');
  console.log('      4 → Records → click the evidence item');
  console.log('      5 → Evidence Details → Verify (should be VERIFIED ✅)');
  console.log('      6 → Verify page → upload case_document_tampered.txt (TAMPERED ❌)');
  console.log('      7 → Blockchain → Validate Chain → VALID');
  console.log('      8 → Audit → see every action logged');
  console.log('\n  📁  Demo files:  ./demo-files/');
  console.log('  ⚠️   Data lives in memory — resets on server stop.');
  console.log('\n  Press  Ctrl+C  to stop.\n');
  console.log(hr + '\n');
}

main().catch(err => {
  console.error('\n❌  FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
