'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE = 'http://localhost:3000';

function request(method, pathStr, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathStr, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let cookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0] : null;
        let token = null;
        if (cookie) {
          const match = cookie.match(/token=([^;]+)/);
          if (match) token = match[1];
        }
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, token, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, token, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      if (Buffer.isBuffer(body) || typeof body === 'string') {
        req.write(body);
      }
    }
    req.end();
  });
}

function postForm(pathStr, token, fields, fileField) {
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
    if (token) {
      headers['Cookie'] = `token=${token}`;
      headers['Authorization'] = `Bearer ${token}`;
    }

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

async function runTests() {
  console.log('\n🧪  Running EvidenceGuard API Verification Tests...\n');
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message, extra = '') {
    if (condition) {
      console.log(`  ✅  PASS: ${message}`);
      passCount++;
    } else {
      console.log(`  ❌  FAIL: ${message} ${extra}`);
      failCount++;
    }
  }

  // 1. Admin Login
  const loginRes = await request('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, JSON.stringify({ email: 'admin@eg.local', password: 'Admin1234!' }));
  assert(loginRes.status === 200 && loginRes.token, 'Admin login returns 200 + token cookie');
  const adminToken = loginRes.token;
  const adminHeaders = { 'Cookie': `token=${adminToken}`, 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  // 2. Viewer Login
  const viewerRes = await request('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, JSON.stringify({ email: 'viewer@eg.local', password: 'Viewer123!' }));
  assert(viewerRes.status === 200 && viewerRes.token, 'Viewer login returns 200 + token cookie');
  const viewerToken = viewerRes.token;

  // 3. Evidence List
  const listRes = await request('GET', '/api/evidence', adminHeaders);
  const records = listRes.body.items || listRes.body.records || listRes.body.data;
  assert(listRes.status === 200 && Array.isArray(records), 'GET /api/evidence returns evidence items array');
  const seeded = records[0];

  // 4. Evidence Details with Mongo _id and EV-XXXX
  if (seeded) {
    const detailsIdRes = await request('GET', `/api/evidence/${seeded._id}`, adminHeaders);
    assert(detailsIdRes.status === 200 && detailsIdRes.body.evidence && detailsIdRes.body.evidence.evidenceId === seeded.evidenceId, 'GET /api/evidence/:mongoId returns evidence details');

    const detailsEvRes = await request('GET', `/api/evidence/${seeded.evidenceId}`, adminHeaders);
    assert(detailsEvRes.status === 200 && detailsEvRes.body.evidence, 'GET /api/evidence/:evId returns evidence details');
  } else {
    assert(false, 'Seeded evidence record found');
  }

  // 5. Upload New Unique Evidence
  const scratchDir = path.join(__dirname, '..', 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  const testFilePath = path.join(scratchDir, `test-${Date.now()}.txt`);
  fs.writeFileSync(testFilePath, `EvidenceGuard Test File ${Date.now()}`);

  const uploadRes = await postForm('/api/evidence', adminToken, { name: 'New Test Document', type: 'Document', description: 'API Test Evidence' }, { fieldName: 'file', fileName: path.basename(testFilePath), filePath: testFilePath, mimeType: 'text/plain' });
  const uploadedEvId = uploadRes.body && (uploadRes.body.evidenceId || (uploadRes.body.evidence && uploadRes.body.evidence.evidenceId));
  assert((uploadRes.status === 200 || uploadRes.status === 201) && uploadedEvId, `Upload evidence created: ${uploadedEvId || ''}`, JSON.stringify(uploadRes.body));
  const newEvId = uploadedEvId;

  // 6. Verify Evidence — Original File (expect VERIFIED)
  if (newEvId) {
    const verifyRes = await postForm(`/api/evidence/${newEvId}/verify`, adminToken, {}, { fieldName: 'file', fileName: path.basename(testFilePath), filePath: testFilePath, mimeType: 'text/plain' });
    assert(verifyRes.status === 200 && verifyRes.body.result === 'VERIFIED', 'Verification of matching file returns VERIFIED', JSON.stringify(verifyRes.body));

    // 7. Verify Evidence — Tampered File (expect TAMPERED)
    const tamperedTestPath = path.join(scratchDir, `test-tampered-${Date.now()}.txt`);
    fs.writeFileSync(tamperedTestPath, `EvidenceGuard TAMPERED File ${Date.now()}`);
    const verifyTamperedRes = await postForm(`/api/evidence/${newEvId}/verify`, adminToken, {}, { fieldName: 'file', fileName: 'tampered.txt', filePath: tamperedTestPath, mimeType: 'text/plain' });
    assert(verifyTamperedRes.status === 200 && verifyTamperedRes.body.result === 'TAMPERED', 'Verification of modified file returns TAMPERED', JSON.stringify(verifyTamperedRes.body));

    // Cleanup temp test files
    try { fs.unlinkSync(testFilePath); fs.unlinkSync(tamperedTestPath); } catch (_) {}
  } else {
    assert(false, 'Skipping verification tests (upload failed)');
  }

  // 8. Blockchain Listing
  const bcRes = await request('GET', '/api/blockchain', adminHeaders);
  const blocks = bcRes.body.blocks || bcRes.body.data;
  assert(bcRes.status === 200 && Array.isArray(blocks), 'GET /api/blockchain returns blocks array');

  // 9. Blockchain Validate
  const valRes = await request('POST', '/api/blockchain/validate', adminHeaders);
  assert(valRes.status === 200 && valRes.body.valid === true, 'POST /api/blockchain/validate returns valid: true');

  // 10. Audit Trail
  const auditRes = await request('GET', '/api/audit', adminHeaders);
  const auditLogs = auditRes.body.items || auditRes.body.logs || auditRes.body.data;
  assert(auditRes.status === 200 && Array.isArray(auditLogs), 'GET /api/audit returns audit logs array');

  // 11. RBAC Test — VIEWER uploading evidence (expect 403)
  const viewerUploadRes = await postForm('/api/evidence', viewerToken, { name: 'Unauthorized Upload', type: 'Document' }, { fieldName: 'file', fileName: 'test.txt', filePath: path.join(__dirname, '..', 'demo-files', 'case_document.txt'), mimeType: 'text/plain' });
  assert(viewerUploadRes.status === 403, 'RBAC Enforced: VIEWER upload rejected with 403 Forbidden');

  // 12. Chain of Custody
  const custodyRes = await request('GET', '/api/custody/mine', adminHeaders);
  assert(custodyRes.status === 200, 'GET /api/custody/mine returns 200');

  console.log(`\n📊  Verification Summary: ${passCount} Passed, ${failCount} Failed.\n`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
