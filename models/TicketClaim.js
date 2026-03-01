// models/TicketClaim.js
const mongoose = require('mongoose');

const ticketClaimSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true, unique: true },
  claimedById: { type: String, required: true },
  claimedAt: { type: Date, default: Date.now }
});

ticketClaimSchema.index({ channelId: 1 }, { unique: true });
ticketClaimSchema.index({ guildId: 1, claimedById: 1 });

module.exports = mongoose.model('TicketClaim', ticketClaimSchema);
