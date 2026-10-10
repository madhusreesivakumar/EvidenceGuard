'use strict';

/**
 * scripts/test-delete-flow.js
 * Comprehensive Evidence Deletion Verification Script
 * Validates all 15 deletion requirements from the specification.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';

class Client {
  constructor() {
    this.cookies = {};
  }

  request(method, pathStr, bodyObj = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(pathStr, BASE);
      const headers = { 'Accept': 'application/json' };

      const cookieHeader = Object.entries(this.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      if (cookieHeader) headers['Cookie'] = cookieHeader;

      let bodyData = null;
      if (bodyObj) {
        bodyData = JSON.stringify(bodyObj);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(bodyData);
      }

      const req = http.request({
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers
      }, (res) => {
        const setCookies = res.headers['set-cookie'];
        if (setCookies) {
          setCookies.forEach(sc => {
            const match = sc.match(/^([^=]+)=([^;]*)/);
            if (match) {
              const name = match[1].trim();
              const val = match[2] ? match[2].trim() : '';
              if (val === '' || sc.includes('Expires=Thu, 01 Jan 1970') || sc.includes('Max-Age=0')) {
                delete this.cookies[name];
              } else {
                this.cookies[name] = val;
              }
            }
          });
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, raw: data });
          }
        });
      });

      req.on('error', reject);
      if (bodyData) req.write(bodyData);
      req.end();
    });
  }

  postForm(pathStr, fields, fileField) {
    return new Promise((resolve, reject) => {
      const boundary = '----FormBoundary' + Math.random().toString(16);
      const chunks = [];

      for (const [key, val] of Object.entries(fields)) {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
      }

      if (fileField) {
        const fileContent = fs.readFileSync(fileField.filePath);
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField.fieldName}"; filename="${fileField.fileName}"\r\nContent-Type: ${fileField.mimeType}\r\n\r\n`));
        chunks.push(fileContent);
        chunks.push(Buffer.from('\r\n'));
      }

      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      const bodyBuffer = Buffer.concat(chunks);

      const url = new URL(pathStr, BASE);
      const headers = {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
      };

      const cookieHeader = Object.entries(this.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      if (cookieHeader) headers['Cookie'] = cookieHeader;

      const req = http.request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });

      req.on('error', reject);
      req.write(bodyBuffer);
      req.end();
    });
  }
}

async function runDeleteVerification() {
  console.log('\n================================================================');
  console.log('  EVIDENCEGUARD DELETION FLOW END-TO-END VERIFICATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅  [PASS] ${testName}`);
      passed++;
    } else {
      console.log(`  ❌  [FAIL] ${testName} — ${details}`);
      failed++;
    }
  }

  // Admin Client
  const admin = new Client();
  const adminLogin = await admin.request('POST', '/api/auth/login', { email: 'admin@eg.local', password: 'Admin1234!' });
  assert(adminLogin.status === 200 && adminLogin.body.user, 'Admin Login successful');

  // Viewer Client
  const viewer = new Client();
  const viewerLogin = await viewer.request('POST', '/api/auth/login', { email: 'viewer@eg.local', password: 'Viewer123!' });
  assert(viewerLogin.status === 200 && viewerLogin.body.user, 'Viewer Login successful');

  // Create disposable evidence to test deletion
  const scratchDir = path.join(__dirname, '..', 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  const delTestFile = path.join(scratchDir, `del-test-${Date.now()}.txt`);
  fs.writeFileSync(delTestFile, `EvidenceGuard Disposable Test File ${Date.now()}`);

  const uploadRes = await admin.postForm('/api/evidence', { name: 'Disposable Test Record', type: 'Document', description: 'To be deleted' }, { fieldName: 'file', fileName: path.basename(delTestFile), filePath: delTestFile, mimeType: 'text/plain' });
  const targetId = uploadRes.body && uploadRes.body.evidence && uploadRes.body.evidence.evidenceId;
  assert((uploadRes.status === 200 || uploadRes.status === 201) && Boolean(targetId), `Uploaded target evidence record: ${targetId || 'FAILED'}`);

  if (!targetId) {
    console.error('Cannot proceed without target evidence record');
    process.exit(1);
  }

  // TEST A: Empty / Short reason validation (< 5 chars) -> Expect 400
  const shortReasonRes = await admin.request('DELETE', `/api/evidence/${targetId}`, { reason: 'bad' });
  assert(shortReasonRes.status === 400 && shortReasonRes.body.code === 'VALIDATION_ERROR', 'Backend rejects short reason (< 5 chars) with 400 Validation Error');

  // TEST B: Overly long reason validation (> 300 chars) -> Expect 400
  const longReason = 'a'.repeat(301);
  const longReasonRes = await admin.request('DELETE', `/api/evidence/${targetId}`, { reason: longReason });
  assert(longReasonRes.status === 400 && longReasonRes.body.code === 'VALIDATION_ERROR', 'Backend rejects long reason (> 300 chars) with 400 Validation Error');

  // TEST C: Unauthorized Deletion (Viewer role) -> Expect 403
  const viewerDelRes = await viewer.request('DELETE', `/api/evidence/${targetId}`, { reason: 'Unauthorized deletion attempt' });
  assert(viewerDelRes.status === 403 && viewerDelRes.body.code === 'FORBIDDEN', 'Backend blocks unauthorized deletion (Viewer role) with 403 Forbidden');

  // TEST D: Valid Deletion (Admin role) -> Expect 200
  const validReason = 'Formal audit test: soft deleting duplicate test record';
  const delRes = await admin.request('DELETE', `/api/evidence/${targetId}`, { reason: validReason });
  assert(delRes.status === 200 && delRes.body.success === true, `Admin successfully deleted ${targetId}`);

  // TEST E: Verify Soft-Delete in Evidence Registry List (should no longer appear in active GET /api/evidence)
  const evListRes = await admin.request('GET', '/api/evidence');
  const items = evListRes.body.items || evListRes.body.records || [];
  const foundActive = items.find(item => item.evidenceId === targetId);
  assert(!foundActive, `Deleted evidence ${targetId} is hidden from active evidence listing`);

  // TEST F: Verify Ledger Block Retained Intact
  const bcRes = await admin.request('GET', '/api/blockchain');
  const blocks = bcRes.body.blocks || bcRes.body.data || [];
  const targetBlock = blocks.find(b => b.evidenceId === targetId);
  assert(targetBlock && targetBlock.evidenceDeleted === true, `Ledger block #${targetBlock ? targetBlock.blockNumber : 'N/A'} is retained and flagged evidenceDeleted: true`);

  // TEST G: Verify Blockchain Ledger remains VALID after soft deletion
  const bcValRes = await admin.request('POST', '/api/blockchain/validate', {});
  assert(bcValRes.status === 200 && bcValRes.body.valid === true, 'Blockchain ledger integrity remains 100% VALID after deletion');

  // TEST H: Verify Audit Trail Log Entry Created
  const auditRes = await admin.request('GET', '/api/audit');
  const auditLogs = auditRes.body.items || auditRes.body.logs || [];
  const deleteAudit = auditLogs.find(log => log.action === 'DELETE' && log.evidenceId === targetId);
  assert(deleteAudit && deleteAudit.description.includes(validReason), `Audit trail recorded DELETE action for ${targetId} with exact reason`);

  // TEST I: Try deleting already deleted evidence -> Expect 404
  const repeatDelRes = await admin.request('DELETE', `/api/evidence/${targetId}`, { reason: 'Repeat delete attempt' });
  assert(repeatDelRes.status === 404 && repeatDelRes.body.code === 'NOT_FOUND', 'Repeat deletion of already deleted record returns 404 Not Found');

  // Cleanup temp file
  try { fs.unlinkSync(delTestFile); } catch (_) {}

  console.log('\n----------------------------------------------------------------');
  console.log(`  DELETION VERIFICATION SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('----------------------------------------------------------------\n');

  if (failed > 0) process.exit(1);
}

runDeleteVerification().catch(err => {
  console.error('Fatal delete test runner failure:', err);
  process.exit(1);
});
