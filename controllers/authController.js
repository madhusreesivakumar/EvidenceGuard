const User = require('../models/User');
const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const { generateToken, verifyToken } = require('../services/tokenService');
const { logEvent } = require('../services/auditService');

exports.register = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: "Validation failed", details: errors.array() });
  }

  const { name, email, password } = req.body;
  const normalizedEmail = email.toLowerCase();

  try {
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ success: false, code: 'DUPLICATE_RESOURCE', message: 'Email is already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    
    // Explicitly ignore incoming "role"
    const user = new User({
      name,
      email: normalizedEmail,
      passwordHash,
      role: 'VIEWER'
    });

    await user.save();

    await logEvent({ 
      action: 'REGISTER', 
      user, 
      description: 'New account registered', 
      req 
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: user.toJSON()
    });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: "Email and password are required" });
  }
  
  const normalizedEmail = email.toLowerCase();
  try {
    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
    
    if (!user) {
      await bcrypt.compare(password, '$2b$12$00000000000000000000000000000000000000000000000000000');
      await logEvent({ action: 'LOGIN', description: 'Failed login attempt', req });
      return res.status(401).json({ success: false, code: 'AUTH_FAILED', message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await logEvent({ action: 'LOGIN', description: 'Failed login attempt', req });
      return res.status(401).json({ success: false, code: 'AUTH_FAILED', message: 'Invalid email or password' });
    }

    // Reject inactive users — same generic message so reason is not disclosed
    if (!user.isActive) {
      await bcrypt.compare(password, '$2b$12$00000000000000000000000000000000000000000000000000000');
      await logEvent({ action: 'LOGIN', description: 'Failed login attempt (inactive user)', req });
      return res.status(401).json({ success: false, code: 'AUTH_FAILED', message: 'Invalid email or password' });
    }

    // Record last login time
    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user._id, user.role);

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000 // 8 hours
    });

    await logEvent({ 
      action: 'LOGIN', 
      user, 
      description: 'User logged in', 
      req 
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      user: user.toJSON()
    });
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res) => {
  res.clearCookie('token');
  
  const token = req.cookies?.token;
  if (token) {
    const decoded = verifyToken(token);
    if (decoded && decoded.userId) {
      const user = await User.findById(decoded.userId);
      if (user) {
        await logEvent({ action: 'LOGOUT', user, description: 'User logged out', req });
      }
    }
  }

  res.status(200).json({ success: true, message: 'Logout successful' });
};

exports.me = (req, res) => {
  res.status(200).json({ success: true, user: req.user.toJSON() });
};
