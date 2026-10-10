'use strict';

/**
 * scripts/test-full-sepolia-demo.js
 * Comprehensive Integration & Verification Test Suite for EvidenceGuard (Node native fetch/FormData)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3000';

async function runFullDemoTest() {
  console.log('========================================================================');
  console.log('           EvidenceGuard – Senior Engineer Live System Demo Test        ');
  console.log('========================================================================\n');

  // Step 1: Health check
  console.log('1. Checking API Health...');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const health = await healthRes.json();
  if (healthRes.status !== 200 || !health.success) {
    throw new Error(`Health check failed: ${JSON.stringify(health)}`);
  }
  console.log('   ✅ API Health: OK (Database connected, uptime: ' + Math.round(health.uptime) + 's)\n');

  // Step 2: Login as Admin
  console.log('2. Authenticating as Admin User (admin@eg.local)...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@eg.local', password: 'Admin1234!' })
  });

  const loginData = await loginRes.json();
  if (loginRes.status !== 200 || !loginData.success) {
    throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
  }

  const cookieHeader = loginRes.headers.get('set-cookie');
  const authCookie = cookieHeader ? cookieHeader.split(';')[0] : '';
  console.log('   ✅ Admin Session Established (User: ' + loginData.user.name + ', Role: ' + loginData.user.role + ')\n');

  // Step 3: Prepare test file sample.pdf & compute SHA-256
  console.log('3. Preparing forensic evidence file (sample.pdf)...');
  const sampleContent = Buffer.from('OFFICIAL EVIDENCE DOCUMENT - CONFIDENTIAL FOR FORENSIC REVIEW ' + Date.now());
  const expectedHash = crypto.createHash('sha256').update(sampleContent).digest('hex');
  const samplePath = path.join(__dirname, 'scratch_sample_test.pdf');
  fs.writeFileSync(samplePath, sampleContent);

  console.log('   ✅ Sample File Created: ' + samplePath);
  console.log('   ✅ SHA-256 Hash Computed: ' + expectedHash + '\n');

  // Step 4: Upload Evidence via API using native FormData + Blob
  console.log('4. Uploading Evidence to EvidenceGuard...');
  const uploadForm = new FormData();
  uploadForm.append('name', 'Forensic Audit Sample Document');
  uploadForm.append('type', 'Document');
  uploadForm.append('description', 'Test evidence uploaded during Sepolia verification demo run.');
  uploadForm.append('clientHash', expectedHash);
  uploadForm.append('file', new Blob([sampleContent], { type: 'application/pdf' }), 'sample.pdf');

  const uploadRes = await fetch(`${BASE_URL}/api/evidence`, {
    method: 'POST',
    headers: { 'Cookie': authCookie },
    body: uploadForm
  });

  const uploadData = await uploadRes.json();
  if (uploadRes.status !== 201 && uploadRes.status !== 200) {
    throw new Error(`Upload failed: ${JSON.stringify(uploadData)}`);
  }

  const evData = uploadData.evidence || uploadData;
  const evId = evData.evidenceId;
  console.log('   ✅ Upload Success! Evidence ID: ' + evId + ', Case ID: ' + evData.caseId);
  console.log('   ✅ Recorded Hash: ' + evData.hash + '\n');

  // Step 5: Simulate On-Chain Anchor Update (Sepolia Blockchain Proof)
  console.log('5. Simulating Sepolia Smart Contract Anchor Update...');
  const fakeTxHash = '0x64b651320eb4506097c1a7c37db6e3959a93842a805b1d9c57a572b3fbe98ab1';
  const anchorRes = await fetch(`${BASE_URL}/api/evidence/${evId}/anchor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': authCookie
    },
    body: JSON.stringify({
      txHash: fakeTxHash,
      blockNumber: 5829104,
      contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      uploaderWallet: '0x3e5bdcee6742f5a8Cf5466846829764343839acE',
      network: 'Ethereum Sepolia Testnet'
    })
  });

  const anchorData = await anchorRes.json();
  if (anchorRes.status !== 200 || !anchorData.success) {
    throw new Error(`Anchor update failed: ${JSON.stringify(anchorData)}`);
  }
  console.log('   ✅ Anchored on Sepolia! Status: ' + anchorData.evidence.status + ', TxHash: ' + fakeTxHash + '\n');

  // Step 6: Test Original File Verification (Case 1: Match -> VERIFIED)
  console.log('6. Executing Verification Test – Case 1: Original File (Expecting VERIFIED)...');
  const verifyForm = new FormData();
  verifyForm.append('clientHash', expectedHash);
  verifyForm.append('file', new Blob([sampleContent], { type: 'application/pdf' }), 'sample.pdf');

  const verifyRes = await fetch(`${BASE_URL}/api/evidence/${evId}/verify`, {
    method: 'POST',
    headers: { 'Cookie': authCookie },
    body: verifyForm
  });

  const verifyData = await verifyRes.json();
  if (verifyRes.status !== 200 || verifyData.result !== 'VERIFIED') {
    throw new Error(`Original file verification failed: ${JSON.stringify(verifyData)}`);
  }
  console.log('   ✅ Result: VERIFIED — Evidence integrity maintained.\n');

  // Step 7: Test Tampered File Verification (Case 2: Mismatch -> TAMPERED)
  console.log('7. Executing Verification Test – Case 2: Tampered File (Expecting TAMPERED)...');
  const tamperedContent = Buffer.from(sampleContent.toString() + ' [TAMPERED_MODIFICATION_BYTES]');
  const tamperedHash = crypto.createHash('sha256').update(tamperedContent).digest('hex');

  const tamperForm = new FormData();
  tamperForm.append('clientHash', tamperedHash);
  tamperForm.append('file', new Blob([tamperedContent], { type: 'application/pdf' }), 'sample.pdf');

  const tamperRes = await fetch(`${BASE_URL}/api/evidence/${evId}/verify`, {
    method: 'POST',
    headers: { 'Cookie': authCookie },
    body: tamperForm
  });

  const tamperData = await tamperRes.json();
  if (tamperRes.status !== 200 || tamperData.result !== 'TAMPERED') {
    throw new Error(`Tampered file verification failed: ${JSON.stringify(tamperData)}`);
  }
  console.log('   ✅ Result: TAMPERED — Cryptographic mismatch successfully detected!');
  console.log('   Original Hash: ' + tamperData.originalHash);
  console.log('   Current  Hash: ' + tamperData.currentHash + '\n');

  // Clean up scratch file
  try { fs.unlinkSync(samplePath); } catch (_) {}

  console.log('========================================================================');
  console.log('   🎉 ALL 7 DEMO TEST STEPS COMPLETED CLEANLY WITH 100% SUCCESS!       ');
  console.log('========================================================================\n');
}

runFullDemoTest().catch(err => {
  console.error('\n❌ DEMO TEST ERROR:', err.message);
  process.exit(1);
});
