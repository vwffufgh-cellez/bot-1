// utils/resetHelpers.js
const UserXP = require('../models/UserXP');

// ===== Time Helpers (UTC) =====
const startOfDay = (date = Date.now()) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

const startOfWeek = (date = Date.now()) => {
  const d = new Date(date);
  const day = d.getUTCDay(); // الأحد = 0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

const startOfMonth = (date = Date.now()) => {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * تهيئة/تطبيع كائن XP (للتوافق مع أي استدعاء قديم)
 * يعيد شكل الحقول الصحيح حسب سكيمة UserXP الحالية.
 */
function initializeXpObject(obj = {}) {
  return {
    textXp: Number(obj.textXp || 0),
    voiceXp: Number(obj.voiceXp || 0),
    totalXp: Number(obj.totalXp || 0),
    level: Number(obj.level || 0),

    dailyTextXp: Number(obj.dailyTextXp || 0),
    weeklyTextXp: Number(obj.weeklyTextXp || 0),
    monthlyTextXp: Number(obj.monthlyTextXp || 0),

    dailyVoiceXp: Number(obj.dailyVoiceXp || 0),
    weeklyVoiceXp: Number(obj.weeklyVoiceXp || 0),
    monthlyVoiceXp: Number(obj.monthlyVoiceXp || 0),

    dailyResetAt: Number(obj.dailyResetAt || 0),
    weeklyResetAt: Number(obj.weeklyResetAt || 0),
    monthlyResetAt: Number(obj.monthlyResetAt || 0)
  };
}

/**
 * إعادة تعيين دوري آمن على مستوى السيرفر.
 * يقبل guildId (String).
 */
async function resetIfNeeded(guildId) {
  if (!guildId || typeof guildId !== 'string') return;

  const now = Date.now();
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  // Daily reset
  await UserXP.updateMany(
    {
      guildId,
      $or: [
        { dailyResetAt: { $lt: dayStart } },
        { dailyResetAt: { $exists: false } }
      ]
    },
    {
      $set: {
        dailyTextXp: 0,
        dailyVoiceXp: 0,
        dailyResetAt: dayStart
      }
    }
  );

  // Weekly reset
  await UserXP.updateMany(
    {
      guildId,
      $or: [
        { weeklyResetAt: { $lt: weekStart } },
        { weeklyResetAt: { $exists: false } }
      ]
    },
    {
      $set: {
        weeklyTextXp: 0,
        weeklyVoiceXp: 0,
        weeklyResetAt: weekStart
      }
    }
  );

  // Monthly reset
  await UserXP.updateMany(
    {
      guildId,
      $or: [
        { monthlyResetAt: { $lt: monthStart } },
        { monthlyResetAt: { $exists: false } }
      ]
    },
    {
      $set: {
        monthlyTextXp: 0,
        monthlyVoiceXp: 0,
        monthlyResetAt: monthStart
      }
    }
  );
}

/**
 * إعادة تعيين scopes لوثيقة UserXP واحدة داخل الذاكرة.
 * مفيد قبل الحفظ.
 */
function resetXpScopes(doc, now = Date.now()) {
  if (!doc) return false;

  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  let changed = false;

  // تطبيع أولي للحقول
  if (typeof doc.textXp !== 'number') { doc.textXp = Number(doc.textXp || 0); changed = true; }
  if (typeof doc.voiceXp !== 'number') { doc.voiceXp = Number(doc.voiceXp || 0); changed = true; }
  if (typeof doc.totalXp !== 'number') { doc.totalXp = Number(doc.totalXp || 0); changed = true; }
  if (typeof doc.level !== 'number') { doc.level = Number(doc.level || 0); changed = true; }

  for (const key of [
    'dailyTextXp', 'weeklyTextXp', 'monthlyTextXp',
    'dailyVoiceXp', 'weeklyVoiceXp', 'monthlyVoiceXp'
  ]) {
    if (typeof doc[key] !== 'number') {
      doc[key] = Number(doc[key] || 0);
      changed = true;
    }
  }

  if (!doc.dailyResetAt || doc.dailyResetAt < dayStart) {
    doc.dailyTextXp = 0;
    doc.dailyVoiceXp = 0;
    doc.dailyResetAt = dayStart;
    changed = true;
  }

  if (!doc.weeklyResetAt || doc.weeklyResetAt < weekStart) {
    doc.weeklyTextXp = 0;
    doc.weeklyVoiceXp = 0;
    doc.weeklyResetAt = weekStart;
    changed = true;
  }

  if (!doc.monthlyResetAt || doc.monthlyResetAt < monthStart) {
    doc.monthlyTextXp = 0;
    doc.monthlyVoiceXp = 0;
    doc.monthlyResetAt = monthStart;
    changed = true;
  }

  // إعادة حساب الإجمالي احتياطًا
  const recomputedTotal = (doc.textXp || 0) + (doc.voiceXp || 0);
  if (doc.totalXp !== recomputedTotal) {
    doc.totalXp = recomputedTotal;
    changed = true;
  }

  return changed;
}

module.exports = {
  resetIfNeeded,
  initializeXpObject,
  resetXpScopes,
  startOfDay,
  startOfWeek,
  startOfMonth
};
