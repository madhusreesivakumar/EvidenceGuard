/* ================================================================
   EvidenceGuard – seed.js
   Seeds demo users + evidence + blockchain + audit logs
   Run: node seed.js
   ================================================================ */
'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/evidenceguard';

// ── Schemas (must match server.js) ────────────────────────────
const User = mongoose.model('User', new mongoose.Schema({
  name: String, email: { type: String, unique: true, lowercase: true },
  passwordHash: String, role: String, createdAt: { type: Date, default: Date.now }
}));
const Evidence = mongoose.model('Evidence', new mongoose.Schema({
  evidenceId: { type: String, unique: true }, caseId: String, name: String, type: String,
  description: String, fileName: String, fileSize: Number, filePath: String,
  hash: String, status: String, uploadedBy: Object,
  createdAt: { type: Date, default: Date.now }, verifiedAt: Date, blockNumber: Number
}));
const Block = mongoose.model('Block', new mongoose.Schema({
  blockNumber: { type: Number, unique: true }, evidenceId: String, caseId: String,
  evidenceHash: String, previousHash: String, currentHash: String,
  timestamp: { type: Date, default: Date.now }
}));
const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId, userName: String, role: String, action: String,
  evidenceId: String, caseId: String, description: String,
  timestamp: { type: Date, default: Date.now }, ipAddress: String
}));

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
function blockHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

