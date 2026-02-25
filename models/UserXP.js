const mongoose = require('mongoose');

const userXPSchema = new mongoose.Schema({
  guildId: String,
  userId: String,

  xp: { type: Number, default: 0 },

  history: [
    {
      amount: Number,
      date: { type: Date, default: Date.now }
    }
  ]
});

module.exports = mongoose.model('UserXP', userXPSchema);
