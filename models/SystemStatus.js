const mongoose = require('mongoose');

const systemStatusSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: false
});

module.exports = mongoose.model('SystemStatus', systemStatusSchema);
