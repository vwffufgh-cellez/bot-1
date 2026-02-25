const mongoose = require('mongoose');

const adminStatsSchema = new mongoose.Schema({
  guildId: String,
  adminId: String,
  ticketsClaimed: { type: Number, default: 0 },
  xp: { type: Number, default: 0 }
});

module.exports = mongoose.model('AdminStats', adminStatsSchema);
