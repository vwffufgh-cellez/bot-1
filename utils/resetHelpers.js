function shouldReset(lastDate, range) {
  if (!lastDate) return true;
  const now = new Date();
  const last = new Date(lastDate);

  if (range === 'day') {
    return now.toDateString() !== last.toDateString();
  }
  if (range === 'week') {
    const getWeekKey = date => {
      const d = new Date(date);
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };
    return getWeekKey(now) !== getWeekKey(last);
  }
  if (range === 'month') {
    return now.getFullYear() !== last.getFullYear() || now.getMonth() !== last.getMonth();
  }
  return false;
}

async function resetIfNeeded(userDoc) {
  const now = new Date();

  if (shouldReset(userDoc.lastDailyReset, 'day')) {
    userDoc.dailyTextXP = 0;
    userDoc.dailyVoiceXP = 0;
    userDoc.lastDailyReset = now;
  }
  if (shouldReset(userDoc.lastWeeklyReset, 'week')) {
    userDoc.weeklyTextXP = 0;
    userDoc.weeklyVoiceXP = 0;
    userDoc.lastWeeklyReset = now;
  }
  if (shouldReset(userDoc.lastMonthlyReset, 'month')) {
    userDoc.monthlyTextXP = 0;
    userDoc.monthlyVoiceXP = 0;
    userDoc.lastMonthlyReset = now;
  }

  await userDoc.save();
}

module.exports = { shouldReset, resetIfNeeded };
