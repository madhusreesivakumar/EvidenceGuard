const crypto = require('crypto');

const computeBlockHash = ({ blockNumber, evidenceId, caseId, evidenceHash, previousHash, timestamp }) => {
  // Ensure timestamp is an ISO-8601 string (with milliseconds)
  let timestampISO = timestamp;
  if (timestamp instanceof Date) {
    timestampISO = timestamp.toISOString();
  }

  // Use null for undefined or missing values to ensure canonical serialization
  const dataArray = [
    blockNumber,
    evidenceId || null,
    caseId || null,
    evidenceHash || null,
    previousHash,
    timestampISO
  ];

  const canonicalString = JSON.stringify(dataArray);
  return crypto.createHash('sha256').update(canonicalString).digest('hex').toLowerCase();
};

module.exports = {
  computeBlockHash
};
