// models/UserXP.js
const mongoose = require('mongoose');

const UserXPSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  
  // --- الخبرة الكتابية ---
  text: {
    xp: { type: Number, default: 0 }, // الخبرة الكلية للكتابة
    level: { type: Number, default: 0 }, // المستوى بناءً على خبرة الكتابة
    daily: { type: Number, default: 0 },
    weekly: { type: Number, default: 0 },
    monthly: { type: Number, default: 0 },
    dailyResetAt: { type: Number, default: 0 },
    weeklyResetAt: { type: Number, default: 0 },
    monthlyResetAt: { type: Number, default: 0 },
  },

  // --- الخبرة الصوتية ---
  voice: {
    xp: { type: Number, default: 0 }, // الخبرة الكلية للصوت
    level: { type: Number, default: 0 }, // المستوى بناءً على خبرة الصوت
    daily: { type: Number, default: 0 },
    weekly: { type: Number, default: 0 },
    monthly: { type: Number, default: 0 },
    dailyResetAt: { type: Number, default: 0 },
    weeklyResetAt: { type: Number, default: 0 },
    monthlyResetAt: { type: Number, default: 0 },
  },

  // --- إعدادات عامة ---
  // يمكنك الاحتفاظ بحقول XP إجمالية إذا كنت بحاجة إليها لأغراض أخرى
  // totalXp: { type: Number, default: 0 }, 
});

// للتأكد من أن كل مستخدم لديه سجل واحد فقط لكل سيرفر
UserXPSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UserXP', UserXPSchema);
