const mongoose = require('mongoose');

const adminStatsSchema = new mongoose.Schema({
  guildId: String,
  adminId: String,
  ticketsClaimed: { type: Number, default: 0 },
  claimsCount: { type: Number, default: 0 }, // توافق مع الكود القديم
  xp: { type: Number, default: 0 }
});

module.exports = mongoose.model('AdminStats', adminStatsSchema);
