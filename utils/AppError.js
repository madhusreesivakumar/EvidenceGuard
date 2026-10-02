'use strict';
/**
 * utils/AppError.js
 * Standard application error class with machine-readable error codes,
 * HTTP status codes, and optional structured details.
 */

class AppError extends Error {
  constructor(code, message, status = 500, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