const DEMO_EVIDENCE = [
  { evidenceId: 'EV-001', caseId: 'EG-2026-1001', name: 'CCTV Footage', type: 'Video',     fileName: 'cctv_footage_18sep.mp4',   fileSize: 104857600, status: 'Verified',  description: 'CCTV recording from main gate, 18 Sep 2026.' },
  { evidenceId: 'EV-002', caseId: 'EG-2026-1001', name: 'Crime Scene Image', type: 'Image', fileName: 'crime_scene_photo01.jpg',  fileSize: 2097152,   status: 'Verified',  description: 'Photograph of crime scene, location A.' },
  { evidenceId: 'EV-003', caseId: 'EG-2026-1002', name: 'Case Document',  type: 'Document', fileName: 'case_file_report.pdf',     fileSize: 524288,    status: 'Pending',   description: 'Official case report document.' },
  { evidenceId: 'EV-004', caseId: 'EG-2026-1003', name: 'Audio Recording', type: 'Audio',  fileName: 'interview_audio_16sep.mp3', fileSize: 5242880,   status: 'Tampered',  description: 'Interview audio recording, 16 Sep 2026.' },
  { evidenceId: 'EV-005', caseId: 'EG-2026-1002', name: 'Witness Statement', type: 'Document', fileName: 'witness_statement.docx', fileSize: 262144,  status: 'Verified',  description: 'Signed witness statement form.' }
];

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // Clear collections
  await Promise.all([User.deleteMany(), Evidence.deleteMany(), Block.deleteMany(), AuditLog.deleteMany()]);
  console.log('🗑  Cleared existing data');

  // Create users
  const users = await User.create([
    { name: 'Admin User',         email: 'admin@evidenceguard.com',        passwordHash: await bcrypt.hash('Admin@123456', 12),        role: 'admin' },
    { name: 'Investigator Singh',  email: 'investigator@evidenceguard.com',  passwordHash: await bcrypt.hash('Inv@123456', 12),           role: 'investigator' },
    { name: 'Viewer Sharma',       email: 'viewer@evidenceguard.com',        passwordHash: await bcrypt.hash('View@123456', 12),          role: 'viewer' }
  ]);
  const admin = users[0];
  console.log('👤 Created 3 users');
  console.log('   admin@evidenceguard.com        / Admin@123456  (admin)');
  console.log('   investigator@evidenceguard.com / Inv@123456    (investigator)');
  console.log('   viewer@evidenceguard.com       / View@123456   (viewer)');

  // Genesis block
  const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
  const genesisTs = new Date('2026-09-01T00:00:00Z');
  const genesisData = { blockNumber: 0, evidenceId: 'GENESIS', caseId: 'N/A', evidenceHash: GENESIS_HASH, previousHash: GENESIS_HASH, timestamp: genesisTs.toISOString() };
  const genesisHash = blockHash(genesisData);
  await Block.create({ blockNumber: 0, evidenceId: 'GENESIS', caseId: 'N/A', evidenceHash: GENESIS_HASH, previousHash: GENESIS_HASH, currentHash: genesisHash, timestamp: genesisTs });
  let prevHash = genesisHash;
  console.log('\n⛓  Created genesis block #0');

  // Evidence + blocks
  for (let i = 0; i < DEMO_EVIDENCE.length; i++) {
    const d     = DEMO_EVIDENCE[i];
    const hash  = sha256(`demo_evidence_${d.evidenceId}_${d.name}_salt_2026`);
    const ts    = new Date(Date.now() - (DEMO_EVIDENCE.length - i) * 3600000 * 12);
    const vAt   = d.status !== 'Pending' ? new Date(ts.getTime() + 3600000) : null;

    // Blockchain block
    const bNum = i + 1;
    const bData = { blockNumber: bNum, evidenceId: d.evidenceId, caseId: d.caseId, evidenceHash: hash, previousHash: prevHash, timestamp: ts.toISOString() };
    const currHash = blockHash(bData);
    await Block.create({ blockNumber: bNum, evidenceId: d.evidenceId, caseId: d.caseId, evidenceHash: hash, previousHash: prevHash, currentHash: currHash, timestamp: ts });
    prevHash = currHash;

    // Evidence record
    await Evidence.create({ ...d, hash, filePath: '', fileSize: d.fileSize, createdAt: ts, verifiedAt: vAt, blockNumber: bNum,
      uploadedBy: { id: admin._id, name: admin.name, email: admin.email } });

    // Audit logs
    await AuditLog.create([
      { userId: admin._id, userName: admin.name, role: 'admin', action: 'EVIDENCE_UPLOAD', evidenceId: d.evidenceId, caseId: d.caseId, description: `Evidence uploaded: ${d.name}`, timestamp: ts },
      { userId: admin._id, userName: admin.name, role: 'admin', action: 'HASH_GENERATED', evidenceId: d.evidenceId, caseId: d.caseId, description: `SHA-256 hash generated for: ${d.evidenceId}`, timestamp: new Date(ts.getTime() + 500) },
      { userId: admin._id, userName: admin.name, role: 'admin', action: 'BLOCKCHAIN_BLOCK_CREATED', evidenceId: d.evidenceId, caseId: d.caseId, description: `Block #${bNum} created`, timestamp: new Date(ts.getTime() + 1000) }
    ]);
    if (vAt) {
      const action = d.status === 'Tampered' ? 'EVIDENCE_TAMPERED' : 'EVIDENCE_VERIFIED';
      await AuditLog.create({ userId: admin._id, userName: admin.name, role: 'admin', action, evidenceId: d.evidenceId, caseId: d.caseId, description: `Evidence ${d.status.toLowerCase()}: ${d.name}`, timestamp: vAt });
    }
    console.log(`   📁 ${d.evidenceId} – ${d.name} (${d.status}) → Block #${bNum}`);
  }

  await AuditLog.create([
    { userId: admin._id, userName: admin.name, role: 'admin', action: 'USER_LOGIN', description: 'Admin logged in', timestamp: new Date() },
    { userId: admin._id, userName: admin.name, role: 'admin', action: 'BLOCKCHAIN_VALIDATED', description: 'Blockchain validated: VALID (6 blocks checked)', timestamp: new Date() }
  ]);

  const counts = {
    users: await User.countDocuments(),
    evidence: await Evidence.countDocuments(),
    blocks: await Block.countDocuments(),
    audit: await AuditLog.countDocuments()
  };
  console.log(`\n✅ Seed complete!`);
  console.log(`   Users: ${counts.users} | Evidence: ${counts.evidence} | Blocks: ${counts.blocks} | Audit: ${counts.audit}`);
  console.log(`\n🚀 Now run: node server.js → open http://localhost:3000\n`);
  process.exit(0);
}

seed().catch(e => { console.error('❌ Seed failed:', e.message); process.exit(1); });
