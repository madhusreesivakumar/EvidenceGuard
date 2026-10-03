#!/usr/bin/env node
'use strict';

/**
 * EvidenceGuard – Master Test Runner
 * Runs every sprint script test in order:
 * (ids, audit, auth, evidence, chain, verify, list, public,
 *  dashboard, audit-api, audit-chain, users, audit-coverage, security, errors)
 *
 * Stops immediately at the first failure and prints one summary table.
 * Enforces dedicated test database safety check (database name must contain "test").
 *
 * Usage:
 *   node scripts/run-all-tests.js
 *   node scripts/run-all-tests.js --force
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

const TESTS = [
  { name: 'ids',            script: 'scripts/test-ids.js',            args: [] },
  { name: 'audit',          script: 'scripts/test-audit.js',          args: [] },
  { name: 'auth',           script: 'scripts/test-auth.js',           args: [] },
  { name: 'evidence',       script: 'scripts/test-evidence.js',       args: [] },
  { name: 'chain',          script: 'scripts/test-chain.js',          args: ['--confirm'] },
  { name: 'verify',         script: 'scripts/test-verify.js',         args: [] },
  { name: 'list',           script: 'scripts/test-list.js',           args: [] },
  { name: 'public',         script: 'scripts/test-public.js',         args: [] },
  { name: 'dashboard',      script: 'scripts/test-dashboard.js',      args: [] },
  { name: 'audit-api',      script: 'scripts/test-audit-api.js',      args: [] },
  { name: 'audit-chain',    script: 'scripts/test-audit-chain.js',    args: ['--confirm'] },
  { name: 'users',          script: 'scripts/test-users.js',          args: [] },
  { name: 'audit-coverage', script: 'scripts/test-audit-coverage.js', args: [] },
  { name: 'security',       script: 'scripts/test-security.js',       args: [] },
  { name: 'errors',         script: 'scripts/test-errors.js',         args: [] },
  { name: 'keys',           script: 'scripts/test-keys.js',           args: [] },
  { name: 'custody',        script: 'scripts/test-custody.js',        args: [] },
  { name: 'custody-ui',     script: 'scripts/test-custody-ui.js',     args: [] },
  { name: 'forensics-14a',  script: 'scripts/test-forensics-14a.js',  args: [] }
];

// Helper to extract database name from MongoDB URI
function extractDbName(uri) {
  if (!uri) return '';
  try {
    const parsed = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    return parsed.pathname ? parsed.pathname.replace(/^\//, '').split('?')[0] : '';
  } catch (_) {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    return match ? match[1] : '';
  }
}

async function runChild(item, env) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [item.script, ...item.args], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('close', code => {
      const durationMs = Date.now() - start;
      resolve({ code, stdout, stderr, durationMs });
    });
  });
}

(async () => {
  console.log('\n======================================================================');
  console.log('             EvidenceGuard Master Test Runner (npm test)             ');
  console.log('======================================================================\n');

  const args = process.argv.slice(2);
  const force = args.includes('--force');

  // Database safety verification
  const targetDbUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI || '';
  const childEnv = {};

  if (process.env.TEST_MONGODB_URI) {
    childEnv.MONGODB_URI = process.env.TEST_MONGODB_URI;
  }

  if (targetDbUri) {
    const dbName = extractDbName(targetDbUri);
    console.log(`[Database] Target connection: ${targetDbUri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
    console.log(`[Database] Target database:   "${dbName || '(default)'}"`);

    if (dbName && !dbName.toLowerCase().includes('test') && !force) {
      console.error('\n❌ [SAFETY REFUSAL] Refusing to run tests against database: "' + dbName + '"');
      console.error('   The test suite requires a dedicated test database whose name contains "test"');
      console.error('   (e.g. set TEST_MONGODB_URI to "mongodb://localhost:27017/evidenceguard_test").');
      console.error('   To bypass this safety check deliberately, pass the --force flag.\n');
      process.exit(1);
    }
  } else {
    console.log('[Database] No persistent MongoDB URI configured. In-memory databases will be used.');
  }

  console.log(`[Suite]    Executing ${TESTS.length} test suites in sequential order...\n`);

  const results = [];
  let stopSuite = false;
  const suiteStartTime = Date.now();

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];

    if (stopSuite) {
      results.push({
        num: i + 1,
        name: test.name,
        script: test.script,
        result: 'SKIPPED',
        duration: '-'
      });
      continue;
    }

    process.stdout.write(`  [${i + 1}/${TESTS.length}] Running ${test.name.padEnd(16)} (${test.script})... `);
    const { code, stdout, stderr, durationMs } = await runChild(test, childEnv);
    const durationSec = (durationMs / 1000).toFixed(2) + 's';

    if (code === 0) {
      process.stdout.write(`✅ PASS (${durationSec})\n`);
      results.push({
        num: i + 1,
        name: test.name,
        script: test.script,
        result: 'PASS',
        duration: durationSec
      });
    } else {
      process.stdout.write(`❌ FAIL (${durationSec})\n\n`);
      console.error('──────────────────── FAILURE OUTPUT ────────────────────');
      if (stdout) console.log(stdout.trim());
      if (stderr) console.error(stderr.trim());
      console.error('────────────────────────────────────────────────────────\n');

      results.push({
        num: i + 1,
        name: test.name,
        script: test.script,
        result: 'FAIL',
        duration: durationSec
      });

      stopSuite = true;
    }
  }

  const totalTime = ((Date.now() - suiteStartTime) / 1000).toFixed(2);

  // Print Summary Table
  console.log('\n======================================================================');
  console.log('                      TEST SUITE SUMMARY TABLE                        ');
  console.log('======================================================================');
  console.log('#   ' + 'Suite'.padEnd(18) + 'Script'.padEnd(35) + 'Result'.padEnd(10) + 'Duration');
  console.log('─'.repeat(70));

  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const r of results) {
    if (r.result === 'PASS') passCount++;
    else if (r.result === 'FAIL') failCount++;
    else skipCount++;

    const numStr = String(r.num).padEnd(4);
    const nameStr = r.name.padEnd(18);
    const scriptStr = r.script.padEnd(35);
    const resStr = r.result.padEnd(10);
    console.log(`${numStr}${nameStr}${scriptStr}${resStr}${r.duration}`);
  }

  console.log('─'.repeat(70));
  console.log(`TOTAL: ${passCount} PASSED, ${failCount} FAILED, ${skipCount} SKIPPED (Completed in ${totalTime}s)`);
  console.log('======================================================================\n');

  if (failCount > 0) {
    console.error(`❌ Suite stopped at first failure. Please fix ${results.find(r => r.result === 'FAIL')?.script} before proceeding.\n`);
    process.exit(1);
  }

  console.log('✅ ALL TEST SUITES PASSED! Blockchain & Audit chains confirmed VALID.\n');
  process.exit(0);
})();
