// models/TicketClaim.js
const mongoose = require('mongoose');

const ticketClaimSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true, unique: true },
  claimedById: { type: String, required: true },
  claimedAt: { type: Date, default: Date.now }
});

ticketClaimSchema.index({ guildId: 1, channelId: 1 });

module.exports = mongoose.model('TicketClaim', ticketClaimSchema);
