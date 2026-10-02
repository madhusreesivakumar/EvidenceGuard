'use strict';
/**
 * scripts/test-sprint0.js
 * Sprint 0 checklist verification.
 * Run: node scripts/test-sprint0.js  (server must be running)
 */

const BASE = 'http://localhost:3000';
let passes = 0, fails = 0;

function ok(label, cond, detail = '') {
  if (cond) { passes++; console.log(`  ✅ PASS  ${label}${detail ? '  —  ' + detail : ''}`); }
  else       { fails++;  console.log(`  ❌ FAIL  ${label}${detail ? '  —  ' + detail : ''}`); }
}

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const r = await globalThis.fetch(`${BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, ct: r.headers.get('content-type') || '', body: await r.json().catch(() => ({})) };
}

async function run() {
  console.log('\n════════════════════════════════════════════════');
  console.log('  EvidenceGuard Sprint 0 — Setup & Audit Check');
  console.log('════════════════════════════════════════════════\n');

  // ── 1. Checklist: npm install ──────────────────────────────────
  console.log('[ Package check ]');
  const pkg = require('../package.json');
  const required = ['express','mongoose','bcryptjs','jsonwebtoken','cookie-parser',
                    'dotenv','helmet','cors','express-rate-limit','multer','qrcode','zod'];
  const devRequired = ['nodemon','mongodb-memory-server'];
  for (const dep of required)    ok(`package.json has "${dep}"`, dep in (pkg.dependencies || {}));
  for (const dep of devRequired) ok(`package.json has "${dep}" (dev)`, dep in (pkg.devDependencies || {}));

  // ── 2. Checklist: GET /api/health ──────────────────────────────
  console.log('\n[ Health endpoint ]');
  let r = await req('GET', '/api/health');
  ok('GET /api/health — 200', r.status === 200, `HTTP ${r.status}`);
  ok('GET /api/health — success:true', r.body.success === true, JSON.stringify(r.body.data?.db));
  ok('GET /api/health — db=connected', r.body.data?.db === 'connected', r.body.data?.db);
  ok('GET /api/health — has uptime', typeof r.body.data?.uptime === 'string', r.body.data?.uptime);

  // ── 3. Checklist: pages still open ────────────────────────────
  console.log('\n[ HTML pages served from /public ]');
  const pages = [
    '/', '/login.html', '/register.html', '/dashboard.html',
    '/upload.html', '/records.html', '/verify.html',
    '/evidence-details.html', '/blockchain.html',
    '/audit.html', '/users.html', '/about.html'
  ];
  for (const p of pages) {
    const res = await globalThis.fetch(`${BASE}${p}`);
    ok(`GET ${p}`, res.status === 200 && (res.headers.get('content-type') || '').includes('text/html'), `HTTP ${res.status}`);
  }

  // ── 4. Middleware stack ────────────────────────────────────────
  console.log('\n[ Middleware & security ]');
  const anyPage = await globalThis.fetch(`${BASE}/login.html`);
  ok('Helmet: X-Content-Type-Options header set', anyPage.headers.get('x-content-type-options') === 'nosniff');
  ok('Helmet: X-Frame-Options header set', anyPage.headers.get('x-frame-options') != null);

  const apiPage = await globalThis.fetch(`${BASE}/api/health`);
  ok('CORS: access-control-allow-origin set', apiPage.headers.get('access-control-allow-origin') != null);

  // ── 5. 404 handler ─────────────────────────────────────────────
  console.log('\n[ Error handling ]');
  r = await req('GET', '/api/nonexistent-route');
  ok('GET /api/nonexistent → 404 JSON', r.status === 404 && r.body.success === false, r.body.message);
  ok('404 JSON: no stack trace', !JSON.stringify(r.body).includes('at '));

  r = await req('GET', '/api/stats');  // no auth
  ok('GET /api/stats no auth → 401 JSON', r.status === 401 && r.body.success === false, r.body.message);
  ok('401 JSON: no stack trace', !JSON.stringify(r.body).includes('at '));

  // ── 6. Folder structure ────────────────────────────────────────
  console.log('\n[ Folder structure ]');
  const fs   = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const required_paths = [
    'src/config/database.js',
    'src/models/User.js', 'src/models/Evidence.js',
    'src/models/Block.js', 'src/models/AuditLog.js',
    'src/middleware/auth.js', 'src/middleware/errorHandler.js', 'src/middleware/rateLimiter.js',
    'src/routes/index.js', 'src/routes/health.js', 'src/routes/auth.js',
    'src/routes/evidence.js', 'src/routes/blockchain.js',
    'src/routes/audit.js', 'src/routes/users.js', 'src/routes/stats.js',
    'src/services/auditService.js', 'src/services/blockchainService.js',
    'src/utils/helpers.js',
    'scripts/seed.js',
    'public/index.html', 'public/style.css', 'public/script.js',
    '.env.example', '.gitignore'
  ];
  for (const p of required_paths) {
    ok(`${p} exists`, fs.existsSync(path.join(root, p)));
  }

  // ── 7. .gitignore covers critical paths ────────────────────────
  console.log('\n[ .gitignore ]');
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  ok('.gitignore covers node_modules/', gitignore.includes('node_modules/'));
  ok('.gitignore covers .env',          gitignore.includes('.env'));

  // ── 8. Auth still works end-to-end ────────────────────────────
  console.log('\n[ Auth smoke test ]');
  r = await req('POST', '/api/auth/login', { email: 'admin@evidenceguard.com', password: 'Admin@123456' });
  ok('POST /api/auth/login → 200', r.status === 200 && r.body.success === true, `token=${r.body.data?.token?.slice(0,20)}…`);

  const token = r.body.data?.token;
  if (token) {
    const me = await globalThis.fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    const meBody = await me.json();
    ok('GET /api/auth/me → 200 with token', me.status === 200 && meBody.data?.role === 'admin', meBody.data?.email);

    const health = await globalThis.fetch(`${BASE}/api/stats`, { headers: { Authorization: `Bearer ${token}` } });
    const hBody = await health.json();
    ok('GET /api/stats → real counts from DB', health.status === 200 && hBody.data?.total >= 5, `total=${hBody.data?.total}`);
  }

  // ── Summary ────────────────────────────────────────────────────
  const total = passes + fails;
  console.log('\n════════════════════════════════════════════════');
  console.log(`  Results: ${passes} passed, ${fails} failed out of ${total} tests`);
  console.log('════════════════════════════════════════════════\n');
  if (fails === 0) console.log('  🎉 All Sprint 0 checklist items PASS!\n');
  process.exit(fails > 0 ? 1 : 0);
}

run().catch(e => { console.error('Test runner error:', e.message); process.exit(1); });
