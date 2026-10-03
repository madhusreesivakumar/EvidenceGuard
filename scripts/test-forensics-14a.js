#!/usr/bin/env node
'use strict';

/**
 * scripts/test-forensics-14a.js
 * Sprint 14A – Safe Metadata Extraction & Forensics Analysis Test Suite
 *
 * Verifies:
 * 1. Isolated Child Process Worker Execution (spawn, memory limit, shell: false)
 * 2. Synthetic JPEG with EXIF & GPS metadata extraction
 * 3. Synthetic PDF with Info dictionary, JavaScript, Launch actions, and incremental %%EOF
 * 4. Synthetic DOCX extraction (core.xml, app.xml, safe zip stream, macro detection)
 * 5. Synthetic DOCX with macros (vbaProject.bin detected)
 * 6. File Signature mismatch (PNG renamed .jpg flagged as match: false)
 * 7. Decompression bomb safely refused (entry limit exceeded without disk extraction)
 * 8. Hanging parser timeout enforcement (SIGKILL after timeout threshold)
 * 9. Append-only ForensicReport enforcement (updates & deletes blocked by pre-hooks)
 * 10. Non-blocking Evidence upload (extraction failure never blocks upload, records EXTRACTION_FAILED)
 * 11. Forensics re-run endpoint (POST /api/evidence/:id/forensics/rerun) & version diffing
 * 12. Role-based privacy redaction (GET /api/evidence/:id/forensics: VIEWER redacted vs ADMIN unredacted)
 * 13. Audit logging for FORENSICS_EXTRACTED
 */

process.env.FEATURE_FORENSICS = 'true';
process.env.JWT_SECRET = 'test-forensics-jwt-secret-key-32chars!';
require('dotenv').config();

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');

let BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

const ADMIN_EMAIL = 'admin_forensics_14@evidenceguard.local';
const ADMIN_PASS  = 'AdminPass1234!';
const INV_EMAIL   = 'investigator_forensics_14@evidenceguard.local';
const INV_PASS    = 'InvestigatorPass1!';
const VIEWER_EMAIL = 'viewer_forensics_14@evidenceguard.local';
const VIEWER_PASS  = 'ViewerPass1234!';

let passed = 0;
let failed = 0;
const results = [];

function assert(description, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${description}`);
    results.push({ description, status: 'PASS' });
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${description} ${details ? '- ' + details : ''}`);
    results.push({ description, status: 'FAIL', details });
  }
}

function request(method, pathUrl, body = null, cookies = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {}
    };

    if (cookies) {
      options.headers['Cookie'] = cookies;
    }

    let payload = null;
    if (body) {
      payload = Buffer.from(JSON.stringify(body));
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = payload.length;
    }

    const reqLib = url.protocol === 'https:' ? https : http;
    const req = reqLib.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(data).toString('utf8');
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          parsed = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
          rawCookies: res.headers['set-cookie'] || []
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractCookie(rawCookies = []) {
  return rawCookies.map(c => c.split(';')[0]).join('; ');
}

async function uploadMultipart(pathUrl, fields, fileContent, fileName, cookies, mimeType = 'image/jpeg') {
  const fd = new FormData();
  const blob = new Blob([Buffer.from(fileContent)], { type: fields.mimeType || mimeType });
  fd.append('file', blob, fileName);
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, v);
  }

  const res = await fetch(new URL(pathUrl, BASE).href, {
    method: 'POST',
    headers: {
      Cookie: cookies || ''
    },
    body: fd
  });

  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ── Synthetic Fixture Generators ──────────────────────────────────────────────

/**
 * 1. Creates a synthetic JPEG Buffer with EXIF APP1 containing Make, Model, and GPS tags
 */
