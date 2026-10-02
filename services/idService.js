const Counter = require('../models/Counter');

const getNextSequence = async (name) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  return counter.seq;
};

const nextEvidenceId = async () => {
  const seq = await getNextSequence('evidenceId');
  return `EV-${String(seq).padStart(4, '0')}`;
};

const nextCaseId = async () => {
  const year = new Date().getFullYear();
  const seq = await getNextSequence(`caseId_${year}`);
  return `EG-${year}-${String(seq).padStart(4, '0')}`;
};

const nextAuditId = async () => {
  const seq = await getNextSequence('auditId');
  return `AUD-${String(seq).padStart(6, '0')}`;
};

module.exports = {
  nextEvidenceId,
  nextCaseId,
  nextAuditId
};
