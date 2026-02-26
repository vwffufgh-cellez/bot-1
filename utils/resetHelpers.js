// utils/resetHelpers.js
const UserXP = require('../models/UserXP');

// دوال مساعدة لإنشاء الطوابع الزمنية لبداية اليوم/الأسبوع/الشهر بتوقيت UTC
const startOfDay = date => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};
const startOfWeek = date => { // الأحد هو 0، نريد الأحد لبداية الأسبوع
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 for Sunday, 1 for Monday, etc.
  d.setUTCDate(d.getUTCDate() - day); // Adjust to the most recent Sunday
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};
const startOfMonth = date => {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

async function resetIfNeeded(guildId) {
  const now = Date.now();
  const currentStartOfDay = startOfDay(now);
  const currentStartOfWeek = startOfWeek(now);
  const currentStartOfMonth = startOfMonth(now);

  // إعادة تعيين الخبرة اليومية للمستخدمين الذين لم يتم إعادة تعيينهم اليوم
  await UserXP.updateMany(
    {
      guildId: guildId,
      dailyResetAt: { $lt: currentStartOfDay } // إذا كان آخر إعادة تعيين قبل بداية اليوم الحالي
    },
    {
      $set: { dailyXp: 0, dailyResetAt: currentStartOfDay }
    }
  );

  // إعادة تعيين الخبرة الأسبوعية للمستخدمين الذين لم يتم إعادة تعيينهم هذا الأسبوع
  await UserXP.updateMany(
    {
      guildId: guildId,
      weeklyResetAt: { $lt: currentStartOfWeek } // إذا كان آخر إعادة تعيين قبل بداية الأسبوع الحالي
    },
    {
      $set: { weeklyXp: 0, weeklyResetAt: currentStartOfWeek }
    }
  );

  // إعادة تعيين الخبرة الشهرية للمستخدمين الذين لم يتم إعادة تعيينهم هذا الشهر
  await UserXP.updateMany(
    {
      guildId: guildId,
      monthlyResetAt: { $lt: currentStartOfMonth } // إذا كان آخر إعادة تعيين قبل بداية الشهر الحالي
    },
    {
      $set: { monthlyXp: 0, monthlyResetAt: currentStartOfMonth }
    }
  );
}

module.exports = { resetIfNeeded };
