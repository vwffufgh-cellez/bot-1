const mongoose = require('mongoose');

const UserXPSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },

  textXp: { type: Number, default: 0 },
  voiceXp: { type: Number, default: 0 },
  totalXp: { type: Number, default: 0 },

  level: { type: Number, default: 0 },

  dailyTextXp: { type: Number, default: 0 },
  weeklyTextXp: { type: Number, default: 0 },
  monthlyTextXp: { type: Number, default: 0 },

  dailyVoiceXp: { type: Number, default: 0 },
  weeklyVoiceXp: { type: Number, default: 0 },
  monthlyVoiceXp: { type: Number, default: 0 },

  dailyResetAt: { type: Number, default: 0 },
  weeklyResetAt: { type: Number, default: 0 },
  monthlyResetAt: { type: Number, default: 0 }
}, { timestamps: true });

UserXPSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UserXP', UserXPSchema);
