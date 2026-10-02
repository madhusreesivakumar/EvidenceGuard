/**
 * EvidenceGuard – Sprint 1 API Test Suite
 * Tests all 16 endpoints. Run: node test-sprint1.js
 */
'use strict';

const BASE = 'http://localhost:3000';
let TOKEN  = '';
let EVIDENCE_ID = '';
let USER_ID = '';
let passes = 0, fails = 0;

const fetch = (...args) => import('node-fetch').then(m => m.default(...args)).catch(() => {
  // node-fetch not installed — use global fetch (Node 18+)
  return globalThis.fetch(...args);
});

async function req(method, path, body, auth = true) {
  const h = { 'Content-Type': 'application/json' };
  if (auth && TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
  const r = await globalThis.fetch(`${BASE}${path}`, {
    method, headers: h, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json() };
}

function ok(label, cond, extra = '') {
  if (cond) { passes++; console.log(`  ✅ PASS  ${label}${extra ? ' — ' + extra : ''}`); }
  else       { fails++;  console.log(`  ❌ FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}

async function run() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  EvidenceGuard Sprint 1 — API Test Suite');
  console.log('═══════════════════════════════════════════\n');

  // ── 1. HTML pages ──────────────────────────────────────────────
  console.log('[ HTML Pages ]');
  const pages = ['/', '/login.html', '/register.html', '/dashboard.html', '/upload.html',
                 '/records.html', '/verify.html', '/evidence-details.html',
                 '/blockchain.html', '/audit.html', '/users.html', '/about.html'];
  for (const p of pages) {
    const r = await globalThis.fetch(`${BASE}${p}`);
    ok(`GET ${p}`, r.status === 200 && r.headers.get('content-type')?.includes('text/html'), `HTTP ${r.status}`);
  }

  // ── 2. Auth ────────────────────────────────────────────────────
  console.log('\n[ Auth Endpoints ]');

  // Register – validation: missing password
  let r = await req('POST', '/api/auth/register', { name: 'Test', email: 'no@pass.com' });
  ok('POST /api/auth/register – 400 missing password', r.status === 400 && r.body.success === false, r.body.message);

  // Register – duplicate email
  r = await req('POST', '/api/auth/register', { name: 'Dup', email: 'admin@evidenceguard.com', password: 'test123' });
  ok('POST /api/auth/register – 409 duplicate email', r.status === 409 && r.body.success === false, r.body.message);

  // Register – new user
  r = await req('POST', '/api/auth/register', { name: 'Test Tester', email: 'tester@eg.com', password: 'test123', role: 'viewer' });
  ok('POST /api/auth/register – 201 success', r.status === 201 && r.body.success === true && r.body.data?.token, `token=${r.body.data?.token?.slice(0,20)}…`);

  // Login – wrong password
  r = await req('POST', '/api/auth/login', { email: 'admin@evidenceguard.com', password: 'WRONG' });
  ok('POST /api/auth/login – 401 wrong password', r.status === 401 && r.body.success === false, r.body.message);

  // Login – valid admin
  r = await req('POST', '/api/auth/login', { email: 'admin@evidenceguard.com', password: 'Admin@123456' });
  ok('POST /api/auth/login – 200 success', r.status === 200 && r.body.success === true && r.body.data?.token);
  TOKEN = r.body.data?.token || '';
  USER_ID = r.body.data?.user?.id || '';

  // GET /api/auth/me
  r = await req('GET', '/api/auth/me');
  ok('GET /api/auth/me – 200 returns user', r.status === 200 && r.body.data?.email === 'admin@evidenceguard.com', r.body.data?.email);

  // GET /api/auth/me – no token
  r = await req('GET', '/api/auth/me', undefined, false);
  ok('GET /api/auth/me – 401 no token', r.status === 401 && r.body.success === false, r.body.message);

  // ── 3. Stats ───────────────────────────────────────────────────
  console.log('\n[ Stats ]');
  r = await req('GET', '/api/stats');
  ok('GET /api/stats – 200 returns counts', r.status === 200 && r.body.data?.total >= 5, `total=${r.body.data?.total}`);
  ok('GET /api/stats – verified count ≥ 3', (r.body.data?.verified || 0) >= 3, `verified=${r.body.data?.verified}`);
  ok('GET /api/stats – blockchainBlocks ≥ 6', (r.body.data?.blockchainBlocks || 0) >= 6, `blocks=${r.body.data?.blockchainBlocks}`);

  // ── 4. Evidence ────────────────────────────────────────────────
  console.log('\n[ Evidence Endpoints ]');

  // GET /api/evidence
  r = await req('GET', '/api/evidence?limit=5');
  ok('GET /api/evidence – 200 array ≥ 5', r.status === 200 && (r.body.data?.evidence?.length || 0) >= 5, `count=${r.body.data?.evidence?.length}`);
  EVIDENCE_ID = r.body.data?.evidence?.[0]?.evidenceId || 'EV-001';

  // GET /api/evidence?search=CCTV
  r = await req('GET', '/api/evidence?search=CCTV');
  ok('GET /api/evidence?search – filters correctly', r.status === 200 && (r.body.data?.evidence?.length || 0) >= 1, `found=${r.body.data?.evidence?.length}`);

  // GET /api/evidence?type=Video
  r = await req('GET', '/api/evidence?type=Video');
  ok('GET /api/evidence?type=Video – filtered', r.status === 200, `HTTP ${r.status}`);

  // GET /api/evidence?status=Tampered
  r = await req('GET', '/api/evidence?status=Tampered');
  ok('GET /api/evidence?status=Tampered – found 1', r.status === 200 && (r.body.data?.evidence?.length || 0) >= 1, `count=${r.body.data?.evidence?.length}`);

  // GET /api/evidence/:id – valid
  r = await req('GET', `/api/evidence/${EVIDENCE_ID}`);
  ok(`GET /api/evidence/${EVIDENCE_ID} – 200 found`, r.status === 200 && r.body.data?.evidenceId === EVIDENCE_ID, r.body.data?.name);

  // GET /api/evidence/:id – not found
  r = await req('GET', '/api/evidence/EV-999');
  ok('GET /api/evidence/EV-999 – 404', r.status === 404 && r.body.success === false, r.body.message);

  // POST /api/evidence – missing file (multipart needed, skip here)
  console.log(`  ⏭  SKIP  POST /api/evidence – file upload (requires multipart/form-data, tested manually)`);

  // POST /api/evidence/:id/verify – demo mode (no file)
  r = await req('POST', `/api/evidence/EV-002/verify`, {});
  ok('POST /api/evidence/EV-002/verify – demo verified', r.status === 200 && r.body.data?.result === 'verified', `result=${r.body.data?.result}`);

  // POST /api/evidence/:id/verify – demo tampered
  r = await req('POST', `/api/evidence/EV-004/verify`, {});
  ok('POST /api/evidence/EV-004/verify – demo tampered', r.status === 200 && r.body.data?.result === 'tampered', `result=${r.body.data?.result}`);

  // GET /api/evidence/:id/qr
  r = await req('GET', `/api/evidence/${EVIDENCE_ID}/qr`);
  ok(`GET /api/evidence/${EVIDENCE_ID}/qr – 200 qrDataUrl`, r.status === 200 && r.body.data?.qrDataUrl?.startsWith('data:image/'), `url=${r.body.data?.verifyUrl}`);

  // DELETE /api/evidence – admin can delete
  // (skip to preserve demo data)
  console.log(`  ⏭  SKIP  DELETE /api/evidence/:id – skipped to preserve demo data`);

  // ── 5. Blockchain ──────────────────────────────────────────────
  console.log('\n[ Blockchain Endpoints ]');
  r = await req('GET', '/api/blockchain?limit=10');
  ok('GET /api/blockchain – 200 returns blocks', r.status === 200 && (r.body.data?.blocks?.length || 0) >= 6, `blocks=${r.body.data?.blocks?.length}`);
  ok('GET /api/blockchain – genesis block present', r.body.data?.blocks?.some(b => b.blockNumber === 0), `first block #${r.body.data?.blocks?.[0]?.blockNumber}`);

  r = await req('POST', '/api/blockchain/validate');
  ok('POST /api/blockchain/validate – VALID', r.status === 200 && r.body.data?.valid === true, `valid=${r.body.data?.valid}, checked=${r.body.data?.blocksChecked}`);

  // ── 6. Audit ───────────────────────────────────────────────────
  console.log('\n[ Audit Endpoint ]');
  r = await req('GET', '/api/audit?limit=20');
  ok('GET /api/audit – 200 returns logs', r.status === 200 && (r.body.data?.logs?.length || 0) >= 10, `logs=${r.body.data?.logs?.length}`);
  ok('GET /api/audit – logs have action field', r.body.data?.logs?.[0]?.action != null, r.body.data?.logs?.[0]?.action);

  // Viewer should not access audit
  const vRes = await req('POST', '/api/auth/login', { email: 'viewer@evidenceguard.com', password: 'View@123456' });
  const vToken = vRes.body.data?.token;
  const savedToken = TOKEN;
  TOKEN = vToken;
  r = await req('GET', '/api/audit');
  ok('GET /api/audit – 403 for viewer', r.status === 403 && r.body.success === false, r.body.message);
  TOKEN = savedToken;

  // ── 7. Users ───────────────────────────────────────────────────
  console.log('\n[ User Management Endpoints ]');
  r = await req('GET', '/api/users');
  ok('GET /api/users – 200 admin can list', r.status === 200 && Array.isArray(r.body.data), `count=${r.body.data?.length}`);

  // Create user
  r = await req('POST', '/api/users', { name: 'Sprint User', email: 'sprint@eg.com', password: 'sprint123', role: 'investigator' });
  ok('POST /api/users – 201 created', r.status === 201 && r.body.success === true, r.body.data?.email);
  const newUserId = r.body.data?.id;

  // Patch role
  r = await req('PATCH', `/api/users/${newUserId}/role`, { role: 'viewer' });
  ok('PATCH /api/users/:id/role – 200 updated', r.status === 200 && r.body.data?.role === 'viewer', r.body.data?.role);

  // Delete user
  r = await req('DELETE', `/api/users/${newUserId}`);
  ok('DELETE /api/users/:id – 200 deleted', r.status === 200 && r.body.success === true, r.body.message);

  // Cannot delete own account
  r = await req('DELETE', `/api/users/${USER_ID}`);
  ok('DELETE /api/users/:id – 400 cannot delete self', r.status === 400 && r.body.success === false, r.body.message);

  // POST /api/auth/logout
  r = await req('POST', '/api/auth/logout');
  ok('POST /api/auth/logout – 200', r.status === 200 && r.body.success === true, r.body.message);

  // ── Summary ────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log(`  Results: ${passes} passed, ${fails} failed out of ${passes + fails} tests`);
  console.log('═══════════════════════════════════════════\n');
  process.exit(fails > 0 ? 1 : 0);
}

run().catch(e => { console.error('Test runner error:', e.message); process.exit(1); });
