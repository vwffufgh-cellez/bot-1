// models/UserXP.js
const mongoose = require('mongoose');

const UserXPSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  
  // الخبرة النصية
  textXp: { type: Number, default: 0 },
  textDailyXp: { type: Number, default: 0 },
  textWeeklyXp: { type: Number, default: 0 },
  textMonthlyXp: { type: Number, default: 0 },
  
  // الخبرة الصوتية
  voiceXp: { type: Number, default: 0 },
  voiceDailyXp: { type: Number, default: 0 },
  voiceWeeklyXp: { type: Number, default: 0 },
  voiceMonthlyXp: { type: Number, default: 0 },
  
  // مستويات الخبرة
  level: { type: Number, default: 0 },
  
  // أوقات إعادة التعيين
  dailyResetAt: { type: Number, default: 0 },
  weeklyResetAt: { type: Number, default: 0 },
  monthlyResetAt: { type: Number, default: 0 }
});

UserXPSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UserXP', UserXPSchema);
