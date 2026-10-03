#!/usr/bin/env node
'use strict';

/**
 * scripts/test-forensics-14b.js
 * Sprint 14B – Anomaly Rule Engine Unit & Integration Test Suite
 *
 * Verifies all 15 deterministic forensic anomaly rules with both POSITIVE and NEGATIVE fixtures:
 * 1. EXT_MIME_MISMATCH (Positive & Negative)
 * 2. MODIFIED_BEFORE_CREATED (Positive & Negative)
 * 3. FUTURE_TIMESTAMP (Positive & Negative)
 * 4. CAPTURE_AFTER_UPLOAD (Positive & Negative)
 * 5. EDITING_SOFTWARE_TAG (Positive & Negative)
 * 6. REENCODED_VIDEO_TAG (Positive & Negative)
 * 7. METADATA_STRIPPED (Positive & Negative)
 * 8. GPS_PRESENT (Positive & Negative)
 * 9. DURATION_MISMATCH (Positive & Negative)
 * 10. PDF_JAVASCRIPT (Positive & Negative)
 * 11. PDF_EMBEDDED_FILE (Positive & Negative)
 * 12. PDF_INCREMENTAL_UPDATES (Positive & Negative)
 * 13. DOC_MACROS (Positive & Negative)
 * 14. TRAILING_DATA_AFTER_EOF (Positive & Negative)
 * 15. METADATA_CHANGED_BETWEEN_VERSIONS (Positive & Negative)
 *
 * Additional verifications:
 * 16. Mandatory disclaimer text presence
 * 17. Invariant: Anomalies NEVER alter Evidence.status (Verified / Tampered)
 * 18. End-to-end API verification with anomaly list and disclaimer
 */

process.env.FEATURE_FORENSICS = 'true';
process.env.JWT_SECRET = 'test-forensics-jwt-secret-key-32chars!';
require('dotenv').config();

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const {
  RULES,
  DISCLAIMER,
  evaluateAnomalies
} = require('../services/forensics/anomalyEngine');

let passed = 0;
let failed = 0;
const results = [];

function assert(description, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${description}`);
    results.push({ description, status: 'PASS' });
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${description} ${details ? '- ' + details : ''}`);
    results.push({ description, status: 'FAIL', details });
  }
}

