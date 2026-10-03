'use strict';

/**
 * services/forensics/anomalyEngine.js
 * Sprint 14B – Deterministic Forensic Anomaly Rule Engine
 *
 * All rules are deterministic. Each rule returns:
 * - ruleId: string
 * - severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH'
 * - explanation: string
 * - fields: string[]
 *
 * Invariant: Anomalies NEVER alter or dictate Evidence.status (Verified / Tampered).
 */

const DISCLAIMER = 'These are indicators for examiner review. Metadata is easy to edit, and the absence of flags proves nothing.';

const EDITING_SOFTWARE_REGEX = /photoshop|gimp|canva|snapseed|lightroom|paint\.net|pixelmator|premiere|after effects|final cut|audacity|sound forge|avidemux|filmora|capcut|imovie|cyberlink/i;
const REENCODED_VIDEO_REGEX = /lavf|handbrake|ffmpeg|x264|x265|mkvmerge|openshot|vegas|obs-output|capcut/i;

/**
 * List of deterministic rule evaluators
 */
const RULES = [
  // 1. EXT_MIME_MISMATCH
  {
    ruleId: 'EXT_MIME_MISMATCH',
    evaluate(metadata, fileSignature, context) {
      if (fileSignature && fileSignature.match === false) {
        return {
          ruleId: 'EXT_MIME_MISMATCH',
          severity: 'MEDIUM',
          explanation: `File extension or declared MIME (${fileSignature.declared}) does not match detected binary signature (${fileSignature.detected}).`,
          fields: ['fileSignature.detected', 'fileSignature.declared']
        };
      }
      return null;
    }
  },

  // 2. MODIFIED_BEFORE_CREATED
  {
    ruleId: 'MODIFIED_BEFORE_CREATED',
    evaluate(metadata, fileSignature, context) {
      const fields = [];

      // Check document timestamps (Office/XML)
      if (metadata.created && metadata.modified) {
        const c = new Date(metadata.created).getTime();
        const m = new Date(metadata.modified).getTime();
        if (!isNaN(c) && !isNaN(m) && m < (c - 1000)) {
          fields.push('metadata.created', 'metadata.modified');
        }
      }

      // Check EXIF / media timestamps
      if (fields.length === 0 && metadata.createDate && metadata.modifyDate) {
        const c = new Date(metadata.createDate).getTime();
        const m = new Date(metadata.modifyDate).getTime();
        if (!isNaN(c) && !isNaN(m) && m < (c - 1000)) {
          fields.push('metadata.createDate', 'metadata.modifyDate');
        }
      }

      // Check filesystem timestamps
      if (fields.length === 0 && metadata.fileCreatedAt && metadata.fileModifiedAt) {
        const c = new Date(metadata.fileCreatedAt).getTime();
        const m = new Date(metadata.fileModifiedAt).getTime();
        if (!isNaN(c) && !isNaN(m) && m < (c - 2000)) {
          fields.push('metadata.fileCreatedAt', 'metadata.fileModifiedAt');
        }
      }

      if (fields.length > 0) {
        return {
          ruleId: 'MODIFIED_BEFORE_CREATED',
          severity: 'MEDIUM',
          explanation: 'File modification timestamp is recorded prior to its creation timestamp.',
          fields
        };
      }
      return null;
    }
  },

  // 3. FUTURE_TIMESTAMP
  {
    ruleId: 'FUTURE_TIMESTAMP',
    evaluate(metadata, fileSignature, context) {
      const nowTolerance = Date.now() + 5 * 60 * 1000; // 5-minute skew tolerance
      const candidates = [
        { field: 'metadata.fileCreatedAt', val: metadata.fileCreatedAt },
        { field: 'metadata.fileModifiedAt', val: metadata.fileModifiedAt },
        { field: 'metadata.dateTimeOriginal', val: metadata.dateTimeOriginal },
        { field: 'metadata.createDate', val: metadata.createDate },
        { field: 'metadata.creationTime', val: metadata.creationTime },
        { field: 'metadata.created', val: metadata.created },
        { field: 'metadata.modified', val: metadata.modified }
      ];

      const futureFields = [];
      for (const item of candidates) {
        if (item.val) {
          const t = new Date(item.val).getTime();
          if (!isNaN(t) && t > nowTolerance) {
            futureFields.push(item.field);
          }
        }
      }

      if (futureFields.length > 0) {
        return {
          ruleId: 'FUTURE_TIMESTAMP',
          severity: 'HIGH',
          explanation: `One or more metadata timestamps are set in the future relative to the system clock (${futureFields.join(', ')}).`,
          fields: futureFields
        };
      }
      return null;
    }
  },

  // 4. CAPTURE_AFTER_UPLOAD
  {
    ruleId: 'CAPTURE_AFTER_UPLOAD',
    evaluate(metadata, fileSignature, context) {
      const uploadTime = context.evidence?.createdAt ? new Date(context.evidence.createdAt).getTime() : null;
      if (!uploadTime) return null;

      const candidates = [
        { field: 'metadata.dateTimeOriginal', val: metadata.dateTimeOriginal },
        { field: 'metadata.createDate', val: metadata.createDate },
        { field: 'metadata.creationTime', val: metadata.creationTime }
      ];

      const lateFields = [];
      for (const item of candidates) {
        if (item.val) {
          const t = new Date(item.val).getTime();
          if (!isNaN(t) && t > (uploadTime + 60 * 1000)) { // 1-minute margin
            lateFields.push(item.field);
          }
        }
      }

      if (lateFields.length > 0) {
        return {
          ruleId: 'CAPTURE_AFTER_UPLOAD',
          severity: 'HIGH',
          explanation: 'Media creation or capture timestamp is dated after the evidence intake/upload timestamp.',
          fields: lateFields
        };
      }
      return null;
    }
  },

  // 5. EDITING_SOFTWARE_TAG
  {
    ruleId: 'EDITING_SOFTWARE_TAG',
    evaluate(metadata, fileSignature, context) {
      const candidates = [
        { field: 'metadata.software', val: metadata.software },
        { field: 'metadata.application', val: metadata.application },
        { field: 'metadata.creator', val: metadata.creator },
        { field: 'metadata.info.creator', val: metadata.info?.creator },
        { field: 'metadata.info.producer', val: metadata.info?.producer }
      ];

      for (const item of candidates) {
        if (typeof item.val === 'string' && EDITING_SOFTWARE_REGEX.test(item.val)) {
          return {
            ruleId: 'EDITING_SOFTWARE_TAG',
            severity: 'LOW',
            explanation: `Metadata indicates the file was generated or edited using graphics/editing software (${item.val}).`,
            fields: [item.field]
          };
        }
      }
      return null;
    }
  },

  // 6. REENCODED_VIDEO_TAG
  {
    ruleId: 'REENCODED_VIDEO_TAG',
    evaluate(metadata, fileSignature, context) {
      const candidates = [
        { field: 'metadata.encoder', val: metadata.encoder },
        { field: 'metadata.video.codec', val: metadata.video?.codec }
      ];

      for (const item of candidates) {
        if (typeof item.val === 'string' && REENCODED_VIDEO_REGEX.test(item.val)) {
          return {
            ruleId: 'REENCODED_VIDEO_TAG',
            severity: 'LOW',
            explanation: `Media tags indicate post-capture transcode or re-encoding software (${item.val}).`,
            fields: [item.field]
          };
        }
      }
      return null;
    }
  },

  // 7. METADATA_STRIPPED
  {
    ruleId: 'METADATA_STRIPPED',
    evaluate(metadata, fileSignature, context) {
      const isMedia = (fileSignature?.detectedMime?.startsWith('image/') ||
                       fileSignature?.detectedMime?.startsWith('video/') ||
                       metadata.imageWidth ||
                       metadata.video);

      if (!isMedia) return null;

      // Check if standard camera tags are completely absent
      const hasExifTags = Boolean(
        metadata.make ||
        metadata.model ||
        metadata.dateTimeOriginal ||
        metadata.software ||
        metadata.gps ||
        metadata.encoder ||
        metadata.author
      );

      if (!hasExifTags) {
        return {
          ruleId: 'METADATA_STRIPPED',
          severity: 'INFO',
          explanation: 'No camera, device, or capture metadata tags were identified. Metadata may have been stripped during transmission or privacy processing.',
          fields: ['metadata']
        };
      }
      return null;
    }
  },

  // 8. GPS_PRESENT
  {
    ruleId: 'GPS_PRESENT',
    evaluate(metadata, fileSignature, context) {
      if (metadata.gps && (metadata.gps.latitude !== undefined || metadata.gps.longitude !== undefined)) {
        return {
          ruleId: 'GPS_PRESENT',
          severity: 'INFO',
          explanation: 'Geographic coordinates (GPS) are present in metadata. Handle according to privacy redaction policies.',
          fields: ['metadata.gps.latitude', 'metadata.gps.longitude']
        };
      }
      return null;
    }
  },

  // 9. DURATION_MISMATCH
  {
    ruleId: 'DURATION_MISMATCH',
    evaluate(metadata, fileSignature, context) {
      const containerDur = typeof metadata.durationSeconds === 'number' ? metadata.durationSeconds : null;
      const streamDur = typeof metadata.video?.duration === 'number' ? metadata.video.duration :
                        (typeof metadata.audio?.duration === 'number' ? metadata.audio.duration : null);

      if (containerDur !== null && streamDur !== null) {
        const diff = Math.abs(containerDur - streamDur);
        if (diff > 0.5) {
          return {
            ruleId: 'DURATION_MISMATCH',
            severity: 'MEDIUM',
            explanation: `Container duration (${containerDur.toFixed(2)}s) deviates from stream duration (${streamDur.toFixed(2)}s) by ${diff.toFixed(2)}s.`,
            fields: ['metadata.durationSeconds', metadata.video?.duration ? 'metadata.video.duration' : 'metadata.audio.duration']
          };
        }
      }
      return null;
    }
  },

  // 10. PDF_JAVASCRIPT
  {
    ruleId: 'PDF_JAVASCRIPT',
    evaluate(metadata, fileSignature, context) {
      if (metadata.hasJavaScript === true) {
        return {
          ruleId: 'PDF_JAVASCRIPT',
          severity: 'HIGH',
          explanation: 'PDF contains active JavaScript streams or dictionary actions.',
          fields: ['metadata.hasJavaScript']
        };
      }
      return null;
    }
  },

  // 11. PDF_EMBEDDED_FILE
  {
    ruleId: 'PDF_EMBEDDED_FILE',
    evaluate(metadata, fileSignature, context) {
      if (metadata.hasEmbeddedFiles === true) {
        return {
          ruleId: 'PDF_EMBEDDED_FILE',
          severity: 'MEDIUM',
          explanation: 'PDF contains embedded file streams or file attachment annotations.',
          fields: ['metadata.hasEmbeddedFiles']
        };
      }
      return null;
    }
  },

  // 12. PDF_INCREMENTAL_UPDATES
  {
    ruleId: 'PDF_INCREMENTAL_UPDATES',
    evaluate(metadata, fileSignature, context) {
      if (metadata.hasIncrementalUpdates === true || (metadata.eofMarkerCount && metadata.eofMarkerCount > 1)) {
        return {
          ruleId: 'PDF_INCREMENTAL_UPDATES',
          severity: 'LOW',
          explanation: `PDF contains ${metadata.eofMarkerCount || 'multiple'} %%EOF markers, indicating incremental revisions appended to the document.`,
          fields: ['metadata.eofMarkerCount', 'metadata.hasIncrementalUpdates']
        };
      }
      return null;
    }
  },

  // 13. DOC_MACROS
  {
    ruleId: 'DOC_MACROS',
    evaluate(metadata, fileSignature, context) {
      if (metadata.hasMacros === true) {
        return {
          ruleId: 'DOC_MACROS',
          severity: 'HIGH',
          explanation: 'Office document package contains executable VBA macro storage (vbaProject.bin).',
          fields: ['metadata.hasMacros']
        };
      }
      return null;
    }
  },

  // 14. TRAILING_DATA_AFTER_EOF
  {
    ruleId: 'TRAILING_DATA_AFTER_EOF',
    evaluate(metadata, fileSignature, context) {
      if (metadata.trailingBytesCount && metadata.trailingBytesCount > 0) {
        return {
          ruleId: 'TRAILING_DATA_AFTER_EOF',
          severity: 'MEDIUM',
          explanation: `Unparsed binary content (${metadata.trailingBytesCount} bytes) detected beyond the formal end-of-file terminator.`,
          fields: ['metadata.trailingBytesCount']
        };
      }
      return null;
    }
  },

  // 15. METADATA_CHANGED_BETWEEN_VERSIONS
  {
    ruleId: 'METADATA_CHANGED_BETWEEN_VERSIONS',
    evaluate(metadata, fileSignature, context) {
      const diff = context.diffFromPrevious;
      if (diff) {
        const addedCount = Object.keys(diff.added || {}).length;
        const removedCount = Object.keys(diff.removed || {}).length;
        const changedCount = Object.keys(diff.changed || {}).length;
        if (addedCount > 0 || removedCount > 0 || changedCount > 0) {
          return {
            ruleId: 'METADATA_CHANGED_BETWEEN_VERSIONS',
            severity: 'MEDIUM',
            explanation: `Metadata properties differ from previous analysis version (${changedCount} modified, ${addedCount} added, ${removedCount} removed).`,
            fields: ['diffFromPrevious']
          };
        }
      }
      return null;
    }
  }
];

/**
 * Evaluates all rules against the extracted metadata
 */
function evaluateAnomalies(metadata = {}, fileSignature = {}, context = {}) {
  const anomalies = [];

  for (const rule of RULES) {
    try {
      const result = rule.evaluate(metadata, fileSignature, context);
      if (result) {
        anomalies.push(result);
      }
    } catch (_) {}
  }

  return anomalies;
}

module.exports = {
  RULES,
  DISCLAIMER,
  evaluateAnomalies
};
