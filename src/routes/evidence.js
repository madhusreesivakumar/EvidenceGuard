'use strict';
/**
 * src/routes/evidence.js
 * POST   /api/evidence              upload new evidence
 * GET    /api/evidence              list / search / filter (paginated)
 * GET    /api/evidence/:id          single record
 * DELETE /api/evidence/:id          admin only
 * POST   /api/evidence/:id/verify   with or without file re-upload
 * GET    /api/evidence/:id/qr       QR code data URL
 */
const router   = require('express').Router();
const multer   = require('multer');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const QRCode   = require('qrcode');
const mongoose = require('mongoose');
const { z }    = require('zod');

const Evidence   = require('../models/Evidence');
const { auth, authorize } = require('../middleware/auth');
const { audit }           = require('../services/auditService');
const { addBlock }        = require('../services/blockchainService');
const { nextEvidenceId, makeCaseId } = require('../utils/helpers');

// ── Multer (disk storage, 200 MB limit) ───────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename:    (_req, file,  cb) => {
      const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`;
      cb(null, safe);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

/** Resolve evidence by evidenceId string or MongoDB _id */
async function findEvidence(idParam) {
  const q = { $or: [{ evidenceId: idParam }] };
  if (mongoose.isValidObjectId(idParam)) q.$or.push({ _id: idParam });
  return Evidence.findOne(q);
}

// ── POST /api/evidence ────────────────────────────────────────────
const uploadSchema = z.object({
  evidenceName: z.string().trim().min(1, 'Evidence name is required.'),
  evidenceType: z.enum(['Image','Video','Audio','Document','PDF','Other'], { errorMap: () => ({ message: 'Invalid evidence type.' }) }),
  caseId:       z.string().trim().optional(),
  description:  z.string().trim().optional().default('')
});

router.post('/', auth, authorize('admin','investigator'), upload.single('file'), async (req, res, next) => {
  const filePath = req.file?.path;
  try {
    const parse = uploadSchema.safeParse(req.body);
    if (!parse.success) {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, message: parse.error.errors[0].message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Evidence file is required.' });
    }

    const { evidenceName, evidenceType, caseId, description } = parse.data;

    // SHA-256 of file
    const fileBuffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Duplicate check
    const dup = await Evidence.findOne({ hash }).lean();
    if (dup) {
      fs.unlinkSync(filePath);
      return res.status(409).json({
        success: false,
        message: 'Duplicate evidence: this exact file is already registered.',
        data: { existingEvidenceId: dup.evidenceId, existingCaseId: dup.caseId }
      });
    }

    const evidenceId  = await nextEvidenceId();
    const finalCaseId = caseId || makeCaseId();

    const evidence = await Evidence.create({
      evidenceId, caseId: finalCaseId,
      name: evidenceName, type: evidenceType, description,
      fileName: req.file.originalname, fileSize: req.file.size,
      filePath, hash, status: 'Pending',
      uploadedBy: { id: req.user._id, name: req.user.name, email: req.user.email }
    });

    const block = await addBlock(evidenceId, finalCaseId, hash);
    await Evidence.updateOne({ _id: evidence._id }, { blockNumber: block.blockNumber });

    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'EVIDENCE_UPLOAD', evidenceId, caseId: finalCaseId,
      description: `Evidence uploaded: ${evidenceName}`, ip: req.ip });
    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'HASH_GENERATED', evidenceId, caseId: finalCaseId,
      description: `SHA-256: ${hash.slice(0,16)}…`, ip: req.ip });
    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'BLOCKCHAIN_BLOCK_CREATED', evidenceId, caseId: finalCaseId,
      description: `Block #${block.blockNumber} created (hash-chain prototype)`, ip: req.ip });

    res.status(201).json({
      success: true,
      message: 'Evidence registered successfully.',
      data: {
        evidenceId, caseId: finalCaseId,
        name: evidence.name, type: evidence.type,
        fileName: evidence.fileName, fileSize: evidence.fileSize,
        hash, status: evidence.status,
        uploadedBy: evidence.uploadedBy,
        createdAt: evidence.createdAt,
        blockNumber: block.blockNumber,
        blockHash: block.currentHash
      }
    });
  } catch (err) {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    next(err);
  }
});