function createSyntheticJpegWithGps() {
  const tiff = Buffer.alloc(170);
  tiff.write('II', 0);
  tiff.writeUInt16LE(0x002A, 2);
  tiff.writeUInt32LE(8, 4);

  // IFD0
  tiff.writeUInt16LE(3, 8);
  // Make (0x010F), ASCII(2), count 10, offset 50
  tiff.writeUInt16LE(0x010F, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(10, 14);
  tiff.writeUInt32LE(50, 18);
  // Model (0x0110), ASCII(2), count 8, offset 60
  tiff.writeUInt16LE(0x0110, 22);
  tiff.writeUInt16LE(2, 24);
  tiff.writeUInt32LE(8, 26);
  tiff.writeUInt32LE(60, 30);
  // GPS IFD (0x8825), LONG(4), count 1, offset 68
  tiff.writeUInt16LE(0x8825, 34);
  tiff.writeUInt16LE(4, 36);
  tiff.writeUInt32LE(1, 38);
  tiff.writeUInt32LE(68, 42);
  tiff.writeUInt32LE(0, 46); // Next IFD

  // String values
  tiff.write('EvidenceG\0', 50, 'ascii');
  tiff.write('Cam4000\0', 60, 'ascii');

  // GPS IFD at 68
  tiff.writeUInt16LE(4, 68);
  // 0x0001: GPSLatitudeRef 'N'
  tiff.writeUInt16LE(0x0001, 70);
  tiff.writeUInt16LE(2, 72);
  tiff.writeUInt32LE(2, 74);
  tiff.write('N\0\0\0', 78, 'ascii');
  // 0x0002: GPSLatitude RATIONAL(5), count 3, offset 122
  tiff.writeUInt16LE(0x0002, 82);
  tiff.writeUInt16LE(5, 84);
  tiff.writeUInt32LE(3, 86);
  tiff.writeUInt32LE(122, 90);
  // 0x0003: GPSLongitudeRef 'W'
  tiff.writeUInt16LE(0x0003, 94);
  tiff.writeUInt16LE(2, 96);
  tiff.writeUInt32LE(2, 98);
  tiff.write('W\0\0\0', 102, 'ascii');
  // 0x0004: GPSLongitude RATIONAL(5), count 3, offset 146
  tiff.writeUInt16LE(0x0004, 106);
  tiff.writeUInt16LE(5, 108);
  tiff.writeUInt32LE(3, 110);
  tiff.writeUInt32LE(146, 114);
  tiff.writeUInt32LE(0, 118);

  // Lat rationals: 37/1, 46/1, 29/1
  tiff.writeUInt32LE(37, 122); tiff.writeUInt32LE(1, 126);
  tiff.writeUInt32LE(46, 130); tiff.writeUInt32LE(1, 134);
  tiff.writeUInt32LE(29, 138); tiff.writeUInt32LE(1, 142);

  // Long rationals: 122/1, 25/1, 10/1
  tiff.writeUInt32LE(122, 146); tiff.writeUInt32LE(1, 150);
  tiff.writeUInt32LE(25, 154); tiff.writeUInt32LE(1, 158);
  tiff.writeUInt32LE(10, 162); tiff.writeUInt32LE(1, 166);

  const tiffTrimmed = tiff.slice(0, 170);

  const app1Header = Buffer.from([0xFF, 0xE1]);
  const exifHeader = Buffer.from('Exif\0\0', 'ascii');
  const app1Length = 2 + exifHeader.length + tiffTrimmed.length;
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(app1Length, 0);

  const soi = Buffer.from([0xFF, 0xD8]);
  const sof0 = Buffer.from([0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x0A, 0x00, 0x0A, 0x01, 0x01, 0x11, 0x00]);
  const eoi = Buffer.from([0xFF, 0xD9]);

  return Buffer.concat([soi, app1Header, lenBuf, exifHeader, tiffTrimmed, sof0, eoi]);
}

/**
 * 2. Creates a synthetic PDF with JavaScript, launch action, info dict, and 2 %%EOF markers
 */
function createSyntheticPdf() {
  return Buffer.from(
`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
4 0 obj
<< /Title (Forensic Crime Scene Summary) /Author (Detective Miller) /CreationDate (D:20261003120000Z) >>
endobj
5 0 obj
<< /JavaScript (app.alert("Forensic Alert");) >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000059 00000 n 
0000000116 00000 n 
0000000163 00000 n 
0000000272 00000 n 
trailer
<< /Size 6 /Root 1 0 R /Info 4 0 R >>
startxref
340
%%EOF
% Incremental update
6 0 obj
<< /Type /Annot /Subtype /Link /A << /S /Launch /F (notepad.exe) >> >>
endobj
xref
6 1
0000000410 00000 n 
trailer
<< /Size 7 /Root 1 0 R /Info 4 0 R /Prev 340 >>
startxref
510
%%EOF
`, 'utf8');
}

/**
 * Helper to build valid zip buffers in memory
 */
function buildZipBuffer(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content || '', 'utf8');
    const size = dataBuf.length;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); // store
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(0, 14); // crc
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localHeaders.push(lh, nameBuf, dataBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16);     // CRC-32 (16..19)
    cd.writeUInt32LE(size, 20);  // Compressed size (20..23)
    cd.writeUInt32LE(size, 24);  // Uncompressed size (24..27)
    cd.writeUInt16LE(nameBuf.length, 28); // name len (28..29)
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);

    centralHeaders.push(cd, nameBuf);
    offset += 30 + nameBuf.length + size;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const b of centralHeaders) cdSize += b.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/**
 * 3. Creates clean synthetic DOCX
 */