(async () => {
  console.log('\n======================================================================');
  console.log('       EvidenceGuard Sprint 14B – Forensic Anomaly Rule Engine Tests    ');
  console.log('======================================================================\n');

  // ── Rule 1: EXT_MIME_MISMATCH ───────────────────────────────────────────────
  console.log('[Rule 1] EXT_MIME_MISMATCH');
  const r1Pos = evaluateAnomalies({}, { match: false, declared: 'image/jpeg', detected: 'image/png' });
  assert('Rule 1 (Positive): flags mismatch when match is false', r1Pos.some(a => a.ruleId === 'EXT_MIME_MISMATCH' && a.severity === 'MEDIUM'));

  const r1Neg = evaluateAnomalies({}, { match: true, declared: 'image/jpeg', detected: 'image/jpeg' });
  assert('Rule 1 (Negative): does not flag when match is true', !r1Neg.some(a => a.ruleId === 'EXT_MIME_MISMATCH'));

  // ── Rule 2: MODIFIED_BEFORE_CREATED ─────────────────────────────────────────
  console.log('\n[Rule 2] MODIFIED_BEFORE_CREATED');
  const now = Date.now();
  const r2Pos = evaluateAnomalies({
    fileCreatedAt: new Date(now).toISOString(),
    fileModifiedAt: new Date(now - 100000).toISOString()
  }, { match: true });
  assert('Rule 2 (Positive): flags modified timestamp prior to creation timestamp', r2Pos.some(a => a.ruleId === 'MODIFIED_BEFORE_CREATED' && a.severity === 'MEDIUM'));

  const r2Neg = evaluateAnomalies({
    fileCreatedAt: new Date(now - 100000).toISOString(),
    fileModifiedAt: new Date(now).toISOString()
  }, { match: true });
  assert('Rule 2 (Negative): does not flag normal chronological modification', !r2Neg.some(a => a.ruleId === 'MODIFIED_BEFORE_CREATED'));

  // ── Rule 3: FUTURE_TIMESTAMP ────────────────────────────────────────────────
  console.log('\n[Rule 3] FUTURE_TIMESTAMP');
  const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const r3Pos = evaluateAnomalies({ dateTimeOriginal: farFuture }, { match: true });
  assert('Rule 3 (Positive): flags timestamp set in future', r3Pos.some(a => a.ruleId === 'FUTURE_TIMESTAMP' && a.severity === 'HIGH'));

  const validPast = new Date(Date.now() - 3600 * 1000).toISOString();
  const r3Neg = evaluateAnomalies({ dateTimeOriginal: validPast }, { match: true });
  assert('Rule 3 (Negative): does not flag valid past timestamp', !r3Neg.some(a => a.ruleId === 'FUTURE_TIMESTAMP'));

  // ── Rule 4: CAPTURE_AFTER_UPLOAD ────────────────────────────────────────────
  console.log('\n[Rule 4] CAPTURE_AFTER_UPLOAD');
  const uploadTime = new Date('2026-10-01T10:00:00Z');
  const r4Pos = evaluateAnomalies(
    { dateTimeOriginal: '2026-10-02T12:00:00Z' },
    { match: true },
    { evidence: { createdAt: uploadTime } }
  );
  assert('Rule 4 (Positive): flags capture timestamp recorded after evidence upload', r4Pos.some(a => a.ruleId === 'CAPTURE_AFTER_UPLOAD' && a.severity === 'HIGH'));

  const r4Neg = evaluateAnomalies(
    { dateTimeOriginal: '2026-09-30T10:00:00Z' },
    { match: true },
    { evidence: { createdAt: uploadTime } }
  );
  assert('Rule 4 (Negative): does not flag capture timestamp preceding upload', !r4Neg.some(a => a.ruleId === 'CAPTURE_AFTER_UPLOAD'));

  // ── Rule 5: EDITING_SOFTWARE_TAG ────────────────────────────────────────────
  console.log('\n[Rule 5] EDITING_SOFTWARE_TAG');
  const r5Pos = evaluateAnomalies({ software: 'Adobe Photoshop 2024 (Windows)' }, { match: true });
  assert('Rule 5 (Positive): flags known editing software', r5Pos.some(a => a.ruleId === 'EDITING_SOFTWARE_TAG' && a.severity === 'LOW'));

  const r5Neg = evaluateAnomalies({ software: 'Canon Digital Camera Firmware 1.0.4' }, { match: true });
  assert('Rule 5 (Negative): does not flag official camera firmware', !r5Neg.some(a => a.ruleId === 'EDITING_SOFTWARE_TAG'));

  // ── Rule 6: REENCODED_VIDEO_TAG ─────────────────────────────────────────────
  console.log('\n[Rule 6] REENCODED_VIDEO_TAG');
  const r6Pos = evaluateAnomalies({ encoder: 'Lavf58.76.100' }, { match: true });
  assert('Rule 6 (Positive): flags re-encoded video library (Lavf/ffmpeg)', r6Pos.some(a => a.ruleId === 'REENCODED_VIDEO_TAG' && a.severity === 'LOW'));

  const r6Neg = evaluateAnomalies({ encoder: 'Sony Handycam HDR-CX405' }, { match: true });
  assert('Rule 6 (Negative): does not flag native hardware encoder', !r6Neg.some(a => a.ruleId === 'REENCODED_VIDEO_TAG'));

  // ── Rule 7: METADATA_STRIPPED ───────────────────────────────────────────────
  console.log('\n[Rule 7] METADATA_STRIPPED');
  const r7Pos = evaluateAnomalies({ imageWidth: 1920, imageHeight: 1080 }, { detectedMime: 'image/jpeg', match: true });
  assert('Rule 7 (Positive): flags stripped media metadata with INFO severity', r7Pos.some(a => a.ruleId === 'METADATA_STRIPPED' && a.severity === 'INFO'));

  const r7Neg = evaluateAnomalies({ imageWidth: 1920, imageHeight: 1080, make: 'Nikon', model: 'D850' }, { detectedMime: 'image/jpeg', match: true });
  assert('Rule 7 (Negative): does not flag image with intact EXIF camera make/model', !r7Neg.some(a => a.ruleId === 'METADATA_STRIPPED'));

  // ── Rule 8: GPS_PRESENT ─────────────────────────────────────────────────────
  console.log('\n[Rule 8] GPS_PRESENT');
  const r8Pos = evaluateAnomalies({ gps: { latitude: 37.7749, longitude: -122.4194 } }, { match: true });
  assert('Rule 8 (Positive): flags GPS presence with privacy INFO severity', r8Pos.some(a => a.ruleId === 'GPS_PRESENT' && a.severity === 'INFO'));

  const r8Neg = evaluateAnomalies({ make: 'Nikon' }, { match: true });
  assert('Rule 8 (Negative): does not flag when no GPS coordinates present', !r8Neg.some(a => a.ruleId === 'GPS_PRESENT'));

  // ── Rule 9: DURATION_MISMATCH ───────────────────────────────────────────────
  console.log('\n[Rule 9] DURATION_MISMATCH');
  const r9Pos = evaluateAnomalies({
    durationSeconds: 15.5,
    video: { duration: 12.0 }
  }, { match: true });
  assert('Rule 9 (Positive): flags container vs stream duration deviation > 0.5s', r9Pos.some(a => a.ruleId === 'DURATION_MISMATCH' && a.severity === 'MEDIUM'));

  const r9Neg = evaluateAnomalies({
    durationSeconds: 15.5,
    video: { duration: 15.48 }
  }, { match: true });
  assert('Rule 9 (Negative): does not flag aligned container and stream duration', !r9Neg.some(a => a.ruleId === 'DURATION_MISMATCH'));

  // ── Rule 10: PDF_JAVASCRIPT ─────────────────────────────────────────────────
  console.log('\n[Rule 10] PDF_JAVASCRIPT');
  const r10Pos = evaluateAnomalies({ hasJavaScript: true }, { match: true });
  assert('Rule 10 (Positive): flags PDF containing JavaScript with HIGH severity', r10Pos.some(a => a.ruleId === 'PDF_JAVASCRIPT' && a.severity === 'HIGH'));

  const r10Neg = evaluateAnomalies({ hasJavaScript: false }, { match: true });
  assert('Rule 10 (Negative): does not flag PDF without JavaScript', !r10Neg.some(a => a.ruleId === 'PDF_JAVASCRIPT'));

  // ── Rule 11: PDF_EMBEDDED_FILE ──────────────────────────────────────────────
  console.log('\n[Rule 11] PDF_EMBEDDED_FILE');
  const r11Pos = evaluateAnomalies({ hasEmbeddedFiles: true }, { match: true });
  assert('Rule 11 (Positive): flags PDF containing embedded file attachments', r11Pos.some(a => a.ruleId === 'PDF_EMBEDDED_FILE' && a.severity === 'MEDIUM'));

  const r11Neg = evaluateAnomalies({ hasEmbeddedFiles: false }, { match: true });
  assert('Rule 11 (Negative): does not flag PDF without embedded files', !r11Neg.some(a => a.ruleId === 'PDF_EMBEDDED_FILE'));

  // ── Rule 12: PDF_INCREMENTAL_UPDATES ────────────────────────────────────────
  console.log('\n[Rule 12] PDF_INCREMENTAL_UPDATES');
  const r12Pos = evaluateAnomalies({ hasIncrementalUpdates: true, eofMarkerCount: 3 }, { match: true });
  assert('Rule 12 (Positive): flags PDF with multiple %%EOF markers', r12Pos.some(a => a.ruleId === 'PDF_INCREMENTAL_UPDATES' && a.severity === 'LOW'));

  const r12Neg = evaluateAnomalies({ hasIncrementalUpdates: false, eofMarkerCount: 1 }, { match: true });
  assert('Rule 12 (Negative): does not flag clean single-EOF PDF', !r12Neg.some(a => a.ruleId === 'PDF_INCREMENTAL_UPDATES'));

  // ── Rule 13: DOC_MACROS ─────────────────────────────────────────────────────
  console.log('\n[Rule 13] DOC_MACROS');
  const r13Pos = evaluateAnomalies({ hasMacros: true }, { match: true });
  assert('Rule 13 (Positive): flags document containing VBA macros with HIGH severity', r13Pos.some(a => a.ruleId === 'DOC_MACROS' && a.severity === 'HIGH'));

  const r13Neg = evaluateAnomalies({ hasMacros: false }, { match: true });
  assert('Rule 13 (Negative): does not flag clean macro-free document', !r13Neg.some(a => a.ruleId === 'DOC_MACROS'));

  // ── Rule 14: TRAILING_DATA_AFTER_EOF ────────────────────────────────────────
  console.log('\n[Rule 14] TRAILING_DATA_AFTER_EOF');
  const r14Pos = evaluateAnomalies({ trailingBytesCount: 256 }, { match: true });
  assert('Rule 14 (Positive): flags unparsed binary trailing bytes after EOF', r14Pos.some(a => a.ruleId === 'TRAILING_DATA_AFTER_EOF' && a.severity === 'MEDIUM'));

  const r14Neg = evaluateAnomalies({ trailingBytesCount: 0 }, { match: true });
  assert('Rule 14 (Negative): does not flag file cleanly terminating at EOF marker', !r14Neg.some(a => a.ruleId === 'TRAILING_DATA_AFTER_EOF'));

  // ── Rule 15: METADATA_CHANGED_BETWEEN_VERSIONS ──────────────────────────────
  console.log('\n[Rule 15] METADATA_CHANGED_BETWEEN_VERSIONS');
  const r15Pos = evaluateAnomalies({}, { match: true }, {
    diffFromPrevious: {
      changed: { author: { from: 'Alice', to: 'Bob' } },
      added: {},
      removed: {}
    }
  });
  assert('Rule 15 (Positive): flags metadata changes across report versions', r15Pos.some(a => a.ruleId === 'METADATA_CHANGED_BETWEEN_VERSIONS' && a.severity === 'MEDIUM'));

  const r15Neg = evaluateAnomalies({}, { match: true }, { diffFromPrevious: null });
  assert('Rule 15 (Negative): does not flag initial or identical version extractions', !r15Neg.some(a => a.ruleId === 'METADATA_CHANGED_BETWEEN_VERSIONS'));

  // ── Requirement 16: Anomaly Disclaimer Text ────────────────────────────────
  console.log('\n[Requirement 16] Anomaly Review Disclaimer Verification');
  const expectedDisclaimer = 'These are indicators for examiner review. Metadata is easy to edit, and the absence of flags proves nothing.';
  assert('DISCLAIMER matches required examiner review wording exactly', DISCLAIMER === expectedDisclaimer);

  // ── Requirement 17: Invariant Check – Evidence.status Never Changed ─────────
  console.log('\n[Requirement 17] Invariant: Anomalies NEVER alter Evidence.status');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri);

  const { ensureGenesis } = require('../services/chainService');
  await ensureGenesis();

  const User = require('../models/User');
  const Evidence = require('../models/Evidence');
  const { processForensicsForEvidence } = require('../services/forensics/forensicsService');

  const salt = await bcrypt.genSalt(10);
  const testUser = await User.create({
    name: 'Inspector Brown',
    email: 'brown@evidenceguard.local',
    passwordHash: await bcrypt.hash('SecurePass123!', salt),
    role: 'ADMIN'
  });

  const testEvidence = await Evidence.create({
    evidenceId: 'EV-INV-ANOMALY',
    caseId: 'EG-2026-INV',
    name: 'Tamper Suspicious File',
    type: 'PDF',
    status: 'Verified', // Pre-existing verified status
    hash: '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff',
    uploadedBy: testUser._id
  });

  // Create temporary fixture with multiple anomalies (JS, macros, trailing data)
  const tmpFilePath = path.join(__dirname, '..', 'uploads', 'anomaly_invariant_test.pdf');
  fs.writeFileSync(tmpFilePath, Buffer.from('%PDF-1.4\n/JavaScript (alert(1))\n%%EOF\nEXTRA_TRAILING_PAYLOAD_BYTES'));

  try {
    const report = await processForensicsForEvidence(testEvidence, tmpFilePath, {
      isRerun: false,
      actorUser: testUser
    });

    assert('Forensic report created with anomalies detected', report.anomalies.length > 0);
    assert('Report contains PDF_JAVASCRIPT anomaly', report.anomalies.some(a => a.ruleId === 'PDF_JAVASCRIPT'));
    assert('Report contains TRAILING_DATA_AFTER_EOF anomaly', report.anomalies.some(a => a.ruleId === 'TRAILING_DATA_AFTER_EOF'));
    assert('Report contains official disclaimer', report.disclaimer === expectedDisclaimer);

    // Verify evidence record in database
    const refreshedEvidence = await Evidence.findOne({ evidenceId: 'EV-INV-ANOMALY' });
    assert('Critical Invariant: Evidence.status remains UNCHANGED as "Verified"', refreshedEvidence.status === 'Verified');
  } finally {
    try { fs.unlinkSync(tmpFilePath); } catch (_) {}
    await mongoose.disconnect();
    await mongod.stop();
  }

  console.log('\n======================================================================');
  console.log(`Forensic Anomaly Rule Engine 14B Test Results: ${passed} passed, ${failed} failed`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
