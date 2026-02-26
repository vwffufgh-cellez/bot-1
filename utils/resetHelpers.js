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

// وظيفة لتعيين قيم افتراضية للكائنات الداخلية إذا لم تكن موجودة
function initializeXpObject(obj) {
    if (!obj) {
        return {
            xp: 0, level: 0,
            daily: 0, weekly: 0, monthly: 0,
            dailyResetAt: 0, weeklyResetAt: 0, monthlyResetAt: 0
        };
    }
    // التأكد من وجود كل الحقول المطلوبة
    obj.xp = obj.xp || 0;
    obj.level = obj.level || 0;
    obj.daily = obj.daily || 0;
    obj.weekly = obj.weekly || 0;
    obj.monthly = obj.monthly || 0;
    obj.dailyResetAt = obj.dailyResetAt || 0;
    obj.weeklyResetAt = obj.weeklyResetAt || 0;
    obj.monthlyResetAt = obj.monthlyResetAt || 0;
    return obj;
}

async function resetIfNeeded(guildId) {
  const now = Date.now();
  const currentStartOfDay = startOfDay(now);
  const currentStartOfWeek = startOfWeek(now);
  const currentStartOfMonth = startOfMonth(now);

  // إعادة تعيين الخبرة الكتابية
  await UserXP.updateMany(
    { guildId: guildId, 'text.dailyResetAt': { $lt: currentStartOfDay } },
    {
      $set: {
        'text.daily': 0, 'text.dailyResetAt': currentStartOfDay,
        'text.weekly': 0, 'text.weeklyResetAt': currentStartOfWeek,
        'text.monthly': 0, 'text.monthlyResetAt': currentStartOfMonth
      }
    }
  );

  // إعادة تعيين الخبرة الصوتية
  await UserXP.updateMany(
    { guildId: guildId, 'voice.dailyResetAt': { $lt: currentStartOfDay } },
    {
      $set: {
        'voice.daily': 0, 'voice.dailyResetAt': currentStartOfDay,
        'voice.weekly': 0, 'voice.weeklyResetAt': currentStartOfWeek,
        'voice.monthly': 0, 'voice.monthlyResetAt': currentStartOfMonth
      }
    }
  );
}

// وظيفة داخلية لتحديث XP scopes للمستخدم الفردي
function resetXpScopes(doc, now = Date.now()) {
  const currentStartOfDay = startOfDay(now);
  const currentStartOfWeek = startOfWeek(now);
  const currentStartOfMonth = startOfMonth(now);

  // إعادة تعيين الكتابية
  if (!doc.text.dailyResetAt || doc.text.dailyResetAt < currentStartOfDay) {
    doc.text.daily = 0;
    doc.text.dailyResetAt = currentStartOfDay;
  }
  if (!doc.text.weeklyResetAt || doc.text.weeklyResetAt < currentStartOfWeek) {
    doc.text.weekly = 0;
    doc.text.weeklyResetAt = currentStartOfWeek;
  }
  if (!doc.text.monthlyResetAt || doc.text.monthlyResetAt < currentStartOfMonth) {
    doc.text.monthly = 0;
    doc.text.monthlyResetAt = currentStartOfMonth;
  }

  // إعادة تعيين الصوتية
  if (!doc.voice.dailyResetAt || doc.voice.dailyResetAt < currentStartOfDay) {
    doc.voice.daily = 0;
    doc.voice.dailyResetAt = currentStartOfDay;
  }
  if (!doc.voice.weeklyResetAt || doc.voice.weeklyResetAt < currentStartOfWeek) {
    doc.voice.weekly = 0;
    doc.voice.weeklyResetAt = currentStartOfWeek;
  }
  if (!doc.voice.monthlyResetAt || doc.voice.monthlyResetAt < currentStartOfMonth) {
    doc.voice.monthly = 0;
    doc.voice.monthlyResetAt = currentStartOfMonth;
  }
}


module.exports = { resetIfNeeded, initializeXpObject, resetXpScopes };
