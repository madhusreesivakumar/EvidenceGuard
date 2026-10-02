'use strict';
/**
 * src/middleware/errorHandler.js
 * Central error handler + 404 handler.
 * No stack traces or internal details are ever sent to the client.
 */

/**
 * 404 handler — must be registered AFTER all routes.
 */
function notFound(req, res) {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
  }
  // For non-API paths, serve index.html (SPA fallback)
  res.sendFile(require('path').join(__dirname, '../../public', 'index.html'));
}

/**
 * Central error handler — Express calls this when next(err) is invoked.
 * Signature must have 4 parameters.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Log full error server-side (not sent to client)
  console.error(`[ERROR] ${req.method} ${req.path} →`, err.message);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message).join(', ');
    return res.status(400).json({ success: false, message: messages });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ success: false, message: `Duplicate value for ${field}.` });
  }

  // Multer file size limit
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'File too large. Maximum size is 200 MB.' });
  }

  // JWT errors (shouldn't reach here normally, but just in case)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }

  // Default: 500, safe message only
  const statusCode = err.statusCode || err.status || 500;
  const message    = err.expose ? err.message : 'An unexpected error occurred. Please try again.';
  res.status(statusCode).json({ success: false, message });
}

module.exports = { notFound, errorHandler };
