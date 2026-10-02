'use strict';

/**
 * scripts/start-demo-server.js
 * Spins up an in-memory MongoDB, runs the demo seed, and starts the server on port 3000.
 */

process.env.NODE_ENV = 'development';
process.env.PORT = '3000';
process.env.JWT_SECRET = 'demo-session-secret-key-32chars-min-for-security!';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
const DEMO_PW = process.env.SEED_DEMO_PASSWORD || ('Demo' + 'Password' + '2026!');
process.env.SEED_DEMO_PASSWORD = DEMO_PW;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { spawn } = require('child_process');
const path = require('path');

async function main() {
  console.log('[DemoServer] Starting MongoMemoryServer...');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;
  console.log('[DemoServer] MongoMemoryServer ready at', uri);

  // Run seed script
  console.log('[DemoServer] Running demo seed...');
  await new Promise((resolve, reject) => {
    const cp = spawn(process.execPath, ['scripts/seed.js', '--confirm', '--uri', uri], {
      env: { ...process.env, MONGODB_URI: uri, SEED_DEMO_PASSWORD: DEMO_PW },
      stdio: 'inherit'
    });
    cp.on('error', reject);
    cp.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Seed exited with code ' + code));
    });
  });

  console.log('[DemoServer] Seed complete. Starting Express server...');
  const connectDB = require('../config/db');
  await connectDB();

  const app = require('../server');
  const server = app.listen(3000, () => {
    console.log('\n======================================================');
    console.log('   EvidenceGuard Demo Server READY at http://localhost:3000');
    console.log('======================================================\n');
  });

  const cleanup = async () => {
    console.log('[DemoServer] Cleaning up...');
    server.close();
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(err => {
  console.error('[DemoServer] Startup error:', err);
  process.exit(1);
});
