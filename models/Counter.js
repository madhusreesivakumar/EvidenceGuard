const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  orgId: { type: String, required: true, default: 'default', index: true },
  name: { type: String },
  seq: { type: Number, default: 0 }
});

counterSchema.index({ orgId: 1, name: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Counter', counterSchema);
