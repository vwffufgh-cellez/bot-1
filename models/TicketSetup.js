const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  guildId: String,
  ticketNumber: String,
  name: String,
  category: String,
  role: String,
});

module.exports = mongoose.model('TicketSetup', ticketSchema);
