'use strict';
/**
 * src/routes/users.js
 * GET    /api/users              list all users (admin)
 * POST   /api/users              create user (admin)
 * PATCH  /api/users/:id/role     change role (admin)
 * DELETE /api/users/:id          delete user (admin, cannot delete self)
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z }  = require('zod');

const User    = require('../models/User');
const { auth, authorize } = require('../middleware/auth');
const { audit }           = require('../services/auditService');

const VALID_ROLES = ['admin', 'investigator', 'viewer'];

const createUserSchema = z.object({
  name:     z.string().trim().min(2, 'Name must be at least 2 characters.'),
  email:    z.string().trim().email('Invalid email address.').toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  role:     z.enum(['admin','investigator','viewer']).optional().default('viewer')
});

// ── GET /api/users ────────────────────────────────────────────────
router.get('/', auth, authorize('admin'), async (req, res, next) => {
  try {
    const users = await User.find().select('-passwordHash').sort({ createdAt: -1 }).lean();
    res.json({ success: true, message: 'OK', data: users });
  } catch (err) { next(err); }
});

// ── POST /api/users ───────────────────────────────────────────────
router.post('/', auth, authorize('admin'), async (req, res, next) => {
  try {
    const parse = createUserSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, message: parse.error.errors[0].message });
    }
    const { name, email, password, role } = parse.data;

    if (await User.findOne({ email })) {
      return res.status(409).json({ success: false, message: 'A user with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash, role });

    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'USER_CREATED', description: `Admin created user: ${email} (${role})`, ip: req.ip });

    res.status(201).json({
      success: true, message: 'User created successfully.',
      data: { id: user._id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt }
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/users/:id/role ─────────────────────────────────────
router.patch('/:id/role', auth, authorize('admin'), async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `Invalid role. Valid values: ${VALID_ROLES.join(', ')}.` });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-passwordHash');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'USER_ROLE_CHANGED', description: `Role changed: ${user.email} → ${role}`, ip: req.ip });

    res.json({ success: true, message: 'Role updated.', data: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { next(err); }
});

// ── DELETE /api/users/:id ─────────────────────────────────────────
router.delete('/:id', auth, authorize('admin'), async (req, res, next) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'USER_DELETED', description: `User deleted: ${user.email}`, ip: req.ip });

    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;
