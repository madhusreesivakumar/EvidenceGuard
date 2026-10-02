'use strict';

/**
 * EvidenceGuard - Production Demo Seeding Script
 * Sprint 8C - Real, Verifiable Demo Data for Presentations
 * 
 * Safety:
 *  - Refuses to run when NODE_ENV=production
 *  - Requires --confirm flag
 *  - Exits if non-demo data exists unless --add-to-existing is provided
 *  - Idempotent: never duplicates existing demo records
 *  - Reset mode: node scripts/seed.js --reset --confirm --i-understand
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

const savedUri = process.env.MONGODB_URI;
dotenv.config();
if (savedUri && (!process.env.MONGODB_URI || process.env.MONGODB_URI.trim() === '')) {
  process.env.MONGODB_URI = savedUri;
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Evidence = require('../models/Evidence');
const Verification = require('../models/Verification');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');
const Counter = require('../models/Counter');
const SystemStatus = require('../models/SystemStatus');

const { ensureGenesis } = require('../services/chainService');
const { createEvidenceRecord } = require('../services/evidenceService');
const { executeVerification } = require('../services/verificationService');
const { validateChain } = require('../services/chainValidator');
const { validateAuditChain } = require('../services/auditHash');

// Parse CLI flags
const args = process.argv.slice(2);
const isReset = args.includes('--reset');
const hasConfirm = args.includes('--confirm');
const hasIUnderstand = args.includes('--i-understand');
const hasAddToExisting = args.includes('--add-to-existing');

const uriIndex = args.indexOf('--uri');
if (uriIndex !== -1 && args[uriIndex + 1]) {
  process.env.MONGODB_URI = args[uriIndex + 1];
}

// 1. Production Safety Check
if (process.env.NODE_ENV === 'production') {
  console.error('\n❌ ERROR: Refusing to run seed script in production environment (NODE_ENV=production).\n');
  process.exit(1);
}

// 2. Helper to generate realistic audio WAV buffer (440Hz sine wave tone, 16-bit mono)
function generateWavBuffer(durationSec = 0.5, freq = 440, sampleRate = 44100) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t);
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }
  return buffer;
}

// Minimal valid 16x16 WebM video buffer (VP8 keyframe)
const WEBM_BUFFER = Buffer.from(
  '1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810242858102' +
  '18538067a91549a9668c2ad7b1830f42404d8084476f6f676c65574184476f6f676c65' +
  '1654ae6b9aae98d7810173c581018381018685565f565038e08db0820010ba820010' +
  '1f43b6758ee78100a38a810000803001009d012a100010000000',
  'hex'
);

// Minimal valid 1x1 PNG buffer
const PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d' +
  '49444154789c6360606060000000050001a7df756b0000000049454e44ae426082',
  'hex'
);

// Helper to generate a random 16-character alphanumeric password
function generateRandomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(16);
  let pass = '';
  for (let i = 0; i < 16; i++) {
    pass += chars[bytes[i] % chars.length];
  }
  return pass;
}

async function runSeed() {
  // ─── Reset Mode Execution ──────────────────────────────────────────────────
  if (isReset) {
    if (!hasConfirm || !hasIUnderstand) {
      console.error('\n❌ ERROR: Database reset requires both --confirm and --i-understand flags:');
      console.error('   node scripts/seed.js --reset --confirm --i-understand\n');
      process.exit(1);
    }

    console.log('\n⚠️  DATABASE RESET REQUESTED');
    await connectDB();

    const dbName = mongoose.connection.name || mongoose.connection.db.databaseName;
    console.log(`\n========================================================================`);
    console.log(`🚨 CAUTION: About to DROP ALL COLLECTIONS in database: "${dbName}"`);
    console.log(`========================================================================`);
    console.log('Waiting 5 seconds before commencing wipe... (Press Ctrl+C to abort)\n');

    for (let i = 5; i > 0; i--) {
      process.stdout.write(`Dropping in ${i} seconds...\r`);
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('\nWiping collections now...');

    const collections = await mongoose.connection.db.collections();
    for (const col of collections) {
      try {
        await col.drop();
        console.log(`  ✓ Dropped collection: ${col.collectionName}`);
      } catch (err) {
        console.warn(`  ⚠️ Could not drop ${col.collectionName}: ${err.message}`);
      }
    }

    // Re-create indexes and genesis block
    await ensureGenesis();
    console.log('\n✓ Database wiped clean. Genesis block initialized.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ─── Regular Seed Mode Execution ───────────────────────────────────────────
  if (!hasConfirm) {
    console.error('\n❌ ERROR: Seeding requires explicit confirmation flag:');
    console.error('   node scripts/seed.js --confirm\n');
    console.error('If you wish to reset existing data first, use:');
    console.error('   node scripts/seed.js --reset --confirm --i-understand\n');
    process.exit(1);
  }

  await connectDB();
  await ensureGenesis();

  // ─── Check Existing Non-Demo Data ──────────────────────────────────────────
  const nonDemoCount = await Evidence.countDocuments({ isDemo: false });
  const nonDemoUsers = await User.countDocuments({
    role: { $ne: 'ADMIN' },
    email: { $nin: ['demo.investigator@evidenceguard.local', 'demo.viewer@evidenceguard.local'] }
  });

  if ((nonDemoCount > 0 || nonDemoUsers > 0) && !hasAddToExisting) {
    console.error('\n⚠️  DATABASE CONTAINS NON-DEMO DATA:');
    console.error(`   Found ${nonDemoCount} existing evidence records and ${nonDemoUsers} non-demo non-admin users.`);
    console.error('   To append demo records without touching existing data, pass:');
    console.error('     node scripts/seed.js --confirm --add-to-existing');
    console.error('   Or to wipe the database clean before seeding:');
    console.error('     node scripts/seed.js --reset --confirm --i-understand\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('\n🌱 EvidenceGuard Seeding - Commencing...');

  // ─── Setup Demo Users ──────────────────────────────────────────────────────
  const demoUsersConfig = [
    {
      email: 'demo.admin@evidenceguard.local',
      name: 'Demo Admin',
      role: 'ADMIN'
    },
    {
      email: 'demo.investigator@evidenceguard.local',
      name: 'Demo Investigator',
      role: 'INVESTIGATOR'
    },
    {
      email: 'demo.viewer@evidenceguard.local',
      name: 'Demo Viewer',
      role: 'VIEWER'
    }
  ];

  const userCredentials = [];
  const envPassword = process.env.SEED_DEMO_PASSWORD;

  for (const cfg of demoUsersConfig) {
    let plainPassword;
    let passwordSource;

    if (envPassword && envPassword.trim().length > 0) {
      plainPassword = envPassword.trim();
      passwordSource = 'env (SEED_DEMO_PASSWORD)';
    } else {
      plainPassword = generateRandomPassword();
      passwordSource = 'generated (one-time)';
    }

    let existingUser = await User.findOne({ email: cfg.email.toLowerCase() });
    if (!existingUser) {
      const passwordHash = await bcrypt.hash(plainPassword, 10);
      existingUser = new User({
        name: cfg.name,
        email: cfg.email.toLowerCase(),
        passwordHash,
        role: cfg.role,
        isActive: true
      });
      await existingUser.save();
      console.log(`  ✓ Created user: ${cfg.email} [${cfg.role}]`);
    } else {
      console.log(`  ℹ User already exists: ${cfg.email} [${cfg.role}]`);
    }

    userCredentials.push({
      email: cfg.email,
      name: cfg.name,
      role: cfg.role,
      password: plainPassword,
      source: passwordSource,
      userDoc: existingUser
    });
  }

  const investigatorUser = userCredentials.find(u => u.role === 'INVESTIGATOR').userDoc;

  // ─── Prepare Demo Files on Disk ────────────────────────────────────────────
  const demoDir = path.join(__dirname, '..', 'demo-files');
  if (!fs.existsSync(demoDir)) {
    fs.mkdirSync(demoDir, { recursive: true });
  }

  // 1. CCTV Video
  const cctvPath = path.join(demoDir, 'cctv_footage.webm');
  fs.writeFileSync(cctvPath, WEBM_BUFFER);

  // 2. Crime Scene Image
  const imgPath = path.join(demoDir, 'crime_scene.png');
  fs.writeFileSync(imgPath, PNG_BUFFER);

  // 3. Case Document
  const docPath = path.join(demoDir, 'case_document.txt');
  const docContent = [
    '========================================================================',
    '                 CRIME SCENE INVESTIGATION REPORT',
    '========================================================================',
    'Case Identifier : CASE-2026-INCIDENT-0081',
    'Investigating   : Cyber Forensics & Evidence Response Division',
    'Subject         : Physical Scene Assessment & Evidence Log',
    'Date Recorded   : 2026-10-02 08:30:00 UTC',
    'Chain of Custody: Acquired on-scene by Investigator, bitstream hashed.',
    'Status Note     : Cryptographically sealed with SHA-256 upon intake.',
    '========================================================================'
  ].join('\n');
  fs.writeFileSync(docPath, docContent, 'utf8');

  // 4. Audio Recording (Original & Tampered)
  const wavOriginal = generateWavBuffer(0.5, 440, 44100);
  const audioOriginalPath = path.join(demoDir, 'audio_recording.wav');
  fs.writeFileSync(audioOriginalPath, wavOriginal);

  // Audio tampered: flip byte in PCM sample data
  const wavTampered = Buffer.from(wavOriginal);
  wavTampered[50] ^= 0xFF;
  const audioTamperedPath = path.join(demoDir, 'audio_recording_tampered.wav');
  fs.writeFileSync(audioTamperedPath, wavTampered);

  // 5. Witness Statement
  const witnessPath = path.join(demoDir, 'witness_statement.txt');
  const witnessContent = [
    '========================================================================',
    '                     FORMAL WITNESS DEPOSITION',
    '========================================================================',
    'Affidavit Reference: AFF-2026-DEPO-004',
    'Deponent          : Anonymous Security Guard',
    'Location          : East Compound Facility Gate',
    'Statement Summary :',
    '  "At approximately 22:45 hours, the northern perimeter alarm triggered.',
    '   Visual inspection confirmed unauthorized access attempts near server room B."',
    'Authenticity Seal : Secured via EvidenceGuard cryptographic hash-chain.',
    '========================================================================'
  ].join('\n');
  fs.writeFileSync(witnessPath, witnessContent, 'utf8');

  // Also write modified copies for presentation live demo
  const docTamperedPath = path.join(demoDir, 'case_document_tampered.txt');
  const docTamperedContent = docContent.replace('CASE-2026-INCIDENT-0081', 'CASE-9999-TAMPERED-8888');
  fs.writeFileSync(docTamperedPath, docTamperedContent, 'utf8');

  const imgTamperedPath = path.join(demoDir, 'crime_scene_tampered.png');
  const imgTamperedBuf = Buffer.from(PNG_BUFFER);
  imgTamperedBuf[30] ^= 0xAA;
  fs.writeFileSync(imgTamperedPath, imgTamperedBuf);

  // ─── Register Demo Records via Real Evidence Service ───────────────────────
  const demoRecordDefs = [
    {
      name: 'CCTV Footage',
      type: 'Video',
      desc: 'Surveillance video captured by overhead security camera outside north entrance.',
      file: {
        path: cctvPath,
        originalname: 'cctv_footage.webm',
        size: WEBM_BUFFER.length,
        mimetype: 'video/webm'
      },
      verifyFile: cctvPath,
      targetStatus: 'Verified'
    },
    {
      name: 'Crime Scene Image',
      type: 'Image',
      desc: 'High-resolution photograph of the primary physical evidence locus.',
      file: {
        path: imgPath,
        originalname: 'crime_scene.png',
        size: PNG_BUFFER.length,
        mimetype: 'image/png'
      },
      verifyFile: imgPath,
      targetStatus: 'Verified'
    },
    {
      name: 'Case Document',
      type: 'Document',
      desc: 'Initial forensic incident response and scene assessment document.',
      file: {
        path: docPath,
        originalname: 'case_document.txt',
        size: Buffer.byteLength(docContent),
        mimetype: 'text/plain'
      },
      verifyFile: null,
      targetStatus: 'Pending'
    },
    {
      name: 'Audio Recording',
      type: 'Audio',
      desc: 'Emergency dispatch audio recording of incoming incident call.',
      file: {
        path: audioOriginalPath,
        originalname: 'audio_recording.wav',
        size: wavOriginal.length,
        mimetype: 'audio/wav'
      },
      verifyFile: audioTamperedPath, // Verifying with tampered file creates genuine TAMPERED result
      targetStatus: 'Tampered'
    },
    {
      name: 'Witness Statement',
      type: 'Document',
      desc: 'Formal sworn eyewitness deposition taken during preliminary inquiry.',
      file: {
        path: witnessPath,
        originalname: 'witness_statement.txt',
        size: Buffer.byteLength(witnessContent),
        mimetype: 'text/plain'
      },
      verifyFile: witnessPath,
      targetStatus: 'Verified'
    }
  ];

  const seededRecords = [];

  for (const def of demoRecordDefs) {
    // Idempotency: Detect by isDemo + name
    let evidenceDoc = await Evidence.findOne({ isDemo: true, name: def.name, isDeleted: false });

    if (!evidenceDoc) {
      const tempUploadPath = path.join(demoDir, `temp_${path.basename(def.file.path)}`);
      fs.copyFileSync(def.file.path, tempUploadPath);

      const regResult = await createEvidenceRecord({
        file: {
          ...def.file,
          path: tempUploadPath
        },
        body: {
          name: def.name,
          type: def.type,
          description: `[DEMO] ${def.desc}`,
          isDemo: true
        },
        user: investigatorUser,
        req: null
      });
      try { if (fs.existsSync(tempUploadPath)) fs.unlinkSync(tempUploadPath); } catch (_) {}
      evidenceDoc = regResult.evidenceDoc;
      console.log(`  ✓ Registered demo evidence: ${evidenceDoc.evidenceId} - ${def.name} (${def.type})`);
    } else {
      console.log(`  ℹ Demo evidence already registered: ${evidenceDoc.evidenceId} - ${def.name}`);
    }

    // ─── Reach Target Status via Real Verification Service ───────────────────
    if (def.targetStatus === 'Verified') {
      if (evidenceDoc.status !== 'Verified') {
        const vResult = await executeVerification({
          identifier: evidenceDoc.evidenceId,
          filePath: def.verifyFile,
          originalname: def.file.originalname,
          fileSize: def.file.size,
          user: investigatorUser,
          req: null
        });
        evidenceDoc = await Evidence.findOne({ evidenceId: evidenceDoc.evidenceId });
        console.log(`  ✓ Verified ${evidenceDoc.evidenceId} with original file -> Status: ${vResult.result}`);
      } else {
        console.log(`  ℹ ${evidenceDoc.evidenceId} already in target status Verified`);
      }
    } else if (def.targetStatus === 'Tampered') {
      if (evidenceDoc.status !== 'Tampered') {
        const vResult = await executeVerification({
          identifier: evidenceDoc.evidenceId,
          filePath: def.verifyFile,
          originalname: def.file.originalname,
          fileSize: wavTampered.length,
          user: investigatorUser,
          req: null
        });
        evidenceDoc = await Evidence.findOne({ evidenceId: evidenceDoc.evidenceId });
        console.log(`  ✓ Verified ${evidenceDoc.evidenceId} with modified file -> Status: ${vResult.result}`);
      } else {
        console.log(`  ℹ ${evidenceDoc.evidenceId} already in target status Tampered`);
      }
    } else {
      // Pending - do nothing
      console.log(`  ℹ ${evidenceDoc.evidenceId} remaining in Pending status (target: Pending)`);
    }

    seededRecords.push({
      evidenceId: evidenceDoc.evidenceId,
      caseId: evidenceDoc.caseId,
      name: evidenceDoc.name,
      type: evidenceDoc.type,
      status: evidenceDoc.status,
      blockNumber: evidenceDoc.blockNumber,
      isDemo: evidenceDoc.isDemo
    });
  }

  // ─── Validate Both Cryptographic Chains ────────────────────────────────────
  console.log('\n🔒 Validating cryptographic integrity...');

  const chainResult = await validateChain();
  if (!chainResult.valid) {
    console.error('\n❌ FATAL: Blockchain validation failed after seeding!');
    console.error(JSON.stringify(chainResult.issues, null, 2));
    process.exit(1);
  }
  console.log(`  ✓ Blockchain validation: VALID (${chainResult.blocksChecked} blocks checked)`);

  const auditResult = await validateAuditChain();
  if (!auditResult.valid) {
    console.error('\n❌ FATAL: Audit chain validation failed after seeding!');
    console.error(JSON.stringify(auditResult.issues, null, 2));
    process.exit(1);
  }
  console.log(`  ✓ Audit chain validation: VALID (${auditResult.entriesChecked} entries checked)`);

  // ─── Print Terminal Summary ────────────────────────────────────────────────
  console.log('\n========================================================================');
  console.log('                     EVIDENCEGUARD DEMO SEED SUMMARY');
  console.log('========================================================================\n');

  console.log('DEMO ACCOUNTS (One per role):');
  console.log('------------------------------------------------------------------------');
  userCredentials.forEach(u => {
    console.log(`  Role    : ${u.role}`);
    console.log(`  Email   : ${u.email}`);
    console.log(`  Password: ${u.password} (${u.source})`);
    console.log('------------------------------------------------------------------------');
  });

  console.log('\nDEMO EVIDENCE RECORDS:');
  console.table(seededRecords);

  console.log('CRYPTOGRAPHIC INTEGRITY:');
  console.log(`  Blockchain Ledger : VALID (${chainResult.blocksChecked} blocks)`);
  console.log(`  Audit Hash-Chain  : VALID (${auditResult.entriesChecked} events)\n`);

  console.log('DEMO FILES & LIVE TAMPER GUIDE:');
  console.log(`  Files created in : ${demoDir}`);
  console.log('  Live demo guide  : scripts/demo-files-readme\n');
  console.log('========================================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

runSeed().catch(err => {
  console.error('\n❌ Seed failed with unhandled error:', err);
  process.exit(1);
});
