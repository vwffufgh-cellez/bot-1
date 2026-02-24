const mongoose = require('mongoose');

const adminStatsSchema = new mongoose.Schema({
  guildId: String,
  adminId: String,

  ticketsCount: { type: Number, default: 0 },
  xp: { type: Number, default: 0 },
  warningsGiven: { type: Number, default: 0 },

  warningsLevel: { type: Number, default: 0 },
  rank: { type: Number, default: 1 }
});

module.exports = mongoose.model('AdminStats', adminStatsSchema);
