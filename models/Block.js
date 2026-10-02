const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
  blockNumber: { type: Number, required: true, unique: true },
  evidenceId: { type: String, default: null },
  caseId: { type: String, default: null },
  evidenceHash: { type: String, default: null },
  previousHash: { type: String, required: true, unique: true },
  currentHash: { type: String, required: true, unique: true },
  timestamp: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: false });

const immutableError = new Error('Blocks are immutable and cannot be modified or deleted.');

blockSchema.pre('updateOne', function(next) { next(immutableError); });
blockSchema.pre('updateMany', function(next) { next(immutableError); });
blockSchema.pre('findOneAndUpdate', function(next) { next(immutableError); });
blockSchema.pre('deleteOne', function(next) { next(immutableError); });
blockSchema.pre('deleteMany', function(next) { next(immutableError); });
blockSchema.pre('findOneAndDelete', function(next) { next(immutableError); });
blockSchema.pre('remove', { document: true, query: false }, function(next) { next(immutableError); });

module.exports = mongoose.model('Block', blockSchema);
