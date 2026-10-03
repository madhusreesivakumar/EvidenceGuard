'use strict';

/**
 * services/notificationDispatcher.js
 * Sprint 13A – Event-driven Notification Dispatcher
 *
 * Subscribes to application events, evaluates rules from config/notificationRules.js,
 * handles 10-minute coalescing, creates outbox records in Notification collection,
 * and signals the notification worker.
 */

const eventBus = require('./eventBus');
const Notification = require('../models/Notification');
const User = require('../models/User');
let CustodyEvent = null;
try {
  CustodyEvent = require('../models/CustodyEvent');
} catch (_) {}

const { NOTIFICATION_TYPES, COALESCE_WINDOW_MS, RULES } = require('../config/notificationRules');
const { nextNotificationId } = require('./idService');

// Sliding window tracker for failed login attempts: email -> Array<number> (timestamps)
const failedLoginMap = new Map();

function trackFailedLogin(email) {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.toLowerCase().trim();
  const now = Date.now();
  const cutoff = now - (15 * 60 * 1000); // 15-minute sliding window

  let attempts = failedLoginMap.get(normalized) || [];
  attempts = attempts.filter(ts => ts > cutoff);
  attempts.push(now);
  failedLoginMap.set(normalized, attempts);

  return attempts.length >= 5;
}

/**
 * Enqueue notification for a given rule and event payload
 */
async function dispatchNotification(ruleType, eventData) {
  const rule = RULES[ruleType];
  if (!rule) {
    console.warn(`[DISPATCH] Unknown notification rule type: ${ruleType}`);
    return [];
  }

  // Feature flag check
  if (process.env.FEATURE_NOTIFICATIONS !== 'true') {
    return [];
  }

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const formatted = rule.format(eventData, baseUrl);

  // Resolve target recipients
  const recipientIds = await rule.resolveRecipients(eventData, { User, CustodyEvent });
  if (!recipientIds || recipientIds.length === 0) {
    return [];
  }

  // Deduplicate recipient IDs
  const uniqueRecipients = [...new Set(recipientIds.map(id => String(id)))];
  const createdNotifications = [];

  const tenMinutesAgo = new Date(Date.now() - COALESCE_WINDOW_MS);

  for (const userId of uniqueRecipients) {
    for (const channel of rule.channels) {
      // 10-minute coalescing check:
      // If a notification of this type for this user, channel, and evidence exists within 10 minutes,
      // reuse its dedupeKey so the compound unique index on (dedupeKey, userId, channel) coalesces it.
      let dedupeKey;
      const coalesceQuery = {
        userId,
        channel,
        type: rule.type,
        createdAt: { $gte: tenMinutesAgo }
      };
      if (formatted.evidenceId) {
        coalesceQuery.evidenceId = formatted.evidenceId;
      }

      try {
        const existing = await Notification.findOne(coalesceQuery).lean();
        if (existing) {
          dedupeKey = existing.dedupeKey;
        } else {
          const timeBucket = Math.floor(Date.now() / COALESCE_WINDOW_MS);
          const evSuffix = formatted.evidenceId ? `:${formatted.evidenceId}` : '';
          dedupeKey = `${rule.type}${evSuffix}:${userId}:${timeBucket}`;
        }

        const notificationId = await nextNotificationId();
        const notificationDoc = {
          notificationId,
          userId,
          channel,
          type: rule.type,
          severity: rule.severity,
          title: formatted.title,
          body: formatted.body,
          link: formatted.link,
          evidenceId: formatted.evidenceId || null,
          caseId: formatted.caseId || null,
          dedupeKey,
          status: channel === 'IN_APP' ? 'SENT' : 'QUEUED',
          sentAt: channel === 'IN_APP' ? new Date() : null,
          attempts: 0,
          nextAttemptAt: new Date(),
          leaseUntil: null,
          lastError: null,
          createdAt: new Date()
        };

        const created = await Notification.create(notificationDoc);
        createdNotifications.push(created);
      } catch (err) {
        if (err.code === 11000) {
          // Successfully coalesced by compound unique index (dedupeKey, userId, channel)
          // Silent return
        } else {
          console.error(`[DISPATCH ERROR] Failed to create ${channel} notification for user ${userId}:`, err.message);
        }
      }
    }
  }

  // Trigger worker to process queued notifications immediately
  try {
    const { kickWorker } = require('./notificationWorker');
    kickWorker();
  } catch (_) {}

  return createdNotifications;
}