// ── GET /api/evidence ─────────────────────────────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    const { search, type, status, caseId, page = 1, limit = 10 } = req.query;
    const q = {};

    if (search) {
      const re = { $regex: search, $options: 'i' };
      q.$or = [{ name: re }, { evidenceId: re }, { caseId: re }, { fileName: re }];
    }
    if (type   && type   !== 'All') q.type   = type;
    if (status && status !== 'All') q.status = status;
    if (caseId) q.caseId = { $regex: caseId, $options: 'i' };

    const lim   = Math.min(parseInt(limit, 10) || 10, 100);
    const skip  = (Math.max(parseInt(page, 10), 1) - 1) * lim;
    const total = await Evidence.countDocuments(q);
    const pages = Math.ceil(total / lim) || 1;
    const evidence = await Evidence.find(q).sort({ createdAt: -1 }).skip(skip).limit(lim).lean();

    res.json({ success: true, message: 'OK', data: { evidence, total, page: +page, pages } });
  } catch (err) { next(err); }
});

// ── GET /api/evidence/:id ─────────────────────────────────────────
router.get('/:id', auth, async (req, res, next) => {
  try {
    const evidence = await findEvidence(req.params.id);
    if (!evidence) return res.status(404).json({ success: false, message: 'Evidence not found.' });
    res.json({ success: true, message: 'OK', data: evidence });
  } catch (err) { next(err); }
});

// ── DELETE /api/evidence/:id ──────────────────────────────────────
router.delete('/:id', auth, authorize('admin'), async (req, res, next) => {
  try {
    const evidence = await findEvidence(req.params.id);
    if (!evidence) return res.status(404).json({ success: false, message: 'Evidence not found.' });

    if (evidence.filePath && fs.existsSync(evidence.filePath)) fs.unlinkSync(evidence.filePath);
    await Evidence.deleteOne({ _id: evidence._id });

    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'EVIDENCE_DELETED', evidenceId: evidence.evidenceId, caseId: evidence.caseId,
      description: `Evidence deleted: ${evidence.name}`, ip: req.ip });

    res.json({ success: true, message: 'Evidence deleted successfully.' });
  } catch (err) { next(err); }
});

// ── POST /api/evidence/:id/verify ────────────────────────────────
router.post('/:id/verify', auth, upload.single('file'), async (req, res, next) => {
  const filePath = req.file?.path;
  try {
    const evidence = await findEvidence(req.params.id);
    if (!evidence) {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(404).json({ success: false, message: 'Evidence not found.' });
    }

    const originalHash = evidence.hash;
    let currentHash    = originalHash;
    let result         = 'verified';

    if (req.file) {
      const buf = fs.readFileSync(filePath);
      currentHash = crypto.createHash('sha256').update(buf).digest('hex');
      fs.unlinkSync(filePath);
      result = currentHash === originalHash ? 'verified' : 'tampered';
    } else {
      // Demo mode: no file uploaded — reflect stored status
      result = evidence.status === 'Tampered' ? 'tampered' : 'verified';
    }

    const newStatus = result === 'verified' ? 'Verified' : 'Tampered';
    const ts = new Date();
    evidence.status     = newStatus;
    evidence.verifiedAt = ts;
    await evidence.save();

    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: result === 'verified' ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_TAMPERED',
      evidenceId: evidence.evidenceId, caseId: evidence.caseId,
      description: result === 'verified'
        ? `Integrity OK: ${evidence.name}`
        : `Tamper detected: ${evidence.name} — hash mismatch`,
      ip: req.ip });

    res.json({
      success: true,
      message: result === 'verified' ? 'Evidence verified successfully.' : 'Tampering detected.',
      data: {
        result, originalHash, currentHash, timestamp: ts,
        evidence: { evidenceId: evidence.evidenceId, caseId: evidence.caseId, name: evidence.name, status: newStatus }
      }
    });
  } catch (err) {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    next(err);
  }
});

// ── GET /api/evidence/:id/qr ──────────────────────────────────────
router.get('/:id/qr', auth, async (req, res, next) => {
  try {
    const evidence = await findEvidence(req.params.id);
    if (!evidence) return res.status(404).json({ success: false, message: 'Evidence not found.' });

    const verifyUrl = `${req.protocol}://${req.get('host')}/verify.html?evidenceId=${evidence.evidenceId}&caseId=${evidence.caseId}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      color: { dark: '#1e90ff', light: '#0a0e1a' }, width: 300, margin: 2
    });

    await audit({ userId: req.user._id, userName: req.user.name, role: req.user.role,
      action: 'QR_GENERATED', evidenceId: evidence.evidenceId, caseId: evidence.caseId,
      description: `QR code generated for: ${evidence.evidenceId}`, ip: req.ip });

    res.json({ success: true, message: 'QR code generated.', data: { qrDataUrl, verifyUrl } });
  } catch (err) { next(err); }
});

module.exports = router;
