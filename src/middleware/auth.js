'use strict';
/**
 * src/middleware/auth.js
 * JWT authentication and role-based authorization.
 * Token is read from the Authorization: Bearer header.
 * (httpOnly cookie support can be added in a later sprint)
 */
const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = () => process.env.JWT_SECRET;

/**
 * auth — verifies the JWT, loads the full User from DB, attaches to req.user.
 * Responds 401 (unauthenticated) on any failure.
 */
async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
    }

    const token   = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET());

    const user = await User.findById(decoded.id).select('-passwordHash').lean();
    if (!user) {
      return res.status(401).json({ success: false, message: 'User account not found or deleted.' });
    }

    req.user = user;
    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError'
      ? 'Session expired. Please log in again.'
      : 'Invalid token. Please log in again.';
    res.status(401).json({ success: false, message });
  }
}

/**
 * authorize(...roles) — role gate middleware, must run after auth().
 * Responds 403 (forbidden) if the user's role is not in the allowed list.
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}.`
      });
    }
    next();
  };
}

/**
 * signToken — create a signed JWT for a user document.
 */
function signToken(user) {
  return jwt.sign(
    { id: user._id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET(),
    { expiresIn: '7d' }
  );
}

module.exports = { auth, authorize, signToken };
