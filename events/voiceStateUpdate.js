const UserXP = require('../models/UserXP');

const VOICE_XP_PER_MIN = 8;
const activeVoice = new Map();

const startOfDay = value => { const d = new Date(value); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
const startOfWeek = value => { const d = new Date(value); const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - day); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
const startOfMonth = value => { const d = new Date(value); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
const calculateLevel = xp => Math.floor(0.1 * Math.sqrt(xp));

function resetScopes(doc, now) {
  const daily = startOfDay(now);
  const weekly = startOfWeek(now);
  const monthly = startOfMonth(now);

  if (!doc.dailyResetAt || doc.dailyResetAt < daily) {
    doc.dailyTextXp = 0;
    doc.dailyVoiceXp = 0;
    doc.dailyResetAt = daily;
  }

  if (!doc.weeklyResetAt || doc.weeklyResetAt < weekly) {
    doc.weeklyTextXp = 0;
    doc.weeklyVoiceXp = 0;
    doc.weeklyResetAt = weekly;
  }

  if (!doc.monthlyResetAt || doc.monthlyResetAt < monthly) {
    doc.monthlyTextXp = 0;
    doc.monthlyVoiceXp = 0;
    doc.monthlyResetAt = monthly;
  }
}

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const key = `${member.guild.id}:${member.id}`;
    const joined = !oldState.channelId && newState.channelId;
    const switched = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;
    const left = oldState.channelId && !newState.channelId;

    if (joined || switched) {
      if (activeVoice.has(key)) {
        clearInterval(activeVoice.get(key));
        activeVoice.delete(key);
      }

      const interval = setInterval(async () => {
        const freshMember = await member.guild.members.fetch(member.id).catch(() => null);
        if (!freshMember?.voice?.channelId) {
          clearInterval(interval);
          activeVoice.delete(key);
          return;
        }

        const now = Date.now();
        let userXp = await UserXP.findOne({ guildId: member.guild.id, userId: member.id });
        if (!userXp) {
          userXp = new UserXP({
            guildId: member.guild.id,
            userId: member.id,
            dailyResetAt: startOfDay(now),
            weeklyResetAt: startOfWeek(now),
            monthlyResetAt: startOfMonth(now)
          });
        }

        resetScopes(userXp, now);

        userXp.voiceXp += VOICE_XP_PER_MIN;
        userXp.dailyVoiceXp += VOICE_XP_PER_MIN;
        userXp.weeklyVoiceXp += VOICE_XP_PER_MIN;
        userXp.monthlyVoiceXp += VOICE_XP_PER_MIN;
        userXp.totalXp = userXp.textXp + userXp.voiceXp;
        userXp.level = calculateLevel(userXp.totalXp);

        await userXp.save();
      }, 60_000);

      activeVoice.set(key, interval);
    }

    if (left && activeVoice.has(key)) {
      clearInterval(activeVoice.get(key));
      activeVoice.delete(key);
    }
  }
};
