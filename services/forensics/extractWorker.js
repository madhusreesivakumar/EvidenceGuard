'use strict';

/**
 * services/forensics/extractWorker.js
 * Sprint 14A – Standalone Worker Executed in Child Process
 *
 * Runs strictly isolated with no shell access, bounded memory, and execution limits.
 * It never renders or executes file content.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yauzl = require('yauzl');
const exifr = require('exifr');
let FileType = null;
try {
  FileType = require('file-type');
} catch (_) {}
let ffprobe = null;
try {
  ffprobe = require('ffprobe-static');
} catch (_) {}
const { spawnSync } = require('child_process');

const MAX_STRING_LEN = 1000;
const MAX_KEY_LEN = 64;
const MAX_ZIP_ENTRIES = 1000;
const MAX_UNCOMPRESSED_ZIP_BYTES = 25 * 1024 * 1024; // 25 MB max

function sanitizeValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') {
    return val.length > MAX_STRING_LEN ? val.substring(0, MAX_STRING_LEN) + '...[truncated]' : val;
  }
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
    return `[Binary data: ${val.length} bytes]`;
  }
  if (Array.isArray(val)) {
    return val.slice(0, 50).map(sanitizeValue);
  }
  if (typeof val === 'object') {
    const cleanObj = {};
    for (const [k, v] of Object.entries(val)) {
      const cleanKey = String(k).substring(0, MAX_KEY_LEN);
      cleanObj[cleanKey] = sanitizeValue(v);
    }
    return cleanObj;
  }
  return String(val).substring(0, MAX_STRING_LEN);
}

function canonicalJsonString(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonString).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJsonString(obj[k])).join(',') + '}';
}

function computeMetadataHash(metadata) {
  const canonical = canonicalJsonString(metadata);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// ── 1. Magic Bytes & Signature Check ─────────────────────────────────────────
async function detectFileSignature(filePath, originalName, declaredMime) {
  const declaredExt = (path.extname(originalName || '').toLowerCase() || '').replace(/^\./, '');
  let detectedMime = 'unknown';
  let detectedExt = 'unknown';

  if (FileType) {
    try {
      const ft = await FileType.fromFile(filePath);
      if (ft) {
        detectedMime = ft.mime;
        detectedExt = ft.ext;
      }
    } catch (_) {}
  }

  // Fallback signature checks
  if (detectedMime === 'unknown') {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd);

      if (buf.slice(0, 4).toString('ascii') === '%PDF') {
        detectedMime = 'application/pdf';
        detectedExt = 'pdf';
      } else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        detectedMime = 'image/jpeg';
        detectedExt = 'jpg';
      } else if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
        detectedMime = 'image/png';
        detectedExt = 'png';
      } else if (buf.slice(0, 4).toString('hex') === '504b0304') {
        detectedMime = 'application/zip';
        detectedExt = 'zip';
      }
    } catch (_) {}
  }

  let match = false;
  if (detectedMime !== 'unknown') {
    const normDeclaredMime = (declaredMime || '').toLowerCase();
    const isJpegMatch = (detectedMime === 'image/jpeg' && (normDeclaredMime === 'image/jpeg' || normDeclaredMime === 'image/jpg' || declaredExt === 'jpg' || declaredExt === 'jpeg'));
    const isZipMatch = (detectedMime === 'application/zip' && (declaredExt === 'docx' || declaredExt === 'xlsx' || declaredExt === 'pptx' || normDeclaredMime.includes('openxmlformats')));
    const isGeneralMatch = (detectedMime === normDeclaredMime || detectedExt === declaredExt);

    match = isJpegMatch || isZipMatch || isGeneralMatch;
  } else {
    // Plain text or unrecognized
    match = declaredMime === 'text/plain' || declaredExt === 'txt' || declaredExt === 'csv';
  }

  return {
    detected: detectedMime !== 'unknown' ? `${detectedMime} (.${detectedExt})` : 'unknown',
    declared: declaredMime ? `${declaredMime} (.${declaredExt})` : `.${declaredExt}`,
    detectedMime,
    detectedExt,
    declaredMime: declaredMime || '',
    declaredExt,
    match
  };
}

// ── 2. Image Extraction (exifr) ──────────────────────────────────────────────
async function extractImageMetadata(filePath) {
  try {
    const raw = await exifr.parse(filePath, {
      tiff: true,
      xmp: true,
      iptc: true,
      jfif: true,
      gps: true,
      thumbnail: false, // Explicitly skip embedded thumbnails
      mergeOutput: true
    });

    if (!raw) return null;

    const metadata = {};
    if (raw.Make) metadata.make = raw.Make;
    if (raw.Model) metadata.model = raw.Model;
    if (raw.Software) metadata.software = raw.Software;
    if (raw.DateTimeOriginal) metadata.dateTimeOriginal = raw.DateTimeOriginal;
    if (raw.CreateDate) metadata.createDate = raw.CreateDate;
    if (raw.ModifyDate) metadata.modifyDate = raw.ModifyDate;

    // Dimensions
    if (raw.ImageWidth || raw.ExifImageWidth) metadata.imageWidth = raw.ImageWidth || raw.ExifImageWidth;
    if (raw.ImageHeight || raw.ExifImageHeight) metadata.imageHeight = raw.ImageHeight || raw.ExifImageHeight;

    // GPS & Privacy coordinates
    if (raw.latitude !== undefined && raw.longitude !== undefined) {
      metadata.gps = {
        latitude: raw.latitude,
        longitude: raw.longitude,
        altitude: raw.altitude || null
      };
    }

    // Serial numbers
    if (raw.SerialNumber || raw.BodySerialNumber || raw.LensSerialNumber) {
      metadata.deviceSerial = {
        serialNumber: raw.SerialNumber || null,
        bodySerialNumber: raw.BodySerialNumber || null,
        lensSerialNumber: raw.LensSerialNumber || null
      };
    }

    // IPTC / Authorship
    if (raw.byline || raw.artist) metadata.author = raw.byline || raw.artist;
    if (raw.copyright) metadata.copyright = raw.copyright;

    return metadata;
  } catch (_) {
    return null;
  }
}

// ── 3. Audio / Video Extraction (ffprobe) ─────────────────────────────────────
function extractMediaMetadata(filePath) {
  if (!ffprobe || !ffprobe.path) return null;

  try {
    const probeProc = spawnSync(
      ffprobe.path,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 10000, maxBuffer: 5 * 1024 * 1024, shell: false }
    );

    if (probeProc.status !== 0 || !probeProc.stdout) return null;
    const probe = JSON.parse(probeProc.stdout.toString('utf8'));

    const fmt = probe.format || {};
    const streams = probe.streams || [];
    const videoStream = streams.find(s => s.codec_type === 'video');
    const audioStream = streams.find(s => s.codec_type === 'audio');

    return {
      container: fmt.format_name || null,
      durationSeconds: fmt.duration ? parseFloat(fmt.duration) : null,
      bitrate: fmt.bit_rate ? parseInt(fmt.bit_rate, 10) : null,
      creationTime: fmt.tags?.creation_time || null,
      encoder: fmt.tags?.encoder || null,
      video: videoStream ? {
        codec: videoStream.codec_name,
        width: videoStream.width,
        height: videoStream.height,
        fps: videoStream.r_frame_rate,
        duration: videoStream.duration ? parseFloat(videoStream.duration) : null
      } : null,
      audio: audioStream ? {
        codec: audioStream.codec_name,
        sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
        channels: audioStream.channels
      } : null
    };
  } catch (_) {
    return null;
  }
}

// ── 4. PDF Extraction ────────────────────────────────────────────────────────
function extractPdfMetadata(filePath) {
  try {
    const raw = fs.readFileSync(filePath);
    const content = raw.toString('binary');

    if (!content.startsWith('%PDF-')) return null;

    // Count %%EOF occurrences (indicates incremental updates)
    const eofMatches = content.match(/%%EOF/g) || [];
    const eofCount = eofMatches.length;

    // Flags for active structural elements
    const hasJavaScript = /\/JavaScript\b|\/JS\b/.test(content);
    const hasEmbeddedFiles = /\/EmbeddedFiles\b|\/EF\b/.test(content);
    const hasLaunchActions = /\/Launch\b/.test(content);
    const isEncrypted = /\/Encrypt\b/.test(content);

    // Approximate page count
    let pageCount = null;
    const countMatch = content.match(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/);
    if (countMatch && countMatch[1]) {
      pageCount = parseInt(countMatch[1], 10);
    } else {
      const pageOccurrences = content.match(/\/Type\s*\/Page\b/g) || [];
      pageCount = pageOccurrences.length || 1;
    }

    // Info dictionary tags
    const info = {};
    const titleMatch = content.match(/\/Title\s*\(([^)]+)\)/);
    if (titleMatch) info.title = titleMatch[1];
    const authorMatch = content.match(/\/Author\s*\(([^)]+)\)/);
    if (authorMatch) info.author = authorMatch[1];
    const creatorMatch = content.match(/\/Creator\s*\(([^)]+)\)/);
    if (creatorMatch) info.creator = creatorMatch[1];
    const producerMatch = content.match(/\/Producer\s*\(([^)]+)\)/);
    if (producerMatch) info.producer = producerMatch[1];
    const creationDateMatch = content.match(/\/CreationDate\s*\(([^)]+)\)/);
    if (creationDateMatch) info.creationDate = creationDateMatch[1];
    const modDateMatch = content.match(/\/ModDate\s*\(([^)]+)\)/);
    if (modDateMatch) info.modDate = modDateMatch[1];

    return {
      pdfVersion: content.substring(5, 8),
      pageCount,
      isEncrypted,
      hasJavaScript,
      hasEmbeddedFiles,
      hasLaunchActions,
      eofMarkerCount: eofCount,
      hasIncrementalUpdates: eofCount > 1,
      info
    };
  } catch (_) {
    return null;
  }
}

// ── 5. DOCX / XLSX Extraction (Safe in-memory zip reader) ─────────────────────
function extractOfficeMetadata(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return resolve(null);

      let entryCount = 0;
      let totalUncompressedBytes = 0;
      let hasMacros = false;
      let coreXmlData = '';
      let appXmlData = '';
      let isAborted = false;

      zipfile.on('entry', (entry) => {
        if (isAborted) return;
        entryCount++;

        // Decompression bomb defense check #1: Entry count limit
        if (entryCount > MAX_ZIP_ENTRIES) {
          isAborted = true;
          zipfile.close();
          const bombErr = new Error('Decompression bomb detected: total zip entry count exceeds safety threshold');
          bombErr.code = 'DECOMPRESSION_BOMB';
          return reject(bombErr);
        }

        totalUncompressedBytes += entry.uncompressedSize || 0;

        // Decompression bomb defense check #2: Size and ratio limits
        if (totalUncompressedBytes > MAX_UNCOMPRESSED_ZIP_BYTES) {
          isAborted = true;
          zipfile.close();
          const bombErr = new Error('Decompression bomb detected: total uncompressed content exceeds memory limit');
          bombErr.code = 'DECOMPRESSION_BOMB';
          return reject(bombErr);
        }

        const fileName = entry.fileName.toLowerCase();

        // Macro detection (vbaProject.bin)
        if (fileName.includes('vbaproject.bin')) {
          hasMacros = true;
        }

        // Target docProps metadata without writing anything to disk
        if (fileName === 'docprops/core.xml') {
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr) {
              zipfile.readEntry();
              return;
            }
            readStream.on('data', chunk => {
              if (coreXmlData.length < 50000) coreXmlData += chunk.toString('utf8');
            });
            readStream.on('end', () => zipfile.readEntry());
          });
        } else if (fileName === 'docprops/app.xml') {
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr) {
              zipfile.readEntry();
              return;
            }
            readStream.on('data', chunk => {
              if (appXmlData.length < 50000) appXmlData += chunk.toString('utf8');
            });
            readStream.on('end', () => zipfile.readEntry());
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        if (isAborted) return;

        const metadata = {
          hasMacros,
          zipEntriesCount: entryCount,
          totalUncompressedBytes
        };

        // Parse core.xml properties
        if (coreXmlData) {
          const title = coreXmlData.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
          if (title) metadata.title = title[1];
          const creator = coreXmlData.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
          if (creator) metadata.author = creator[1];
          const lastModBy = coreXmlData.match(/<cp:lastModifiedBy[^>]*>([^<]+)<\/cp:lastModifiedBy>/i);
          if (lastModBy) metadata.lastModifiedBy = lastModBy[1];
          const revision = coreXmlData.match(/<cp:revision[^>]*>([^<]+)<\/cp:revision>/i);
          if (revision) metadata.revision = revision[1];
          const created = coreXmlData.match(/<dcterms:created[^>]*>([^<]+)<\/dcterms:created>/i);
          if (created) metadata.created = created[1];
          const modified = coreXmlData.match(/<dcterms:modified[^>]*>([^<]+)<\/dcterms:modified>/i);
          if (modified) metadata.modified = modified[1];
        }

        // Parse app.xml properties
        if (appXmlData) {
          const app = appXmlData.match(/<Application>([^<]+)<\/Application>/i);
          if (app) metadata.application = app[1];
          const appVer = appXmlData.match(/<AppVersion>([^<]+)<\/AppVersion>/i);
          if (appVer) metadata.appVersion = appVer[1];
          const pages = appXmlData.match(/<Pages>([^<]+)<\/Pages>/i);
          if (pages) metadata.pageCount = parseInt(pages[1], 10);
          const words = appXmlData.match(/<Words>([^<]+)<\/Words>/i);
          if (words) metadata.wordCount = parseInt(words[1], 10);
        }

        resolve(metadata);
      });

      zipfile.on('error', (zipErr) => {
        resolve(null);
      });

      zipfile.readEntry();
    });
  });
}

// ── 6. Text File Extraction ──────────────────────────────────────────────────
function extractTextMetadata(filePath) {
  try {
    const raw = fs.readFileSync(filePath);
    let encoding = 'utf-8';
    if (raw[0] === 0xff && raw[1] === 0xfe) encoding = 'utf-16le';
    else if (raw[0] === 0xfe && raw[1] === 0xff) encoding = 'utf-16be';

    const str = raw.toString(encoding);
    const lineCount = str.split(/\r\n|\r|\n/).length;
    const wordCount = (str.match(/\S+/g) || []).length;

    return {
      encoding,
      lineCount,
      wordCount,
      charCount: str.length
    };
  } catch (_) {
    return null;
  }
}

// ── Worker Main Entry Point ──────────────────────────────────────────────────
async function main() {
  const filePath = process.argv[2];
  const originalName = process.argv[3] || '';
  const declaredMime = process.argv[4] || '';

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(JSON.stringify({ success: false, error: 'File path does not exist' }));
    process.exit(1);
  }

  try {
    const stats = fs.statSync(filePath);
    const fileSignature = await detectFileSignature(filePath, originalName, declaredMime);

    let specificMetadata = null;
    const ext = path.extname(originalName || filePath).toLowerCase();

    // 1. Try Image extraction
    if (fileSignature.detectedMime.startsWith('image/') || ext.match(/\.(jpg|jpeg|png|webp|tiff)$/)) {
      specificMetadata = await extractImageMetadata(filePath);
    }

    // 2. Try Video / Audio extraction
    if (!specificMetadata && (fileSignature.detectedMime.startsWith('video/') || fileSignature.detectedMime.startsWith('audio/') || ext.match(/\.(mp4|mov|webm|mp3|wav|m4a|ogg)$/))) {
      specificMetadata = extractMediaMetadata(filePath);
    }

    // 3. Try PDF extraction
    if (!specificMetadata && (fileSignature.detectedMime === 'application/pdf' || ext === '.pdf')) {
      specificMetadata = extractPdfMetadata(filePath);
    }

    // 4. Try Office document extraction
    if (!specificMetadata && (ext.match(/\.(docx|xlsx|pptx)$/) || fileSignature.detectedMime.includes('openxmlformats') || fileSignature.detectedMime === 'application/zip')) {
      specificMetadata = await extractOfficeMetadata(filePath);
    }

    // 5. Try Text extraction
    if (!specificMetadata && (ext.match(/\.(txt|csv|log|json|md)$/) || declaredMime === 'text/plain')) {
      specificMetadata = extractTextMetadata(filePath);
    }

    const aggregated = {
      fileSize: stats.size,
      fileCreatedAt: stats.birthtime,
      fileModifiedAt: stats.mtime,
      ...(specificMetadata || {})
    };

    const sanitizedMetadata = sanitizeValue(aggregated);
    const metadataHash = computeMetadataHash(sanitizedMetadata);

    const result = {
      success: true,
      fileSignature: {
        detected: fileSignature.detected,
        declared: fileSignature.declared,
        match: fileSignature.match
      },
      metadata: sanitizedMetadata,
      metadataHash
    };

    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({
      success: false,
      error: err.code === 'DECOMPRESSION_BOMB' ? err.message : (err.message || 'Metadata extraction failed')
    }));
    process.exit(1);
  }
}

main();
