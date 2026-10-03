'use strict';

/**
 * scripts/test-notifications-13a.js
 * Sprint 13A – Event Pipeline, Notification Outbox & Email Service Test Suite
 */

process.env.FEATURE_NOTIFICATIONS = 'true';
process.env.FEATURE_CUSTODY = 'true';
process.env.JWT_SECRET = 'test-notification-jwt-secret-32chars!';
process.env.PORT = '3000';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1025';
require('dotenv').config();

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const CustodyEvent = require('../models/CustodyEvent');
const eventBus = require('../services/eventBus');
const { NOTIFICATION_TYPES, RULES, COALESCE_WINDOW_MS } = require('../config/notificationRules');
const { dispatchNotification, trackFailedLogin, initNotificationDispatcher } = require('../services/notificationDispatcher');
const {
  claimNextJob,
  processJob,
  processPendingNotifications,
  BACKOFF_DELAYS_MS,
  MAX_ATTEMPTS
} = require('../services/notificationWorker');
const {
  stripCrLf,
  escapeHtml,
  sanitizeContentText,
  renderPlainTextEmail,
  renderHtmlEmail,
  verifySmtpConnection
} = require('../services/emailService');

let passed = 0;
let failed = 0;

function assert(condition, description, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${description}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${description} ${details ? '— ' + details : ''}`);
  }
}

async function runTests() {
  console.log('\n======================================================================');
  console.log('       EvidenceGuard Sprint 13A – Notification Pipeline Test Suite    ');
  console.log('======================================================================\n');

  // --- [1] Setup in-memory MongoDB environment ---
  console.log('--- [1] Environment Setup & In-Memory MongoDB ---');
  let mongod = null;
  if (!process.env.TEST_MONGODB_URI) {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
  } else {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
  }

  await mongoose.connect(process.env.MONGODB_URI);

  // Sync schema indexes (including compound unique index on dedupeKey, userId, channel)
  await Promise.all([
    User.syncIndexes(),
    Notification.syncIndexes(),
    AuditLog.syncIndexes(),
    CustodyEvent.syncIndexes()
  ]);

  initNotificationDispatcher();

  const passwordHash = await bcrypt.hash('SecretPass123!', 10);
  const admin1 = await User.create({ name: 'Admin Chief', email: 'admin1@agency.gov', passwordHash, role: 'ADMIN', isActive: true });
  const admin2 = await User.create({ name: 'Admin Secondary', email: 'admin2@agency.gov', passwordHash, role: 'ADMIN', isActive: true });
  const invUploader = await User.create({ name: 'Detective Intake', email: 'uploader@agency.gov', passwordHash, role: 'INVESTIGATOR', isActive: true });
  const invCustodian = await User.create({ name: 'Detective Custody', email: 'custodian@agency.gov', passwordHash, role: 'INVESTIGATOR', isActive: true });
  const viewer = await User.create({ name: 'Auditor Viewer', email: 'viewer@agency.gov', passwordHash, role: 'VIEWER', isActive: true });

  assert(true, 'Test users and indexes initialized successfully');

  // --- [2] Email Security, Sanitization & Header Injection Defense ---
  console.log('\n--- [2] Email Template & Header Injection Defenses ---');

  // CR/LF injection test
  const dirtyHeader = 'admin@agency.gov\r\nBcc: evil@hacker.com\r\nSubject: Injected';
  const sanitizedHeader = stripCrLf(dirtyHeader);
  assert(!sanitizedHeader.includes('\r') && !sanitizedHeader.includes('\n'), 'CR/LF stripped from headers', sanitizedHeader);
  assert(sanitizedHeader === 'admin@agency.gov Bcc: evil@hacker.com Subject: Injected', 'Headers concatenated cleanly without breaks');

  // HTML entity escaping
  const xssPayload = '<script>alert("xss")</script>&"\'';
  const escapedXss = escapeHtml(xssPayload);
  assert(!escapedXss.includes('<script>') && escapedXss.includes('&lt;script&gt;'), 'HTML entities properly escaped', escapedXss);

  // Zero-leakage check on rendered templates
  const fakeEvidenceHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const fakeIp = '192.168.1.100';
  const fakeFileName = 'confidential_witness_confession.mp4';
  const fakeFileDesc = 'Contains classified confession of suspect';

  const plainEmail = renderPlainTextEmail({
    severity: 'CRITICAL',
    title: 'Tamper Alert on EV-0001',
    body: `Integrity check failed. Hash: ${fakeEvidenceHash}. IP: ${fakeIp}. File: ${fakeFileName}. Desc: ${fakeFileDesc}`,
    evidenceId: 'EV-0001',
    caseId: 'EG-2026-0001',
    link: 'http://localhost:3000/evidence-details.html?id=EV-0001'
  });

  const htmlEmail = renderHtmlEmail({
    severity: 'CRITICAL',
    title: 'Tamper Alert on EV-0001',
    body: `Integrity check failed. Hash: ${fakeEvidenceHash}. IP: ${fakeIp}. File: ${fakeFileName}. Desc: ${fakeFileDesc}`,
    evidenceId: 'EV-0001',
    caseId: 'EG-2026-0001',
    link: 'http://localhost:3000/evidence-details.html?id=EV-0001'
  });

  assert(plainEmail.includes('EV-0001') && plainEmail.includes('EG-2026-0001'), 'Plain-text email contains Evidence ID and Case ID');
  assert(!plainEmail.includes(fakeEvidenceHash) && plainEmail.includes('[REDACTED_HASH]'), 'Plain-text email redacts 64-char SHA-256 hash');
  assert(!plainEmail.includes(fakeIp) && plainEmail.includes('[REDACTED_IP]'), 'Plain-text email redacts IP address');
  assert(htmlEmail.includes('EV-0001') && htmlEmail.includes('EG-2026-0001'), 'HTML email contains Evidence ID and Case ID');
  assert(!htmlEmail.includes(fakeEvidenceHash), 'HTML email never contains raw 64-char hash');
  assert(!htmlEmail.includes(fakeIp), 'HTML email never contains raw IP address');

  // SMTP Startup verification test (warns, does not throw or crash)
  const smtpResult = await verifySmtpConnection();
  assert(typeof smtpResult === 'boolean', 'verifySmtpConnection() executes safely without throwing an exception');

  // --- [3] Rule 1: TAMPERED Verification Event ---
  console.log('\n--- [3] Rule 1: TAMPERED Verification Notification & Recipient Routing ---');
  await CustodyEvent.create({
    custodyId: 'CUST-2026-0001',
    evidenceId: 'EV-0001',
    seq: 1,
    type: 'COLLECTED',
    actorUserId: invUploader._id,
    toUserId: invCustodian._id,
    reason: 'Initial custody assigned to Detective Custody',
    prevHash: '0000000000000000',
    entryHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });

  const tamperEventData = {
    evidence: {
      evidenceId: 'EV-0001',
      caseId: 'EG-2026-0001',
      uploadedBy: invUploader._id
    }
  };

  const tamperNotifications = await dispatchNotification(NOTIFICATION_TYPES.TAMPER_ALERT, tamperEventData);
  assert(tamperNotifications.length > 0, 'Notifications created for TAMPER_ALERT');

  const tamperRecipients = await Notification.find({ type: NOTIFICATION_TYPES.TAMPER_ALERT, channel: 'EMAIL' });
  const recipientUserIds = tamperRecipients.map(n => String(n.userId));

  assert(recipientUserIds.includes(String(invUploader._id)), 'Uploader received TAMPER_ALERT');
  assert(recipientUserIds.includes(String(invCustodian._id)), 'Current Custodian received TAMPER_ALERT');
  assert(recipientUserIds.includes(String(admin1._id)), 'Admin 1 received TAMPER_ALERT');
  assert(recipientUserIds.includes(String(admin2._id)), 'Admin 2 received TAMPER_ALERT');
  assert(!recipientUserIds.includes(String(viewer._id)), 'VIEWER role did NOT receive CRITICAL alert');

  // Verify severity & status
  assert(tamperRecipients[0].severity === 'CRITICAL', 'TAMPER_ALERT severity is CRITICAL');
  assert(tamperRecipients[0].status === 'QUEUED', 'Email notification initially QUEUED in outbox');

  // --- [4] Coalescing & Deduplication (Same type + evidence within 10 minutes) ---
  console.log('\n--- [4] Coalescing & Deduplication Within 10-Minute Window ---');
  const countBefore = await Notification.countDocuments({ type: NOTIFICATION_TYPES.TAMPER_ALERT });
  // Duplicate tamper event emitted 2 minutes later
  await dispatchNotification(NOTIFICATION_TYPES.TAMPER_ALERT, tamperEventData);
  const countAfter = await Notification.countDocuments({ type: NOTIFICATION_TYPES.TAMPER_ALERT });
  assert(countBefore === countAfter, 'Second notification within 10 minutes coalesced (no duplicates created)', `Before: ${countBefore}, After: ${countAfter}`);

  // Test compound unique index explicitly
  let duplicateIndexEnforced = false;
  try {
    await Notification.create({
      notificationId: 'NOTIF-2026-DUPE-TEST',
      userId: invUploader._id,
      channel: 'EMAIL',
      type: NOTIFICATION_TYPES.TAMPER_ALERT,
      severity: 'CRITICAL',
      title: 'Duplicate test',
      body: 'Duplicate body',
      dedupeKey: tamperRecipients.find(n => String(n.userId) === String(invUploader._id)).dedupeKey,
      status: 'QUEUED'
    });
  } catch (err) {
    if (err.code === 11000) duplicateIndexEnforced = true;
  }
  assert(duplicateIndexEnforced, 'MongoDB compound unique index on (dedupeKey, userId, channel) strictly enforced');

  // --- [5] Rule 2: Ledger or Audit Chain INVALID ---
  console.log('\n--- [5] Rule 2: Chain INVALID -> ADMINs (CRITICAL) ---');
  await dispatchNotification(NOTIFICATION_TYPES.CHAIN_INVALID, { chainType: 'BLOCKCHAIN', issues: ['Mismatch at block #1'] });
  const chainNotifs = await Notification.find({ type: NOTIFICATION_TYPES.CHAIN_INVALID, channel: 'EMAIL' });
  const chainRecipients = chainNotifs.map(n => String(n.userId));
  assert(chainRecipients.includes(String(admin1._id)) && chainRecipients.includes(String(admin2._id)), 'All ADMINs received CHAIN_INVALID alert');
  assert(!chainRecipients.includes(String(invUploader._id)), 'Investigator excluded from system chain invalid alert');
  assert(chainNotifs[0].severity === 'CRITICAL', 'CHAIN_INVALID severity is CRITICAL');

  // --- [6] Rule 3: ROLE_CHANGED -> Affected User + ADMINs (INFO) ---
  console.log('\n--- [6] Rule 3: ROLE_CHANGED -> Affected User + ADMINs (INFO) ---');
  await dispatchNotification(NOTIFICATION_TYPES.ROLE_CHANGED, { user: invUploader, oldRole: 'INVESTIGATOR', newRole: 'ADMIN' });
  const roleNotifs = await Notification.find({ type: NOTIFICATION_TYPES.ROLE_CHANGED, channel: 'EMAIL' });
  const roleRecipients = roleNotifs.map(n => String(n.userId));
  assert(roleRecipients.includes(String(invUploader._id)), 'Affected user received ROLE_CHANGED notification');
  assert(roleRecipients.includes(String(admin1._id)), 'Admin received copy of ROLE_CHANGED');
  assert(roleNotifs[0].severity === 'INFO', 'ROLE_CHANGED severity is INFO');

  // --- [7] Rule 4: User Deactivated -> ADMINs (INFO) ---
  console.log('\n--- [7] Rule 4: User Deactivated -> ADMINs (INFO) ---');
  await dispatchNotification(NOTIFICATION_TYPES.USER_DEACTIVATED, { user: viewer });
  const deactNotifs = await Notification.find({ type: NOTIFICATION_TYPES.USER_DEACTIVATED, channel: 'EMAIL' });
  const deactRecipients = deactNotifs.map(n => String(n.userId));
  assert(deactRecipients.includes(String(admin1._id)) && deactRecipients.includes(String(admin2._id)), 'All ADMINs received USER_DEACTIVATED notification');
  assert(!deactRecipients.includes(String(viewer._id)), 'Deactivated user did not receive alert');

  // --- [8] Rule 5: 5 Failed Logins in 15 Minutes -> Account Owner + ADMINs (WARNING) ---
  console.log('\n--- [8] Rule 5: Failed Logins Sliding Window (5 in 15m) ---');
  const testEmail = 'target_investigator@agency.gov';
  const targetUser = await User.create({ name: 'Target Officer', email: testEmail, passwordHash, role: 'INVESTIGATOR', isActive: true });

  assert(!trackFailedLogin(testEmail), 'Attempt 1 does not trigger threshold');
  assert(!trackFailedLogin(testEmail), 'Attempt 2 does not trigger threshold');
  assert(!trackFailedLogin(testEmail), 'Attempt 3 does not trigger threshold');
  assert(!trackFailedLogin(testEmail), 'Attempt 4 does not trigger threshold');
  const reached = trackFailedLogin(testEmail);
  assert(reached === true, 'Attempt 5 triggers threshold');

  await dispatchNotification(NOTIFICATION_TYPES.FAILED_LOGINS, { email: testEmail });
  const loginNotifs = await Notification.find({ type: NOTIFICATION_TYPES.FAILED_LOGINS, channel: 'EMAIL' });
  const loginRecipients = loginNotifs.map(n => String(n.userId));
  assert(loginRecipients.includes(String(targetUser._id)), 'Target account owner received FAILED_LOGINS warning');
  assert(loginRecipients.includes(String(admin1._id)), 'Admin received FAILED_LOGINS warning');
  assert(loginNotifs[0].severity === 'WARNING', 'FAILED_LOGINS severity is WARNING');

  // --- [9] Rule 6: Incoming Custody Transfer -> Recipient (INFO) ---
  console.log('\n--- [9] Rule 6: Incoming Custody Transfer -> Recipient (INFO) ---');
  await dispatchNotification(NOTIFICATION_TYPES.CUSTODY_TRANSFER, {
    evidenceId: 'EV-0042',
    toUserId: invCustodian._id
  });
  const transferNotifs = await Notification.find({ type: NOTIFICATION_TYPES.CUSTODY_TRANSFER, channel: 'EMAIL' });
  assert(transferNotifs.length === 1 && String(transferNotifs[0].userId) === String(invCustodian._id), 'Custody transfer notification dispatched exclusively to recipient');
  assert(transferNotifs[0].severity === 'INFO', 'CUSTODY_TRANSFER severity is INFO');

  // --- [10] Outbox Worker: Atomic Lease Claiming & Single-Flight ---
  console.log('\n--- [10] Outbox Worker: Atomic Lease & Single-Flight ---');
  // Clear previous notifications so worker tests run in clean isolation
  await Notification.deleteMany({});

  const testNotif = await Notification.create({
    notificationId: 'NOTIF-2026-WORKER-01',
    userId: admin1._id,
    channel: 'EMAIL',
    type: 'WORKER_TEST',
    severity: 'INFO',
    title: 'Worker Test',
    body: 'Testing worker lease claiming',
    dedupeKey: `WORKER_TEST:${Date.now()}`,
    status: 'QUEUED',
    nextAttemptAt: new Date(Date.now() - 5000)
  });

  const claimedJob1 = await claimNextJob();
  assert(claimedJob1 !== null && claimedJob1.notificationId === testNotif.notificationId, 'Worker claimed ready QUEUED job');
  assert(claimedJob1.status === 'SENDING', 'Claimed job status set to SENDING');
  assert(claimedJob1.leaseUntil > new Date(), 'Claimed job has active leaseUntil in future');
  assert(claimedJob1.attempts === 1, 'Claimed job atomically incremented attempts to 1');

  // Concurrent claim attempt while lease is active
  const parallelClaim = await Notification.findOne({
    _id: testNotif._id,
    $or: [
      { status: 'QUEUED', nextAttemptAt: { $lte: new Date() } },
      { status: 'SENDING', leaseUntil: { $lte: new Date() } }
    ]
  });
  assert(parallelClaim === null, 'Parallel worker cannot claim in-flight job under active lease (single-flight guaranteed)');

  // --- [11] Worker Crash Recovery Simulation ---
  console.log('\n--- [11] Worker Crash Recovery Simulation ---');
  // Simulate worker crash: job left in SENDING with expired lease
  await Notification.updateOne(
    { _id: testNotif._id },
    {
      $set: {
        status: 'SENDING',
        leaseUntil: new Date(Date.now() - 10000) // Expired 10 seconds ago
      }
    }
  );

  const recoveredJob = await claimNextJob();
  assert(recoveredJob !== null && recoveredJob.notificationId === testNotif.notificationId, 'Worker recovered abandoned job after lease expired');
  assert(recoveredJob.attempts === 2, 'Attempts incremented on recovered claim');

  // --- [12] Worker Exponential Backoff & Max Attempts Retry (1m, 5m, 30m, 2h) ---
  console.log('\n--- [12] Worker Backoff Schedule & Failure Logging ---');
  assert(BACKOFF_DELAYS_MS[0] === 60 * 1000, 'Attempt 1 backoff is 1 minute (60s)');
  assert(BACKOFF_DELAYS_MS[1] === 5 * 60 * 1000, 'Attempt 2 backoff is 5 minutes (300s)');
  assert(BACKOFF_DELAYS_MS[2] === 30 * 60 * 1000, 'Attempt 3 backoff is 30 minutes (1800s)');
  assert(BACKOFF_DELAYS_MS[3] === 2 * 60 * 60 * 1000, 'Attempt 4 backoff is 2 hours (7200s)');

  // Simulate failed attempts
  const missingUserId = new mongoose.Types.ObjectId();
  const failJob = await Notification.create({
    notificationId: 'NOTIF-2026-FAIL-TEST',
    userId: missingUserId,
    channel: 'EMAIL',
    type: 'FAIL_TEST',
    severity: 'WARNING',
    title: 'Failure Test',
    body: 'Testing retry backoff',
    dedupeKey: `FAIL_TEST:${Date.now()}`,
    status: 'QUEUED',
    attempts: 4, // Next failure will be attempt 5 (terminal)
    nextAttemptAt: new Date(Date.now() - 1000)
  });

  const claimedForFail = await claimNextJob();
  assert(claimedForFail.attempts === 5, 'Job claimed on 5th attempt');

  // Process job on 5th attempt with missing user to trigger terminal failure safely
  await processJob(claimedForFail);

  const updatedFailJob = await Notification.findById(claimedForFail._id);
  assert(updatedFailJob.status === 'FAILED', 'Notification marked FAILED after reaching 5 attempts');
  assert(updatedFailJob.lastError !== null, 'Safe error message recorded in lastError');

  // Confirm NOTIFICATION_FAILED logged in audit trail
  const failAudit = await AuditLog.findOne({ action: 'NOTIFICATION_FAILED' }).sort({ _id: -1 });
  assert(failAudit !== null, 'NOTIFICATION_FAILED action successfully committed to audit log chain');

  // --- [13] Overall Test Suite Summary ---
  console.log('\n======================================================================');
  console.log(`SPRINT 13A TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  await mongoose.connection.close();
  if (mongod) await mongod.stop();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