function createSyntheticCleanDocx() {
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Incident Report</dc:title>
  <dc:creator>Special Agent Cooper</dc:creator>
  <cp:revision>2</cp:revision>
</cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Microsoft Office Word</Application>
  <Pages>5</Pages>
  <Words>1250</Words>
</Properties>`;

  return buildZipBuffer([
    { name: '[Content_Types].xml', content: '<Types></Types>' },
    { name: 'docProps/core.xml', content: coreXml },
    { name: 'docProps/app.xml', content: appXml },
    { name: 'word/document.xml', content: '<w:document></w:document>' }
  ]);
}

/**
 * 4. Creates synthetic DOCX with macro
 */
function createSyntheticMacroDocx() {
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Invoice with Macro</dc:title>
  <dc:creator>Attacker</dc:creator>
</cp:coreProperties>`;

  return buildZipBuffer([
    { name: '[Content_Types].xml', content: '<Types></Types>' },
    { name: 'docProps/core.xml', content: coreXml },
    { name: 'word/vbaProject.bin', content: Buffer.from('VBA_PROJECT_MOCK_STREAM') }
  ]);
}

/**
 * 5. Creates synthetic PNG
 */
function createSyntheticPng() {
  // Minimal PNG signature and IHDR
  return Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D,                         // IHDR length 13
    0x49, 0x48, 0x44, 0x52,                         // IHDR
    0x00, 0x00, 0x00, 0x01,                         // width 1
    0x00, 0x00, 0x00, 0x01,                         // height 1
    0x08, 0x02, 0x00, 0x00, 0x00,                   // 8-bit RGB
    0x90, 0x77, 0x53, 0xDE,                         // CRC
    0x00, 0x00, 0x00, 0x00,                         // IEND length 0
    0x49, 0x45, 0x4E, 0x44,                         // IEND
    0xAE, 0x42, 0x60, 0x82                          // CRC
  ]);
}

/**
 * 6. Creates synthetic decompression bomb zip with 1005 entries
 */
function createSyntheticDecompressionBomb() {
  const files = [];
  for (let i = 1; i <= 1005; i++) {
    files.push({ name: `file_${i}.txt`, content: 'A' });
  }
  return buildZipBuffer(files);
}

// ── Main Test Runner ──────────────────────────────────────────────────────────

