'use strict';

/**
 * scripts/test-frontend-acceptance.js
 * Comprehensive acceptance checks for Sprint 8C:
 * Landing page, About page, honest labels, limitations, future scope,
 * responsive rules, reduced motion, genuine public stats, login-aware button behavior,
 * demo users, demo records, and DEMO badges.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const results = [];
function assert(condition, name, details = '') {
  if (condition) {
    results.push({ name, status: 'PASS' });
    console.log(`  [PASS] ${name}`);
  } else {
    results.push({ name, status: 'FAIL', details });
    console.error(`  [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
  }
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json || data,
          rawBody: data
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function runAcceptance() {
  console.log('======================================================================');
  console.log('       EvidenceGuard - Sprint 8C Frontend Acceptance Checks          ');
  console.log('======================================================================\n');

  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const aboutHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'about.html'), 'utf8');
  const cssContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const pageLogic = fs.readFileSync(path.join(__dirname, '..', 'public', 'page-logic.js'), 'utf8');

  // --- [1] index.html Checks ---
  console.log('--- [1] index.html Structure & Master Spec Requirements ---');
  
  // Single H1
  const h1Matches = indexHtml.match(/<h1[\s>]/gi) || [];
  assert(h1Matches.length === 1, 'index.html contains exactly one single <h1>');
  assert(indexHtml.includes('EvidenceGuard') && (indexHtml.includes('Digital Evidence Protection &amp; Verification System') || indexHtml.includes('Digital Evidence Protection & Verification System')), 'index.html contains EvidenceGuard title and subtitle');

  // Honest description (detect, not prevent)
  const hasDetect = /detect\s+unauthorized\s+modification/i.test(indexHtml);
  assert(hasDetect, 'Hero description accurately states "detect" unauthorized modification (not prevent)');

  // Honest prototype badge
  assert(indexHtml.includes('Blockchain-inspired hash-chain prototype'), 'index.html includes honest label: "Blockchain-inspired hash-chain prototype"');

  // Visual workflow
  const hasVisualWorkflow = indexHtml.includes('Digital Evidence') &&
    indexHtml.includes('SHA-256 Hash') &&
    indexHtml.includes('Secure Database') &&
    indexHtml.includes('Hash Chain') &&
    indexHtml.includes('Verification') &&
    (indexHtml.includes('Verified / Tampered') || (indexHtml.includes('Verified') && indexHtml.includes('Tampered')));
  assert(hasVisualWorkflow, 'index.html contains full visual workflow from Digital Evidence to Verified/Tampered');

  // Hero buttons
  assert(indexHtml.includes('id="btnHeroDashboard"') && indexHtml.includes('id="btnHeroUpload"') && indexHtml.includes('id="btnHeroVerify"'),
    'index.html contains all 3 hero buttons: Dashboard, Upload Evidence, Verify Evidence');

  // Features section
  const featuresNeeded = [
    'Upload & SHA-256 Hashing',
    'Duplicate Detection',
    'Cryptographic Verification',
    'Hash-Chain Ledger',
    'Append-Only Audit Trail',
    'QR Code Verification',
    'Role-Based Access Control',
    'Live Forensic Dashboard'
  ];
  const allFeaturesPresent = featuresNeeded.every(f => indexHtml.toLowerCase().includes(f.toLowerCase()));
  assert(allFeaturesPresent, 'index.html contains all required features (Upload, Duplicate, Verification, Hash Chain, Audit Trail, QR, RBAC, Live Forensic Dashboard)');

  // Security explanation
  const secComponents = ['bcrypt', 'JWT', 'Role-Based Access', 'SHA-256', 'Audit', 'Ledger'];
  const allSecPresent = secComponents.every(s => indexHtml.toLowerCase().includes(s.toLowerCase()));
  assert(allSecPresent, 'index.html contains security explanation covering bcrypt, JWT, RBAC, server-side hashing, audit, and ledger');

  // 10 Future Scope Items in index.html
  const futureScope10 = [
    'Digital Signatures',
    'Real Blockchain',
    'IPFS',
    'Cloud Storage',
    'Chain of Custody',
    'Alerts',
    'AI',
    'Forensic Analysis',
    'Multi-Organization',
    'Hardware Security'
  ];
  const allIndexFuture = futureScope10.every(item => indexHtml.toLowerCase().includes(item.toLowerCase()));
  assert(allIndexFuture, 'index.html contains all 10 Future Scope items from master spec');

  // Footer college project note
  assert(/college\s+project|academic/i.test(indexHtml), 'index.html footer includes honest college project disclaimer');

  // --- [2] about.html Checks ---
  console.log('\n--- [2] about.html Structure & Transparent Limitations ---');
  
  // Single H1
  const aboutH1 = aboutHtml.match(/<h1[\s>]/gi) || [];
  assert(aboutH1.length === 1, 'about.html contains exactly one single <h1>');

  // Problem & Solution
  assert(aboutHtml.includes('The Problem') && /copied|modified|replaced|deleted/i.test(aboutHtml), 'about.html defines the Problem (evidence copied, modified, replaced, deleted)');
  assert(aboutHtml.includes('The Solution') && aboutHtml.includes('SHA-256'), 'about.html details the SHA-256 + hash-chain solution');

  // Architecture flow
  const archFlow = aboutHtml.includes('Browser') &&
    aboutHtml.includes('Frontend') &&
    aboutHtml.includes('Express REST API') &&
    aboutHtml.includes('Auth &amp; Authorization') || aboutHtml.includes('Auth & Authorization') &&
    aboutHtml.includes('Evidence Service') &&
    aboutHtml.includes('MongoDB') &&
    aboutHtml.includes('Hash Chain') &&
    aboutHtml.includes('Audit Trail');
  assert(archFlow, 'about.html includes comprehensive architecture flow diagram');

  // Transparent Limitations
  const limitations = [
    'Centralized Ledger Storage',
    'Database Administrator Compromise',
    'Origin Authenticity vs. Integrity',
    'Standard Server Storage',
    'Sequential Case ID Guessability',
    'No Automated Password Reset Flow'
  ];
  const allLimitsPresent = limitations.every(l => aboutHtml.toLowerCase().includes(l.toLowerCase()));
  assert(allLimitsPresent, 'about.html includes transparent limitations (centralized DB, DB admin rewrite risk, origin authenticity, disk storage, sequential IDs, no automated reset)');

  // 10 Future Scope Items in about.html
  const allAboutFuture = futureScope10.every(item => aboutHtml.toLowerCase().includes(item.toLowerCase()));
  assert(allAboutFuture, 'about.html contains all 10 Future Scope items matching master spec');

  // --- [3] CSS Responsive & Reduced-Motion Rules ---
  console.log('\n--- [3] CSS Responsive & Accessibility Rules ---');
  assert(cssContent.includes('@media (prefers-reduced-motion: reduce)'), 'CSS contains prefers-reduced-motion query for accessible, static workflow');
  assert(cssContent.includes('.prototype-badge'), 'CSS defines .prototype-badge styling');
  assert(cssContent.includes('.workflow-track') && cssContent.includes('.workflow-step'), 'CSS defines visual workflow track and steps styling');
  assert(cssContent.includes('.limitations-box'), 'CSS defines .limitations-box styling');
  assert(cssContent.includes('.scope-grid'), 'CSS defines .scope-grid styling');

  // --- [4] Genuine Public Stats Endpoint (/api/public/stats) ---
  console.log('\n--- [4] Genuine Public Stats Endpoint (/api/public/stats) ---');
  const statsRes = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/public/stats',
    method: 'GET'
  });
  assert(statsRes.status === 200, 'GET /api/public/stats returns HTTP 200');
  assert(statsRes.body && statsRes.body.success === true, '/api/public/stats response success is true');
  assert(statsRes.body.stats && statsRes.body.stats.evidenceCount === 5, `Real stats: evidenceCount is 5 (received ${statsRes.body?.stats?.evidenceCount})`);
  assert(statsRes.body.stats && statsRes.body.stats.verifiedCount === 3, `Real stats: verifiedCount is 3 (received ${statsRes.body?.stats?.verifiedCount})`);
  assert(statsRes.body.stats && statsRes.body.stats.blockCount === 6, `Real stats: blockCount is 6 (received ${statsRes.body?.stats?.blockCount})`);

  // --- [5] Demo User Authentication & Role Permissions ---
  console.log('\n--- [5] Demo User Authentication & Role Permissions ---');
  
  // Login as Viewer
  const viewerLogin = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'demo.viewer@evidenceguard.local', password: 'DemoPassword2026!' });
  assert(viewerLogin.status === 200, 'Demo Viewer can log in with configured password (HTTP 200)');
  assert(viewerLogin.body.user && viewerLogin.body.user.role === 'VIEWER', 'Viewer login returns role VIEWER');

  const viewerCookie = (viewerLogin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  // Login as Investigator
  const invLogin = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'demo.investigator@evidenceguard.local', password: 'DemoPassword2026!' });
  assert(invLogin.status === 200, 'Demo Investigator can log in with configured password (HTTP 200)');
  assert(invLogin.body.user && invLogin.body.user.role === 'INVESTIGATOR', 'Investigator login returns role INVESTIGATOR');

  // Login as Admin
  const adminLogin = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'demo.admin@evidenceguard.local', password: 'DemoPassword2026!' });
  assert(adminLogin.status === 200, 'Demo Admin can log in with configured password (HTTP 200)');
  assert(adminLogin.body.user && adminLogin.body.user.role === 'ADMIN', 'Admin login returns role ADMIN');

  // --- [6] Demo Records & DEMO Badges Verification ---
  console.log('\n--- [6] Demo Records & Verification History ---');
  const evListRes = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/evidence',
    method: 'GET',
    headers: { 'Cookie': viewerCookie }
  });
  assert(evListRes.status === 200, 'Viewer can retrieve evidence list (HTTP 200)');
  const records = evListRes.body.items || [];
  assert(records.length === 5, `Retrieved 5 evidence records (found ${records.length})`);
  assert(records.every(r => r.isDemo === true), 'All 5 retrieved evidence records have isDemo: true');
  assert(records.every(r => r.description && r.description.startsWith('[DEMO]')), 'All 5 descriptions start with "[DEMO]"');

  const ev4 = records.find(r => r.evidenceId === 'EV-0004');
  assert(ev4 && ev4.status === 'Tampered', 'EV-0004 status is Tampered');

  // Check verification history for EV-0004
  const ev4History = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/evidence/EV-0004/verifications',
    method: 'GET',
    headers: { 'Cookie': viewerCookie }
  });
  assert(ev4History.status === 200, 'GET EV-0004 verifications returns HTTP 200');
  const vList = ev4History.body.data || [];
  assert(vList.length > 0 && vList[0].result === 'TAMPERED', 'EV-0004 has genuine TAMPERED verification entry');
  assert(vList[0].isDemo === true, 'EV-0004 verification record has isDemo: true');

  // Public QR endpoint returns isDemo
  const publicQrRes = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/public/verify/EG-2026-0001',
    method: 'GET'
  });
  assert(publicQrRes.status === 200, 'Public QR lookup returns HTTP 200');
  assert(publicQrRes.body && publicQrRes.body.isDemo === true, 'Public QR response includes isDemo: true');

  // --- [7] Login-Aware Hero Buttons Wiring in page-logic.js ---
  console.log('\n--- [7] Login-Aware Button Logic in page-logic.js ---');
  assert(pageLogic.includes("btnDashboard.href = 'login.html?next=dashboard.html'"), 'Logged out dashboard button directs to login with ?next=');
  assert(pageLogic.includes("btnUpload.href = 'login.html?next=upload.html'"), 'Logged out upload button directs to login with ?next=');
  assert(pageLogic.includes("user.role === 'VIEWER'"), 'Upload button logic checks for VIEWER role');
  assert(pageLogic.includes("btnUpload.classList.add('disabled')") || pageLogic.includes("btnUpload.removeAttribute('href')"), 'Upload button is disabled for VIEWER role');
  assert(pageLogic.includes("uploadExplanation.textContent = 'Upload Evidence requires Investigator or Admin role (Current: Viewer)'"), 'Explanation text shown for disabled Upload button');

  // --- Summary ---
  console.log('\n======================================================================');
  console.log('             SPRINT 8C FRONTEND ACCEPTANCE SUMMARY                    ');
  console.log('======================================================================');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`TOTAL CHECKS : ${results.length}`);
  console.log(`PASSED       : ${passed}`);
  console.log(`FAILED       : ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runAcceptance().catch(err => {
  console.error('Acceptance suite failed:', err);
  process.exit(1);
});
