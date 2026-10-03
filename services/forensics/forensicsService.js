'use strict';

/**
 * services/forensics/forensicsService.js
 * Sprint 14A – Safe Metadata Extraction & Forensic Report Service
 *
 * Spawns an isolated child process with strict memory limit, 20s timeout,
 * and no-shell execution. Handles append-only versioning and role-based privacy redaction.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ForensicReport = require('../../models/ForensicReport');
const { logEvent } = require('../auditService');

const WORKER_SCRIPT = path.join(__dirname, 'extractWorker.js');
const EXTRACTION_TIMEOUT_MS = 20000; // 20 seconds
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB stdout cap
const MAX_INPUT_FILE_BYTES = 100 * 1024 * 1024; // 100 MB input cap

/**
 * Executes metadata extraction in an isolated child process
 */
function runExtractionProcess(filePath, originalName, declaredMime, customTimeout = EXTRACTION_TIMEOUT_MS) {
  return new Promise((resolve) => {
    // Check input file existence and size
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_INPUT_FILE_BYTES) {
        return resolve({
          status: 'EXTRACTION_FAILED',
          error: `File size (${stats.size} bytes) exceeds maximum extraction limit`
        });
      }
    } catch (err) {
      return resolve({
        status: 'EXTRACTION_FAILED',
        error: `Input file could not be read: ${err.message}`
      });
    }

    const nodeArgs = [
      '--max-old-space-size=256',
      WORKER_SCRIPT,
      filePath,
      originalName || '',
      declaredMime || ''
    ];

    let stdoutData = '';
    let stderrData = '';
    let isTerminated = false;

    // Spawn child process: strictly shell: false, argument array
    const child = spawn(process.execPath, nodeArgs, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timer = setTimeout(() => {
      isTerminated = true;
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      resolve({
        status: 'EXTRACTION_FAILED',
        error: `Extraction timed out after ${Math.round(customTimeout / 1000)} seconds`
      });
    }, customTimeout);

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf8');
      if (stdoutData.length > MAX_OUTPUT_BYTES) {
        isTerminated = true;
        clearTimeout(timer);
        try { child.kill('SIGKILL'); } catch (_) {}
        resolve({
          status: 'EXTRACTION_FAILED',
          error: 'Extraction output exceeded maximum size limit'
        });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf8');
    });

    child.on('close', (code) => {
      if (isTerminated) return;
      clearTimeout(timer);

      if (code !== 0) {
        let errMsg = 'Child process returned non-zero exit code';
        try {
          const errObj = JSON.parse(stderrData.trim());
          if (errObj && errObj.error) errMsg = errObj.error;
        } catch (_) {
          if (stderrData.trim()) errMsg = stderrData.trim();
        }

        return resolve({
          status: 'EXTRACTION_FAILED',
          error: errMsg
        });
      }

      try {
        const parsed = JSON.parse(stdoutData.trim());
        if (parsed && parsed.success) {
          return resolve({
            status: 'COMPLETED',
            fileSignature: parsed.fileSignature,
            metadata: parsed.metadata,
            metadataHash: parsed.metadataHash
          });
        } else {
          return resolve({
            status: 'EXTRACTION_FAILED',
            error: parsed.error || 'Extraction failed'
          });
        }
      } catch (parseErr) {
        return resolve({
          status: 'EXTRACTION_FAILED',
          error: `Failed to parse worker output: ${parseErr.message}`
        });
      }
    });

    child.on('error', (err) => {
      if (isTerminated) return;
      clearTimeout(timer);
      resolve({
        status: 'EXTRACTION_FAILED',
        error: `Child process failed to start: ${err.message}`
      });
    });
  });
}

/**
 * Computes deep differences between previous and new metadata
 */
function computeMetadataDiff(prevMeta = {}, newMeta = {}) {
  const diff = {
    added: {},
    removed: {},
    changed: {}
  };

  const prevKeys = new Set(Object.keys(prevMeta || {}));
  const newKeys = new Set(Object.keys(newMeta || {}));

  for (const k of newKeys) {
    if (!prevKeys.has(k)) {
      diff.added[k] = newMeta[k];
    } else if (JSON.stringify(prevMeta[k]) !== JSON.stringify(newMeta[k])) {
      diff.changed[k] = {
        from: prevMeta[k],
        to: newMeta[k]
      };
    }
  }

  for (const k of prevKeys) {
    if (!newKeys.has(k)) {
      diff.removed[k] = prevMeta[k];
    }
  }

  const hasDiff = Object.keys(diff.added).length > 0 ||
                  Object.keys(diff.removed).length > 0 ||
                  Object.keys(diff.changed).length > 0;

  return hasDiff ? diff : null;
}

