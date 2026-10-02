'use strict';
/**
 * src/routes/auth.js
 * POST /api/auth/register
 * POST /api/auth/login
 * POST /api/auth/logout   (auth required)
 * GET  /api/auth/me       (auth required)
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z }  = require('zod');

const User             = require('../models/User');
const { auth, signToken } = require('../middleware/auth');
const { audit }        = require('../services/auditService');

// ── Zod schemas ────────────────────────────────────────────────────
const registerSchema = z.object({
  name:     z.string().trim().min(2, 'Name must be at least 2 characters.'),
  email:    z.string().trim().email('Invalid email address.').toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  role:     z.enum(['admin', 'investigator', 'viewer']).optional().default('viewer')
});

const loginSchema = z.object({
  email:    z.string().trim().email('Invalid email address.').toLowerCase(),
  password: z.string().min(1, 'Password is required.')
});

// ── POST /api/auth/register ────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const parse = registerSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, message: parse.error.errors[0].message });
    }
    const { name, email, password, role } = parse.data;

    if (await User.findOne({ email })) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user  = await User.create({ name, email, passwordHash, role });
    const token = signToken(user);

    await audit({ userId: user._id, userName: user.name, role: user.role,
      action: 'USER_REGISTERED', description: `New account registered: ${email}`, ip: req.ip });

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      data: { token, user: { id: user._id, name: user.name, email: user.email, role: user.role } }
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login ───────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const parse = loginSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, message: parse.error.errors[0].message });
    }
    const { email, password } = parse.data;

    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = signToken(user);
    await audit({ userId: user._id, userName: user.name, role: user.role,
      action: 'USER_LOGIN', description: `Login: ${email}`, ip: req.ip });

    res.json({
      success: true,
      message: 'Logged in successfully.',
      data: { token, user: { id: user._id, name: user.name, email: user.email, role: user.role } }
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/logout ──────────────────────────────────────────
router.post('/logout', auth, async (req, res, next) => {
  try {
    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'USER_LOGOUT', description: `Logout: ${req.user.email}`, ip: req.ip });
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) { next(err); }
});

// ── GET /api/auth/me ───────────────────────────────────────────────
router.get('/me', auth, (req, res) => {
  const { _id: id, name, email, role } = req.user;
  res.json({ success: true, message: 'OK', data: { id, name, email, role } });
});

module.exports = router;
