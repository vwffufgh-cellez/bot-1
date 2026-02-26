// models/UserXP.js
const mongoose = require('mongoose');

const UserXPSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  
  // الخبرة الكلية للمستوى
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 0 },

  // الخبرة للنطاقات الزمنية (يومي، أسبوعي، شهري)
  dailyXp: { type: Number, default: 0 },
  weeklyXp: { type: Number, default: 0 },
  monthlyXp: { type: Number, default: 0 },

  // الطوابع الزمنية لآخر إعادة تعيين لكل نطاق (لتتبع متى يجب إعادة التعيين التالية)
  // تخزن كأرقام (timestamps) لسهولة المقارنة مع startOfDay/startOfWeek/startOfMonth
  dailyResetAt: { type: Number, default: 0 },
  weeklyResetAt: { type: Number, default: 0 },
  monthlyResetAt: { type: Number, default: 0 },
});

// للتأكد من أن كل مستخدم لديه سجل واحد فقط لكل سيرفر
UserXPSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UserXP', UserXPSchema);