/**
 * Executes extraction and saves append-only ForensicReport
 */
async function processForensicsForEvidence(evidence, filePath, options = {}) {
  const { isRerun = false, actorUser = null, req = null, customTimeout = EXTRACTION_TIMEOUT_MS } = options;

  // 1. Query latest report version
  const latestReport = await ForensicReport.findOne({ evidenceId: evidence.evidenceId })
    .sort({ version: -1 })
    .lean();

  const nextVersion = latestReport ? latestReport.version + 1 : 1;

  // 2. Run extraction
  const outcome = await runExtractionProcess(
    filePath,
    evidence.originalName || evidence.name || '',
    evidence.mimeType || '',
    customTimeout
  );

  let metadataHash = '0000000000000000000000000000000000000000000000000000000000000000';
  let diffFromPrevious = null;

  if (outcome.status === 'COMPLETED') {
    metadataHash = outcome.metadataHash;
    if (latestReport && latestReport.metadata) {
      diffFromPrevious = computeMetadataDiff(latestReport.metadata, outcome.metadata);
    }
  }

  const reportData = {
    evidenceId: evidence.evidenceId,
    version: nextVersion,
    extractorVersion: '1.0.0',
    extractedAt: new Date(),
    fileSignature: outcome.fileSignature || {
      detected: 'unknown',
      declared: evidence.mimeType || 'unknown',
      match: false
    },
    metadata: outcome.metadata || {},
    anomalies: [], // Part 14B anomaly engine populates this
    metadataHash,
    status: outcome.status,
    error: outcome.error || null,
    diffFromPrevious
  };

  const savedReport = await ForensicReport.create(reportData);

  // 3. Log audit event
  try {
    await logEvent({
      user: actorUser || { name: 'Forensic System', role: 'SYSTEM' },
      action: 'FORENSICS_EXTRACTED',
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      description: `Forensics extraction (version ${nextVersion}) status: ${outcome.status}${outcome.error ? ' - ' + outcome.error : ''}`,
      req
    });
  } catch (auditErr) {
    console.error('[FORENSICS AUDIT LOG ERROR]', auditErr);
  }

  return savedReport;
}

/**
 * Role-based privacy redaction
 * VIEWER gets non-sensitive subset (type, dates, codec, page count)
 * ADMIN and INVESTIGATOR get the full metadata (including GPS, device serials, and author)
 */
function projectReportForRole(reportDoc, role = 'VIEWER') {
  if (!reportDoc) return null;
  const report = typeof reportDoc.toObject === 'function' ? reportDoc.toObject() : JSON.parse(JSON.stringify(reportDoc));

  if (role === 'ADMIN' || role === 'INVESTIGATOR') {
    return report;
  }

  // Sanitize for VIEWER
  if (report.metadata) {
    const raw = report.metadata;
    const redacted = {
      fileSize: raw.fileSize,
      fileCreatedAt: raw.fileCreatedAt,
      fileModifiedAt: raw.fileModifiedAt,
      // Safe image subset
      imageWidth: raw.imageWidth,
      imageHeight: raw.imageHeight,
      // Safe media subset
      container: raw.container,
      durationSeconds: raw.durationSeconds,
      bitrate: raw.bitrate,
      video: raw.video ? { codec: raw.video.codec, width: raw.video.width, height: raw.video.height, fps: raw.video.fps } : null,
      audio: raw.audio ? { codec: raw.audio.codec, sampleRate: raw.audio.sampleRate, channels: raw.audio.channels } : null,
      // Safe document subset
      pageCount: raw.pageCount,
      wordCount: raw.wordCount,
      lineCount: raw.lineCount,
      encoding: raw.encoding,
      // Privacy notice
      _privacyNotice: 'Sensitive fields (GPS coordinates, device serial numbers, and personal author tags) are restricted to Investigators and Admins.'
    };

    report.metadata = redacted;
  }

  return report;
}

module.exports = {
  runExtractionProcess,
  computeMetadataDiff,
  processForensicsForEvidence,
  projectReportForRole,
  EXTRACTION_TIMEOUT_MS
};
