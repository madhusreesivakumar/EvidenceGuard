'use strict';
/**
 * middleware/errorHandler.js
 * Sprint 8B – Central error handler for EvidenceGuard API.
 * Ensures consistent error shape: { success: false, code, message, details? }
 * Never leaks stack traces, mongo internals, file paths, or secrets.
 */

const AppError = require('../utils/AppError');

// Safe error code & message mappings
const ERROR_MAP = {
  DB_UNAVAILABLE:         { status: 503, message: 'MongoDB connection failed. Please try again shortly.' },
  AUTH_FAILED:            { status: 401, message: 'Invalid email or password' },
  UNAUTHORIZED:           { status: 401, message: 'Authentication required' },
  FORBIDDEN:              { status: 403, message: 'You do not have permission to perform this action' },
  NO_FILE:                { status: 400, message: 'No file uploaded' },
  INVALID_FILE_TYPE:      { status: 415, message: 'File type not allowed' },
  FILE_TOO_LARGE:         { status: 413, message: 'File exceeds maximum allowed size' },
  EMPTY_FILE:             { status: 400, message: 'Uploaded file is empty' },
  DUPLICATE_EVIDENCE:     { status: 409, message: 'DUPLICATE EVIDENCE DETECTED' },
  DUPLICATE_RESOURCE:     { status: 409, message: 'Resource already exists' },
  INVALID_ID:             { status: 400, message: 'Invalid identifier format' },
  NOT_FOUND:              { status: 404, message: 'Requested resource not found' },
  HASH_MISMATCH_UPLOAD:   { status: 422, message: 'File content does not match client hash' },
  HASH_FAILURE:           { status: 500, message: 'Could not compute the file hash.' },
  VERIFICATION_FAILED:    { status: 500, message: 'Verification processing failed' },
  CHAIN_VALIDATION_FAILED:{ status: 500, message: 'Blockchain validation encountered an internal error' },
  LEDGER_BUSY:            { status: 503, message: 'Ledger is currently processing another write, please retry' },
  RATE_LIMITED:           { status: 429, message: 'Too many requests, please try again later.' },
  VALIDATION_ERROR:       { status: 400, message: 'Validation failed' }
};

const errorHandler = (err, req, res, next) => {
  // If response already sent, delegate to default express error handler
  if (res.headersSent) {
    return next(err);
  }

  let status = err.status || err.statusCode || 500;
  let code = err.code;
  let message = err.message;
  let details = err.details;

  // 1. AppError instance
  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  }
  // 2. Body-parser JSON syntax error
  else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Malformed JSON in request body';
  }
  // 3. Body limit exceeded (express.json limit)
  else if (err.status === 413 || err.type === 'entity.too.large') {
    status = 413;
    code = 'FILE_TOO_LARGE';
    message = 'Request body exceeds the maximum allowed size (100kb)';
  }
  // 4. Multer errors
  else if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      code = 'FILE_TOO_LARGE';
      message = 'File exceeds maximum allowed size';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.field === 'File type not allowed') {
      status = 415;
      code = 'INVALID_FILE_TYPE';
      message = 'File type not allowed';
    } else {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = err.message || 'File upload error';
    }
  }
  // 5. Mongoose CastError (e.g. invalid ObjectId)
  else if (err.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = `Invalid format for field "${err.path}"`;
  }
  // 6. Mongoose ValidationError
  else if (err.name === 'ValidationError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    if (err.errors) {
      details = Object.keys(err.errors).map(key => ({
        field: key,
        message: err.errors[key].message
      }));
    }
  }
  // 7. Mongo duplicate key error (code 11000)
  else if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE_RESOURCE';
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    message = fields.length > 0
      ? `A record with this ${fields.join(', ')} already exists`
      : 'Duplicate record detected';
  }
  // 8. JWT errors
  else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    status = 401;
    code = 'UNAUTHORIZED';
    message = err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
  }
  // 9. Status 415
  else if (status === 415) {
    code = code || 'INVALID_FILE_TYPE';
    message = message || 'Unsupported Media Type';
  }

  // Fallback defaults
  if (!code) {
    code = status === 404 ? 'NOT_FOUND' : (status === 400 ? 'VALIDATION_ERROR' : 'SERVER_ERROR');
  }
  if (!message || status >= 500 && !err.expose && !(err instanceof AppError)) {
    // Hide unexpected internal errors from user
    message = 'An internal server error occurred. Please try again.';
  }

  // Safe logging (no body contents, stack traces logged safely on server only)
  if (status >= 500) {
    console.error(`[ERROR 500] ${req.method} ${req.originalUrl}:`, err.message);
  }

  const payload = {
    success: false,
    code,
    message
  };

  if (details !== undefined) {
    payload.details = details;
  }

  return res.status(status).json(payload);
};

module.exports = {
  errorHandler,
  ERROR_MAP
};
