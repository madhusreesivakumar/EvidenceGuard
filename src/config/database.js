'use strict';
/**
 * src/config/database.js
 * Mongoose connection — tries real URI, falls back to mongodb-memory-server.
 * Exported as an async function: await connectDB().
 */
const mongoose = require('mongoose');

async function connectDB() {
  let uri = process.env.MONGODB_URI;

  if (!uri) {
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mem = await MongoMemoryServer.create();
      uri = mem.getUri() + 'evidenceguard';
      console.log('⚡  In-memory MongoDB started (data resets on restart).');
      console.log('    Set MONGODB_URI in .env for a persistent database.\n');
    } catch (err) {
      throw new Error(
        'No MONGODB_URI set and mongodb-memory-server failed to start.\n' +
        'Fix: set MONGODB_URI in .env  OR  run: npm install mongodb-memory-server --save-dev'
      );
    }
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const state = mongoose.connection.readyState === 1 ? 'connected' : 'connecting';
    console.log(`✅  MongoDB ${state}${uri.includes('localhost') || uri.includes('127.0.0.1') ? '' : ' (Atlas)'}`);
  } catch (err) {
    throw new Error(`MongoDB connection failed: ${err.message}`);
  }
}

module.exports = connectDB;