/**
 * Initialize event bus subscriptions
 */
let isInitialized = false;

function initNotificationDispatcher() {
  if (isInitialized) return;
  isInitialized = true;

  // 1. TAMPERED verification -> uploader, custodian, all ADMINs (CRITICAL)
  eventBus.on('VERIFICATION_TAMPERED', async (data) => {
    try {
      await dispatchNotification(NOTIFICATION_TYPES.TAMPER_ALERT, data);
    } catch (e) {
      console.error('[EVENT_ERROR VERIFICATION_TAMPERED]', e);
    }
  });

  // 2. Ledger or audit chain INVALID -> all ADMINs (CRITICAL)
  eventBus.on('CHAIN_INVALID', async (data) => {
    try {
      await dispatchNotification(NOTIFICATION_TYPES.CHAIN_INVALID, data);
    } catch (e) {
      console.error('[EVENT_ERROR CHAIN_INVALID]', e);
    }
  });

  // 3. Stored-copy / anchor mismatch -> all ADMINs (CRITICAL)
  eventBus.on('STORAGE_MISMATCH', async (data) => {
    try {
      await dispatchNotification(NOTIFICATION_TYPES.STORAGE_MISMATCH, data);
    } catch (e) {
      console.error('[EVENT_ERROR STORAGE_MISMATCH]', e);
    }
  });

  eventBus.on('ANCHOR_MISMATCH', async (data) => {
    try {
      await dispatchNotification(NOTIFICATION_TYPES.ANCHOR_MISMATCH, data);
    } catch (e) {
      console.error('[EVENT_ERROR ANCHOR_MISMATCH]', e);
    }
  });

  // 4. ROLE_CHANGED -> affected user + all ADMINs (INFO)
  eventBus.on('ROLE_CHANGED', async (data) => {
    try {
      await dispatchNotification(NOTIFICATION_TYPES.ROLE_CHANGED, data);
    } catch (e) {
      console.error('[EVENT_ERROR ROLE_CHANGED]', e);
    }
  });

  // 5. User deactivated -> all ADMINs (INFO)
  eventBus.on('USER_DEACTIVATED', async (data) => {
    try {
      await dispatchNotification(NOTIFICATION_TYPES.USER_DEACTIVATED, data);
    } catch (e) {
      console.error('[EVENT_ERROR USER_DEACTIVATED]', e);
    }
  });

  // 6. 5 failed logins in 15 minutes for one account -> that account owner + all ADMINs (WARNING)
  eventBus.on('LOGIN_FAILED', async (data) => {
    try {
      if (data && data.email) {
        const thresholdReached = trackFailedLogin(data.email);
        if (thresholdReached) {
          await dispatchNotification(NOTIFICATION_TYPES.FAILED_LOGINS, data);
        }
      }
    } catch (e) {
      console.error('[EVENT_ERROR LOGIN_FAILED]', e);
    }
  });

  // 7. Incoming custody transfer -> recipient (INFO)
  eventBus.on('CUSTODY_TRANSFER_INITIATED', async (data) => {
    try {
      await dispatchNotification(NOTIFICATION_TYPES.CUSTODY_TRANSFER, data);
    } catch (e) {
      console.error('[EVENT_ERROR CUSTODY_TRANSFER_INITIATED]', e);
    }
  });

  console.log('[Dispatcher] Notification event pipeline initialized.');
}

module.exports = {
  initNotificationDispatcher,
  dispatchNotification,
  trackFailedLogin
};
