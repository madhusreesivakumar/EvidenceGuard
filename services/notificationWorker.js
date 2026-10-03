'use strict';

/**
 * services/notificationWorker.js
 * Sprint 13A – Resilient Outbox Worker
 *
 * Implements atomic lease-based job claiming, exponential backoff retries,
 * crash recovery, single-flight per job, and audit trail error logging.
 */

const { unscoped } = require('./tenantScope');
const RawNotification = require('../models/Notification');
const RawUser = require('../models/User');
const Notification = unscoped(RawNotification);
const User = unscoped(RawUser);
const { sendNotificationEmail, stripCrLf } = require('./emailService');
const { logEvent } = require('./auditService');

const LEASE_MS = 60 * 1000; // 60 seconds per claim lease
const BACKOFF_DELAYS_MS = [
  60 * 1000,              // 1 min after attempt 1
  5 * 60 * 1000,          // 5 min after attempt 2
  30 * 60 * 1000,         // 30 min after attempt 3
  2 * 60 * 60 * 1000      // 2 hours after attempt 4
];
const MAX_ATTEMPTS = 5;

let workerInterval = null;
let isProcessing = false;

/**
 * Atomically claims one ready notification job with a lease
 */
async function claimNextJob() {
  const now = new Date();

  return await Notification.findOneAndUpdate(
    {
      channel: 'EMAIL',
      $or: [
        { status: 'QUEUED', nextAttemptAt: { $lte: now } },
        { status: 'SENDING', leaseUntil: { $lte: now } } // Crash / timeout recovery
      ]
    },
    {
      $set: {
        status: 'SENDING',
        leaseUntil: new Date(Date.now() + LEASE_MS)
      },
      $inc: { attempts: 1 }
    },
    { returnDocument: 'after' }
  );
}

/**
 * Process a single notification job
 */
async function processJob(job) {
  if (!job) return false;

  try {
    const user = await User.findById(job.userId).select('name email isActive').lean();
    if (!user || !user.email) {
      const errMsg = 'Recipient user not found or has no email address';
      await Notification.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'FAILED',
            lastError: errMsg,
            leaseUntil: null
          }
        }
      );
      await logEvent({
        action: 'NOTIFICATION_FAILED',
        description: `Notification ${job.notificationId} (${job.type}) failed: ${errMsg}`,
        evidenceId: job.evidenceId,
        caseId: job.caseId
      });
      return true;
    }

    // Attempt to deliver email via Nodemailer
    await sendNotificationEmail(user.email, job);

    // Delivery succeeded
    await Notification.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'SENT',
          sentAt: new Date(),
          leaseUntil: null,
          lastError: null
        }
      }
    );
    return true;
  } catch (err) {
    const safeErrorMsg = stripCrLf(err.message || 'SMTP transmission failure').slice(0, 450);

    if (job.attempts >= MAX_ATTEMPTS) {
      // Final failure after 5 attempts
      await Notification.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'FAILED',
            lastError: safeErrorMsg,
            leaseUntil: null
          }
        }
      );

      // Log failure in audit chain
      try {
        await logEvent({
          action: 'NOTIFICATION_FAILED',
          description: `Notification ${job.notificationId} permanently failed after ${job.attempts} attempts: ${safeErrorMsg}`,
          evidenceId: job.evidenceId,
          caseId: job.caseId
        });
      } catch (auditErr) {
        console.error('[WORKER AUDIT LOG ERROR]', auditErr);
      }
    } else {
      // Schedule next retry with backoff: 1 min, 5 min, 30 min, 2 h
      const delay = BACKOFF_DELAYS_MS[job.attempts - 1] || (2 * 60 * 60 * 1000);
      const nextAttemptAt = new Date(Date.now() + delay);

      await Notification.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'QUEUED',
            nextAttemptAt,
            lastError: safeErrorMsg,
            leaseUntil: null
          }
        }
      );
    }

    return true;
  }
}

/**
 * Drain eligible pending notifications up to maxJobs
 */
async function processPendingNotifications({ maxJobs = 50 } = {}) {
  let count = 0;
  while (count < maxJobs) {
    const job = await claimNextJob();
    if (!job) break;
    await processJob(job);
    count++;
  }
  return count;
}

/**
 * Worker polling step
 */
async function tickWorker() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    await processPendingNotifications();
  } catch (err) {
    console.error('[NOTIFICATION WORKER ERROR]', err);
  } finally {
    isProcessing = false;
  }
}

/**
 * Signals worker to process immediately without waiting for next interval
 */
function kickWorker() {
  setImmediate(() => {
    tickWorker().catch(() => {});
  });
}

function startNotificationWorker(intervalMs = 5000) {
  if (workerInterval) return;
  console.log(`[NotificationWorker] Started background outbox processor (interval: ${intervalMs}ms)`);
  workerInterval = setInterval(tickWorker, intervalMs);
  // Initial kick
  kickWorker();
}

function stopNotificationWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[NotificationWorker] Stopped.');
  }
}

module.exports = {
  claimNextJob,
  processJob,
  processPendingNotifications,
  startNotificationWorker,
  stopNotificationWorker,
  kickWorker,
  BACKOFF_DELAYS_MS,
  MAX_ATTEMPTS
};
