'use strict';

/**
 * controllers/forensicsController.js
 * Sprint 14A – Safe Metadata Extraction & Forensics Analysis Controller
 */

const Evidence = require('../models/Evidence');
const ForensicReport = require('../models/ForensicReport');
const storageService = require('../storage/storageService');
const fs = require('fs');
const {
  processForensicsForEvidence,
  projectReportForRole
} = require('../services/forensics/forensicsService');

/**
 * Helper to resolve evidence by evidenceId or _id
 */
async function findEvidence(id) {
  if (!id) return null;
  return await Evidence.findOne({
    $or: [{ evidenceId: id }, { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }],
    isDeleted: false
  }).select('+storageKey');
}

/**
 * POST /api/evidence/:id/forensics/rerun
 * Creates a new version of the forensic report from the stored file and computes diff
 * Restricted to ADMIN and INVESTIGATOR
 */
async function rerunForensics(req, res, next) {
  try {
    const evidence = await findEvidence(req.params.id);
    if (!evidence) {
      return res.status(404).json({
        success: false,
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence record not found'
      });
    }

    const filePath = storageService.getFilePath(evidence.storageKey);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        code: 'FILE_NOT_FOUND',
        message: 'Stored evidence file could not be located on disk'
      });
    }

    const report = await processForensicsForEvidence(evidence, filePath, {
      isRerun: true,
      actorUser: req.user,
      req
    });

    const projected = projectReportForRole(report, req.user.role);

    return res.status(200).json({
      success: true,
      message: 'Forensic re-run completed',
      report: projected
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/evidence/:id/forensics
 * Retrieves forensic report for the evidence.
 * Full metadata for ADMIN / INVESTIGATOR; privacy-redacted subset for VIEWER.
 */
async function getForensicsReport(req, res, next) {
  try {
    const evidence = await findEvidence(req.params.id);
    if (!evidence) {
      return res.status(404).json({
        success: false,
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence record not found'
      });
    }

    let query = { evidenceId: evidence.evidenceId };
    if (req.query.version) {
      const ver = parseInt(req.query.version, 10);
      if (!isNaN(ver) && ver > 0) {
        query.version = ver;
      }
    }

    const report = await ForensicReport.findOne(query)
      .sort({ version: -1 })
      .lean();

    if (!report) {
      return res.status(404).json({
        success: false,
        code: 'FORENSICS_NOT_FOUND',
        message: 'No forensic report found for this evidence'
      });
    }

    const projected = projectReportForRole(report, req.user.role);

    return res.status(200).json({
      success: true,
      report: projected
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/evidence/:id/forensics/history
 * Returns the version history for evidence forensics
 */
async function getForensicsHistory(req, res, next) {
  try {
    const evidence = await findEvidence(req.params.id);
    if (!evidence) {
      return res.status(404).json({
        success: false,
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence record not found'
      });
    }

    const versions = await ForensicReport.find({ evidenceId: evidence.evidenceId })
      .sort({ version: -1 })
      .select('evidenceId version extractorVersion extractedAt fileSignature status metadataHash diffFromPrevious')
      .lean();

    return res.status(200).json({
      success: true,
      evidenceId: evidence.evidenceId,
      total: versions.length,
      versions
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  findEvidence,
  rerunForensics,
  getForensicsReport,
  getForensicsHistory
};
