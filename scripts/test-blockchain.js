#!/usr/bin/env node
'use strict';

/**
 * scripts/test-blockchain.js
 * Runs Hardhat test suite for EvidenceAnchor smart contract
 */

const { spawnSync } = require('child_process');
const path = require('path');

const blockchainDir = path.resolve(__dirname, '..', 'blockchain');

console.log('\n======================================================================');
console.log('       EvidenceGuard Sprint 10A – Smart Contract Test Suite           ');
console.log('======================================================================\n');

const res = spawnSync('npx', ['hardhat', 'test'], {
  cwd: blockchainDir,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (res.status !== 0) {
  console.error('\n❌ Smart contract tests failed with status:', res.status);
  process.exit(res.status || 1);
} else {
  console.log('\n✅ All smart contract tests passed successfully.\n');
  process.exit(0);
}
