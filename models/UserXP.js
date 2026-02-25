const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  guildId: String,
  userId: String,

  textXP: { type: Number, default: 0 },
  voiceXP: { type: Number, default: 0 },

  weeklyTextXP: { type: Number, default: 0 },
  weeklyVoiceXP: { type: Number, default: 0 },

  monthlyTextXP: { type: Number, default: 0 },
  monthlyVoiceXP: { type: Number, default: 0 },

  level: { type: Number, default: 0 },
  lastMessage: { type: Date, default: null }
});

module.exports = mongoose.model('UserXP', userSchema);
