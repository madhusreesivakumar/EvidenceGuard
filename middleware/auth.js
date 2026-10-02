const { verifyToken } = require('../services/tokenService');
const User = require('../models/User');
const { can } = require('../config/permissions');

const authenticate = async (req, res, next) => {
  let token = req.cookies?.token;
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  const decoded = verifyToken(token);
  if (!decoded || !decoded.userId) {
    return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
  }

  try {
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'User no longer exists' });
    }
    if (!user.isActive) {
      return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[Auth Middleware]', error.message);
    if (error.name === 'MongooseError' || error.name === 'MongoServerSelectionError') {
      return res.status(503).json({ success: false, code: 'DB_UNAVAILABLE', message: 'MongoDB connection failed. Please try again shortly.' });
    }
    next(error);
  }
};

const authorizeAction = (action) => {
  return (req, res, next) => {
    const actualAction = action.startsWith(':') ? req.params[action.slice(1)] : action;
    
    if (!req.user || !req.user.role) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You do not have permission to perform this action' });
    }
    
    if (can(req.user.role, actualAction)) {
      next();
    } else {
      res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You do not have permission to perform this action' });
    }
  };
};

module.exports = {
  authenticate,
  authorizeAction
};
