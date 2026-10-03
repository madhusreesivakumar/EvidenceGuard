'use strict';

const Counter = require('../models/Counter');
const { unscoped } = require('./tenantScope');

const getNextSequence = async (name, userOrOrgId = 'default') => {
  const orgId = typeof userOrOrgId === 'object' ? (userOrOrgId.orgId || 'default') : (userOrOrgId || 'default');
  const counterId = `${orgId}:${name}`;
  const counter = await unscoped(Counter).findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 }, $setOnInsert: { orgId, name } },
    { returnDocument: 'after', upsert: true }
  );
  return counter.seq;
};

const nextEvidenceId = async (userOrOrgId = 'default') => {
  const seq = await getNextSequence('evidenceId', userOrOrgId);
  return `EV-${String(seq).padStart(4, '0')}`;
};

const nextCaseId = async (userOrOrgId = 'default') => {
  const year = new Date().getFullYear();
  const seq = await getNextSequence(`caseId_${year}`, userOrOrgId);
  return `EG-${year}-${String(seq).padStart(4, '0')}`;
};

const nextAuditId = async (userOrOrgId = 'default') => {
  const seq = await getNextSequence('auditId', userOrOrgId);
  return `AUD-${String(seq).padStart(6, '0')}`;
};

const nextNotificationId = async (userOrOrgId = 'default') => {
  const year = new Date().getFullYear();
  const seq = await getNextSequence(`notificationId_${year}`, userOrOrgId);
  return `NOTIF-${year}-${String(seq).padStart(4, '0')}`;
};

module.exports = {
  getNextSequence,
  nextEvidenceId,
  nextCaseId,
  nextAuditId,
  nextNotificationId
};
