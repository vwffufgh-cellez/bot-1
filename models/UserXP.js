const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  guildId: String,
  userId: String,

  textXP: { type: Number, default: 0 },
  voiceXP: { type: Number, default: 0 },
  level: { type: Number, default: 0 },

  lastMessage: { type: Date, default: null },
  history: [
    {
      amount: Number,
      type: String, // text or voice
      date: { type: Date, default: Date.now }
    }
  ]
});

module.exports = mongoose.model('UserXP', userSchema);
