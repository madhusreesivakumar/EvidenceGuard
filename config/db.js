const mongoose = require('mongoose');

const User = require('../models/User');
const Evidence = require('../models/Evidence');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }

  mongoose.connection.on('connected', () => {
    console.log('MongoDB connected successfully.');
  });

  mongoose.connection.on('error', (err) => {
    console.error(`MongoDB connection error: ${err.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected.');
  });

  try {
    await mongoose.connect(uri);
    
    // Ensure indexes are created
    await Promise.all([
      User.syncIndexes(),
      Evidence.syncIndexes(),
      Block.syncIndexes(),
      AuditLog.syncIndexes()
    ]);
    console.log('Indexes synced successfully.');
    
    // Check transaction support
    try {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        await mongoose.connection.db.collection('system_status').findOne({}, { session });
        await session.abortTransaction();
        global.TRANSACTIONS_SUPPORTED = true;
      } catch (txErr) {
        try { await session.abortTransaction(); } catch (_) {}
        console.warn('WARNING: MongoDB deployment does not support transactions (Standalone). Using application-level compensating rollbacks.');
        global.TRANSACTIONS_SUPPORTED = false;
      } finally {
        await session.endSession();
      }
    } catch (err) {
      console.warn('WARNING: MongoDB deployment does not support transactions (Standalone). Using application-level compensating rollbacks.');
      global.TRANSACTIONS_SUPPORTED = false;
    }
    
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
