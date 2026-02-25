const mongoose = require('mongoose');

const ticketClaimSchema = new mongoose.Schema({
  guildId: String,
  channelId: String,
  adminId: String
});

module.exports = mongoose.model('TicketClaim', ticketClaimSchema);
