'use strict';
/**
 * middleware/noSqlSanitizer.js
 * Sprint 8A – Global NoSQL operator injection guard.
 *
 * Rejects (400) any request body, query, or params that contain:
 *   - Keys starting with "$" or containing "$" (MongoDB operator injection)
 *   - Keys containing "." (dot notation field access)
 *   - Any query parameter whose value is an object/array (unexpected nested structure)
 *
 * This is a belt-and-suspenders guard. Individual routes still do their
 * own whitelist validation via express-validator.
 */

const FORBIDDEN_KEY_RE = /\$|\./;

function hasBadKey(obj, depth) {
  if (depth > 10 || obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) {
    return obj.some(v => hasBadKey(v, depth + 1));
  }
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEY_RE.test(key)) return true;
    if (hasBadKey(obj[key], depth + 1)) return true;
  }
  return false;
}

function hasBadQueryValue(query) {
  if (!query || typeof query !== 'object') return false;
  for (const [key, val] of Object.entries(query)) {
    if (FORBIDDEN_KEY_RE.test(key)) return true;
    // Query parameters should be scalar strings (or undefined).
    // An object or array in query indicates injection like ?q[$ne]=x
    if (val !== null && typeof val === 'object') return true;
  }
  return false;
}

const noSqlSanitizer = (req, res, next) => {
  // Check body
  if (req.body && hasBadKey(req.body, 0)) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Request body contains invalid keys or operators'
    });
  }

  // Check query string
  if (req.query && (hasBadKey(req.query, 0) || hasBadQueryValue(req.query))) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Request query contains invalid keys or operators'
    });
  }

  // Check route params
  if (req.params && hasBadKey(req.params, 0)) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Request params contain invalid keys or operators'
    });
  }

  next();
};

module.exports = noSqlSanitizer;