(async () => {
  console.log('\n======================================================================');
  console.log('       EvidenceGuard Sprint 14A – Safe Metadata Extraction Tests       ');
  console.log('======================================================================\n');

  let mongod;
  let server;
  let externalServer = false;

  try {
    const health = await request('GET', '/api/health');
    if (health.status === 200) externalServer = true;
  } catch (_) {}

  const User = require('../models/User');
  const Evidence = require('../models/Evidence');
  const ForensicReport = require('../models/ForensicReport');
  const AuditLog = require('../models/AuditLog');
  const { ensureGenesis } = require('../services/chainService');
  const {
    runExtractionProcess,
    processForensicsForEvidence,
    projectReportForRole
  } = require('../services/forensics/forensicsService');

  if (!externalServer) {
    console.log('[Setup] Starting in-memory MongoDB environment...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);

    await ensureGenesis();

    const app = require('../server');
    server = app.listen(0);
    const addr = server.address();
    BASE = `http://localhost:${addr.port}`;
    console.log(`[Setup] In-memory server listening on ${BASE}\n`);
  }

  // Create Users
  const salt = await bcrypt.genSalt(10);
  const adminHash = await bcrypt.hash(ADMIN_PASS, salt);
  const invHash   = await bcrypt.hash(INV_PASS, salt);
  const viewerHash = await bcrypt.hash(VIEWER_PASS, salt);

  const adminUser = await User.create({
    name: 'Forensics Admin',
    email: ADMIN_EMAIL,
    passwordHash: adminHash,
    role: 'ADMIN'
  });

  const invUser = await User.create({
    name: 'Forensics Investigator',
    email: INV_EMAIL,
    passwordHash: invHash,
    role: 'INVESTIGATOR'
  });

  const viewerUser = await User.create({
    name: 'Forensics Viewer',
    email: VIEWER_EMAIL,
    passwordHash: viewerHash,
    role: 'VIEWER'
  });

  // Login users to acquire session cookies
  const adminLogin = await request('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  const adminCookie = extractCookie(adminLogin.rawCookies);

  const invLogin = await request('POST', '/api/auth/login', { email: INV_EMAIL, password: INV_PASS });
  const invCookie = extractCookie(invLogin.rawCookies);

  const viewerLogin = await request('POST', '/api/auth/login', { email: VIEWER_EMAIL, password: VIEWER_PASS });
  const viewerCookie = extractCookie(viewerLogin.rawCookies);

  const scratchDir = path.join(__dirname, '..', 'uploads', 'tmp_test_forensics');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  try {
    // ── Test 1: Isolated Worker - JPEG with EXIF & GPS Extraction ────────────
    console.log('[Test 1] Testing Image Extraction (EXIF Make, Model & GPS coordinates)...');
    const jpegBuffer = createSyntheticJpegWithGps();
    const jpegPath = path.join(scratchDir, 'test_exif.jpg');
    fs.writeFileSync(jpegPath, jpegBuffer);

    const jpegOutcome = await runExtractionProcess(jpegPath, 'test_exif.jpg', 'image/jpeg');
    assert('JPEG extraction status is COMPLETED', jpegOutcome.status === 'COMPLETED');
    assert('JPEG signature detected as image/jpeg', jpegOutcome.fileSignature?.detected?.includes('image/jpeg'));
    assert('JPEG signature match is true', jpegOutcome.fileSignature?.match === true);
    assert('JPEG EXIF Make is extracted', jpegOutcome.metadata?.make === 'EvidenceG');
    assert('JPEG EXIF Model is extracted', jpegOutcome.metadata?.model === 'Cam4000');
    assert('JPEG GPS coordinates extracted', typeof jpegOutcome.metadata?.gps?.latitude === 'number');
    assert('Metadata hash computed as 64-char hex string', typeof jpegOutcome.metadataHash === 'string' && jpegOutcome.metadataHash.length === 64);

    // ── Test 2: Isolated Worker - PDF Structure & Info Extraction ────────────
    console.log('\n[Test 2] Testing PDF Extraction (Info dictionary, JS, Launch, %%EOF count)...');
    const pdfBuffer = createSyntheticPdf();
    const pdfPath = path.join(scratchDir, 'test_doc.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);

    const pdfOutcome = await runExtractionProcess(pdfPath, 'test_doc.pdf', 'application/pdf');
    assert('PDF extraction status is COMPLETED', pdfOutcome.status === 'COMPLETED');
    assert('PDF signature detected as application/pdf', pdfOutcome.fileSignature?.detected?.includes('application/pdf'));
    assert('PDF signature match is true', pdfOutcome.fileSignature?.match === true);
    assert('PDF version extracted as 1.4', pdfOutcome.metadata?.pdfVersion === '1.4');
    assert('PDF page count extracted as 1', pdfOutcome.metadata?.pageCount === 1);
    assert('PDF detects JavaScript flag', pdfOutcome.metadata?.hasJavaScript === true);
    assert('PDF detects Launch action flag', pdfOutcome.metadata?.hasLaunchActions === true);
    assert('PDF counts 2 %%EOF markers', pdfOutcome.metadata?.eofMarkerCount === 2);
    assert('PDF detects incremental updates flag', pdfOutcome.metadata?.hasIncrementalUpdates === true);
    assert('PDF info dictionary title extracted', pdfOutcome.metadata?.info?.title === 'Forensic Crime Scene Summary');
    assert('PDF info dictionary author extracted', pdfOutcome.metadata?.info?.author === 'Detective Miller');

    // ── Test 3: Isolated Worker - Safe DOCX Extraction (Clean) ───────────────
    console.log('\n[Test 3] Testing DOCX Safe Zip Extraction (Clean document)...');
    const docxBuffer = createSyntheticCleanDocx();
    const docxPath = path.join(scratchDir, 'report.docx');
    fs.writeFileSync(docxPath, docxBuffer);

    const docxOutcome = await runExtractionProcess(docxPath, 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert('Clean DOCX extraction status is COMPLETED', docxOutcome.status === 'COMPLETED');
    assert('Clean DOCX signature match is true', docxOutcome.fileSignature?.match === true);
    assert('Clean DOCX title parsed from core.xml', docxOutcome.metadata?.title === 'Incident Report');
    assert('Clean DOCX author parsed from core.xml', docxOutcome.metadata?.author === 'Special Agent Cooper');
    assert('Clean DOCX application parsed from app.xml', docxOutcome.metadata?.application === 'Microsoft Office Word');
    assert('Clean DOCX page count parsed', docxOutcome.metadata?.pageCount === 5);
    assert('Clean DOCX word count parsed', docxOutcome.metadata?.wordCount === 1250);
    assert('Clean DOCX hasMacros is false', docxOutcome.metadata?.hasMacros === false);

    // ── Test 4: Isolated Worker - DOCX Macro Detection ───────────────────────
    console.log('\n[Test 4] Testing DOCX Macro Detection (vbaProject.bin)...');
    const macroDocxBuffer = createSyntheticMacroDocx();
    const macroDocxPath = path.join(scratchDir, 'invoice_macro.docx');
    fs.writeFileSync(macroDocxPath, macroDocxBuffer);

    const macroOutcome = await runExtractionProcess(macroDocxPath, 'invoice_macro.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert('Macro DOCX extraction status is COMPLETED', macroOutcome.status === 'COMPLETED');
    assert('Macro DOCX flags hasMacros as true', macroOutcome.metadata?.hasMacros === true);

    // ── Test 5: File Signature Mismatch (PNG renamed as .jpg) ────────────────
    console.log('\n[Test 5] Testing File Signature Mismatch (PNG renamed .jpg)...');
    const pngBuffer = createSyntheticPng();
    const spoofedPath = path.join(scratchDir, 'spoofed.jpg');
    fs.writeFileSync(spoofedPath, pngBuffer);

    const spoofOutcome = await runExtractionProcess(spoofedPath, 'spoofed.jpg', 'image/jpeg');
    assert('Spoofed file detected as image/png', spoofOutcome.fileSignature?.detected?.includes('image/png'));
    assert('Spoofed file declared as image/jpeg', spoofOutcome.fileSignature?.declared?.includes('image/jpeg'));
    assert('File signature match is FALSE for spoofed extension', spoofOutcome.fileSignature?.match === false);

    // ── Test 6: Decompression Bomb Safely Refused ─────────────────────────────
    console.log('\n[Test 6] Testing Decompression Bomb Safety (>1000 entries refused without disk write)...');
    const bombBuffer = createSyntheticDecompressionBomb();
    const bombPath = path.join(scratchDir, 'bomb.docx');
    fs.writeFileSync(bombPath, bombBuffer);

    const bombOutcome = await runExtractionProcess(bombPath, 'bomb.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert('Decompression bomb outcome is EXTRACTION_FAILED', bombOutcome.status === 'EXTRACTION_FAILED');
    assert('Decompression bomb error mentions entry count limit', bombOutcome.error?.includes('Decompression bomb detected'));

    // ── Test 7: Hanging Parser Timeout Enforcement ───────────────────────────
    console.log('\n[Test 7] Testing Timeout Enforcement (Terminating worker process)...');
    // Using a tiny 200ms timeout on a real extraction or child process
    const timeoutOutcome = await runExtractionProcess(jpegPath, 'test_exif.jpg', 'image/jpeg', 5);
    assert('Timeout outcome is EXTRACTION_FAILED', timeoutOutcome.status === 'EXTRACTION_FAILED');
    assert('Timeout error explains extraction timed out', timeoutOutcome.error?.includes('Extraction timed out') || timeoutOutcome.error?.includes('timed out'));

    // ── Test 8: Append-Only ForensicReport Protection ─────────────────────────
    console.log('\n[Test 8] Testing ForensicReport Append-Only Model Constraints...');
    const testReport = await ForensicReport.create({
      evidenceId: 'EV-TEST-APPEND',
      version: 1,
      extractorVersion: '1.0.0',
      metadata: { initial: true },
      metadataHash: '1111111111111111111111111111111111111111111111111111111111111111'
    });

    let updateBlocked = false;
    try {
      await ForensicReport.updateOne({ _id: testReport._id }, { $set: { extractorVersion: '2.0.0' } });
    } catch (e) {
      updateBlocked = true;
    }
    assert('ForensicReport updateOne is blocked by append-only hook', updateBlocked);

    let deleteBlocked = false;
    try {
      await ForensicReport.deleteOne({ _id: testReport._id });
    } catch (e) {
      deleteBlocked = true;
    }
    assert('ForensicReport deleteOne is blocked by append-only hook', deleteBlocked);

    // ── Test 9: Evidence Upload Non-Blocking Extraction ───────────────────────
    console.log('\n[Test 9] Testing Evidence Upload Non-Blocking Extraction...');
    const uploadRes = await uploadMultipart(
      '/api/evidence',
      {
        name: 'Crime Scene Photo With GPS',
        type: 'Image',
        description: 'Uploaded with automatic forensic metadata extraction'
      },
      jpegBuffer,
      'crime_scene.jpg',
      adminCookie
    );

    assert('Evidence upload succeeds with HTTP 201 Created', uploadRes.status === 201);
    const uploadedEvidenceId = uploadRes.body?.evidence?.evidenceId;
    assert('Evidence ID returned', !!uploadedEvidenceId);

    // Allow background extraction to complete
    await new Promise(r => setTimeout(r, 1200));

    const initialReport = await ForensicReport.findOne({ evidenceId: uploadedEvidenceId, version: 1 });
    assert('Forensic report automatically generated with Version 1', !!initialReport && initialReport.version === 1);
    assert('Initial report status is COMPLETED', initialReport?.status === 'COMPLETED');
    assert('Initial report diffFromPrevious is null', initialReport?.diffFromPrevious === null);

    // ── Test 10: Rerun Forensics & Version Diffing (POST /rerun) ──────────────
    console.log('\n[Test 10] Testing Forensic Rerun Endpoint & Diffing (POST /rerun)...');
    
    // Viewer is forbidden from rerun
    const viewerRerunRes = await request('POST', `/api/evidence/${uploadedEvidenceId}/forensics/rerun`, {}, viewerCookie);
    assert('VIEWER role is blocked from rerun (HTTP 403 Forbidden)', viewerRerunRes.status === 403);

    // Investigator rerun succeeds
    const invRerunRes = await request('POST', `/api/evidence/${uploadedEvidenceId}/forensics/rerun`, {}, invCookie);
    assert('INVESTIGATOR rerun succeeds (HTTP 200 OK)', invRerunRes.status === 200);
    assert('Rerun returns Version 2', invRerunRes.body?.report?.version === 2);

    // Check version count in database
    const allVersions = await ForensicReport.find({ evidenceId: uploadedEvidenceId }).sort({ version: 1 });
    assert('Two append-only versions exist in database', allVersions.length === 2);

    // ── Test 11: Role-Based Privacy Redaction (GET /forensics) ────────────────
    console.log('\n[Test 11] Testing Role-Based Privacy Redaction (GET /forensics)...');
    
    // Admin request
    const adminGetRes = await request('GET', `/api/evidence/${uploadedEvidenceId}/forensics`, null, adminCookie);
    assert('ADMIN receives HTTP 200', adminGetRes.status === 200);
    assert('ADMIN sees GPS latitude in metadata', typeof adminGetRes.body?.report?.metadata?.gps?.latitude === 'number');
    assert('ADMIN sees GPS longitude in metadata', typeof adminGetRes.body?.report?.metadata?.gps?.longitude === 'number');

    // Viewer request
    const viewerGetRes = await request('GET', `/api/evidence/${uploadedEvidenceId}/forensics`, null, viewerCookie);
    assert('VIEWER receives HTTP 200', viewerGetRes.status === 200);
    assert('VIEWER does NOT see GPS coordinates in metadata', viewerGetRes.body?.report?.metadata?.gps === undefined);
    assert('VIEWER does NOT see deviceSerial in metadata', viewerGetRes.body?.report?.metadata?.deviceSerial === undefined);
    assert('VIEWER receives privacy redaction notice', !!viewerGetRes.body?.report?.metadata?._privacyNotice);

    // ── Test 12: Forensics History Endpoint (GET /history) ────────────────────
    console.log('\n[Test 12] Testing Forensic Version History Endpoint (GET /history)...');
    const historyRes = await request('GET', `/api/evidence/${uploadedEvidenceId}/forensics/history`, null, viewerCookie);
    assert('History endpoint returns HTTP 200', historyRes.status === 200);
    assert('History returns total versions count of 2', historyRes.body?.total === 2);
    assert('History list includes versions 2 and 1', historyRes.body?.versions?.[0]?.version === 2 && historyRes.body?.versions?.[1]?.version === 1);

    // ── Test 13: Audit Trail Records FORENSICS_EXTRACTED ──────────────────────
    console.log('\n[Test 13] Testing Audit Trail Registration for FORENSICS_EXTRACTED...');
    const auditLogs = await AuditLog.find({ evidenceId: uploadedEvidenceId, action: 'FORENSICS_EXTRACTED' });
    assert('Audit log contains FORENSICS_EXTRACTED events', auditLogs.length >= 2);

  } finally {
    // Cleanup temporary files
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch (_) {}

    if (server) {
      await new Promise(r => server.close(r));
    }
    if (mongod) {
      await mongoose.disconnect();
      await mongod.stop();
    }
  }

  console.log('\n======================================================================');
  console.log(`Forensic Analysis 14A Test Results: ${passed} passed, ${failed} failed`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
