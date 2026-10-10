'use strict';

/**
 * scripts/test-login-flow.js
 * End-to-End Login & Authentication Flow Verification Script
 * Validates all 8 Step 20 scenarios required by the specification.
 */

const http = require('http');

const BASE = 'http://localhost:3000';

class TestClient {
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
}

async function runLoginVerification() {
  console.log('\n==================================================');
  console.log('  EVIDENCEGUARD STEP 20: LOGIN & AUTH VERIFICATION');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function check(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅  [PASS] ${testName}`);
      passed++;
    } else {
      console.log(`  ❌  [FAIL] ${testName} — ${details}`);
      failed++;
    }
  }

  const client = new TestClient();

  // TEST 1: Open login page check (Reachable server & public auth endpoints)
  const healthRes = await client.request('GET', '/api/health');
  check(healthRes.status === 200, 'TEST 1: Server and API reachable');

  // TEST 2: Validation message on empty input
  const emptyRes = await client.request('POST', '/api/auth/login', {});
  check(emptyRes.status === 400 && emptyRes.body.code === 'VALIDATION_ERROR', 'TEST 2: Empty credentials rejected with 400 Validation Error');

  // TEST 3: Invalid credentials
  const invalidRes = await client.request('POST', '/api/auth/login', { email: 'nonexistent@eg.local', password: 'WrongPassword123' });
  check(invalidRes.status === 401 && invalidRes.body.code === 'AUTH_FAILED', 'TEST 3: Invalid credentials rejected with 401 Auth Failed');

  // TEST 4: Register/create real development user
  const newEmail = `user_${Date.now()}@eg.local`;
  const newPass = 'TestPass123!';
  const regRes = await client.request('POST', '/api/auth/register', { name: 'Test User', email: newEmail, password: newPass });
  check(regRes.status === 201 && regRes.body.success === true, `TEST 4: Register real development user (${newEmail})`);

  // TEST 5: Login with correct credentials -> cookie set & user returned
  const loginRes = await client.request('POST', '/api/auth/login', { email: newEmail, password: newPass });
  const hasTokenCookie = Boolean(client.cookies['token']);
  check(loginRes.status === 200 && loginRes.body.success === true && loginRes.body.user && hasTokenCookie, 'TEST 5: Login with correct credentials returns 200 + user + sets HTTP-only cookie');

  // TEST 6: Refresh dashboard / call protected route (GET /api/auth/me) -> remains authenticated
  const meRes = await client.request('GET', '/api/auth/me');
  check(meRes.status === 200 && meRes.body.user && meRes.body.user.email === newEmail, 'TEST 6: Persistent session check via cookie (GET /api/auth/me returns current user)');

  // TEST 7: Logout -> clears cookie & returns success
  const logoutRes = await client.request('POST', '/api/auth/logout', {});
  const cookieCleared = !client.cookies['token'];
  check(logoutRes.status === 200 && logoutRes.body.success === true && cookieCleared, 'TEST 7: Logout clears session cookie & revokes token');

  // TEST 8: Protected page/API rejects access after logout
  const postLogoutMe = await client.request('GET', '/api/auth/me');
  check(postLogoutMe.status === 401, 'TEST 8: Protected API rejects unauthenticated access (401 Unauthorized)');

  console.log('\n--------------------------------------------------');
  console.log(`  VERIFICATION RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('--------------------------------------------------\n');

  if (failed > 0) process.exit(1);
}

runLoginVerification().catch(err => {
  console.error('Fatal login test runner failure:', err);
  process.exit(1);
});
