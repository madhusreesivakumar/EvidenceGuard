'use strict';

/**
 * scripts/verify-full-app.js
 * Comprehensive Full-Application E2E Test Suite for EvidenceGuard
 * Tests every page, tab, route, feature, role, and API endpoint end-to-end.
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

async function runMasterVerification() {
  console.log('\n================================================================');
  console.log('  EVIDENCEGUARD FULL PROJECT AUDIT & FEATURE VERIFICATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, extra = '') {
    if (condition) {
      console.log(`  ✅  [PASS] ${testName}`);
      passed++;
    } else {
      console.log(`  ❌  [FAIL] ${testName} ${extra}`);
      failed++;
    }
  }

  // Admin Client
  const admin = new Client();
  const adminLogin = await admin.request('POST', '/api/auth/login', { email: 'admin@eg.local', password: 'Admin1234!' });
  assert(adminLogin.status === 200 && adminLogin.body.user, '1. Admin Authentication');

  // Investigator Client
  const invest = new Client();
  const investLogin = await invest.request('POST', '/api/auth/login', { email: 'invest@eg.local', password: 'Invest123!' });
  assert(investLogin.status === 200 && investLogin.body.user, '2. Investigator Authentication');

  // Viewer Client
  const viewer = new Client();
  const viewerLogin = await viewer.request('POST', '/api/auth/login', { email: 'viewer@eg.local', password: 'Viewer123!' });
  assert(viewerLogin.status === 200 && viewerLogin.body.user, '3. Viewer Authentication');

  // 4. Dashboard Stats API
  const dashStats = await admin.request('GET', '/api/dashboard/stats');
  assert(dashStats.status === 200 && dashStats.body.data && dashStats.body.data.evidence, '4. Dashboard Stats (GET /api/dashboard/stats)');

  // 5. Evidence Listing API
  const evList = await admin.request('GET', '/api/evidence');
  assert(evList.status === 200 && Array.isArray(evList.body.items || evList.body.data), '5. Evidence List (GET /api/evidence)');
  const seededEv = (evList.body.items || evList.body.data)[0];

  // 6. Evidence Details API (via mongo _id and EV-0001)
  if (seededEv) {
    const evDetail1 = await admin.request('GET', `/api/evidence/${seededEv._id}`);
    assert(evDetail1.status === 200 && evDetail1.body.evidence, '6a. Evidence Details by ObjectId (GET /api/evidence/:mongoId)');

    const evDetail2 = await admin.request('GET', `/api/evidence/${seededEv.evidenceId}`);
    assert(evDetail2.status === 200 && evDetail2.body.evidence, '6b. Evidence Details by EvidenceID (GET /api/evidence/:evId)');

    // 7. QR Code Generation
    const qrRes = await admin.request('GET', `/api/evidence/${seededEv.evidenceId}/qr`);
    assert(qrRes.status === 200 && qrRes.body.qrCodeUrl, '7. QR Code Generation (GET /api/evidence/:id/qr)');

    // 8. Public Verification by token
    if (seededEv.publicToken) {
      const pubRes = await admin.request('GET', `/api/public/verify/${seededEv.publicToken}`);
      assert(pubRes.status === 200 && (pubRes.body.evidenceId || pubRes.body.evidence), '8. Public Token Verification (GET /api/public/verify/:token)');
    }
  }

  // 9. Evidence Upload (Investigator Role)
  const scratchDir = path.join(__dirname, '..', 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  const testFile = path.join(scratchDir, `master-test-${Date.now()}.txt`);
  fs.writeFileSync(testFile, `EvidenceGuard Master Test Document ${Date.now()}`);

  const uploadRes = await invest.postForm('/api/evidence', { name: 'Master Test File', type: 'Document', description: 'Full Audit Test' }, { fieldName: 'file', fileName: path.basename(testFile), filePath: testFile, mimeType: 'text/plain' });
  const newEvId = uploadRes.body && uploadRes.body.evidence && uploadRes.body.evidence.evidenceId;
  assert((uploadRes.status === 200 || uploadRes.status === 201) && newEvId, `9. Evidence Upload (POST /api/evidence) -> ${newEvId || 'FAILED'}`);

  // 10. File Verification (Original File -> VERIFIED)
  if (newEvId) {
    const verRes = await invest.postForm(`/api/evidence/${newEvId}/verify`, {}, { fieldName: 'file', fileName: path.basename(testFile), filePath: testFile, mimeType: 'text/plain' });
    assert(verRes.status === 200 && verRes.body.result === 'VERIFIED', '10. File Hash Verification (Original File -> VERIFIED)');

    // 11. File Verification (Tampered File -> TAMPERED)
    const tamperedFile = path.join(scratchDir, `master-tampered-${Date.now()}.txt`);
    fs.writeFileSync(tamperedFile, `MODIFIED CONTENT ${Date.now()}`);
    const verTamperedRes = await invest.postForm(`/api/evidence/${newEvId}/verify`, {}, { fieldName: 'file', fileName: 'tampered.txt', filePath: tamperedFile, mimeType: 'text/plain' });
    assert(verTamperedRes.status === 200 && verTamperedRes.body.result === 'TAMPERED', '11. File Hash Verification (Tampered File -> TAMPERED)');

    // 12. Verification History
    const histRes = await admin.request('GET', `/api/evidence/${newEvId}/verifications`);
    assert(histRes.status === 200 && Array.isArray(histRes.body.data), '12. Verification History (GET /api/evidence/:id/verifications)');

    try { fs.unlinkSync(testFile); fs.unlinkSync(tamperedFile); } catch (_) {}
  }

  // 13. Blockchain Ledger Listing
  const bcBlocks = await admin.request('GET', '/api/blockchain');
  assert(bcBlocks.status === 200 && Array.isArray(bcBlocks.body.blocks || bcBlocks.body.data), '13. Blockchain Ledger List (GET /api/blockchain)');

  // 14. Blockchain Validation
  const bcVal = await admin.request('POST', '/api/blockchain/validate', {});
  assert(bcVal.status === 200 && bcVal.body.valid === true, '14. Blockchain Ledger Validation (POST /api/blockchain/validate -> valid: true)');

  // 15. Audit Logs Listing & Filters
  const auditLogs = await admin.request('GET', '/api/audit');
  assert(auditLogs.status === 200 && Array.isArray(auditLogs.body.items || auditLogs.body.logs), '15a. Audit Trail Listing (GET /api/audit)');

  const auditFilters = await admin.request('GET', '/api/audit/filters');
  assert(auditFilters.status === 200 && auditFilters.body.actions, '15b. Audit Trail Filters (GET /api/audit/filters)');

  // 16. Chain of Custody
  const myCustody = await invest.request('GET', '/api/custody/mine');
  assert(myCustody.status === 200, '16a. Chain of Custody (GET /api/custody/mine)');

  const officers = await invest.request('GET', '/api/custody/officers');
  assert(officers.status === 200 && Array.isArray(officers.body.officers || officers.body.data), '16b. Custody Officers (GET /api/custody/officers)');

  // 17. User Management (Admin Role)
  const userList = await admin.request('GET', '/api/users');
  assert(userList.status === 200 && Array.isArray(userList.body.users || userList.body.data), '17. Users Management List (GET /api/users)');

  // 18. RBAC Security Controls — Viewer cannot upload evidence
  const viewerUpload = await viewer.postForm('/api/evidence', { name: 'Unauthorized File', type: 'Document' }, { fieldName: 'file', fileName: 'test.txt', filePath: path.join(__dirname, '..', 'demo-files', 'case_document.txt'), mimeType: 'text/plain' });
  assert(viewerUpload.status === 403, '18. RBAC Security (Viewer upload blocked with 403 Forbidden)');

  console.log('\n----------------------------------------------------------------');
  console.log(`  MASTER AUDIT SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('----------------------------------------------------------------\n');

  if (failed > 0) process.exit(1);
}

runMasterVerification().catch(err => {
  console.error('Fatal master test runner failure:', err);
  process.exit(1);
});
