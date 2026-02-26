const UserXP = require('../models/UserXP');
const { resetIfNeeded } = require('../utils/resetHelpers');

const speakingUsers = new Map();

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const guildId = member.guild.id;
    const userId = member.id;
    const now = Date.now();
    const key = `${guildId}-${userId}`;

    // دخول قناة صوتية
    if (newState.channel && !oldState.channel) {
      speakingUsers.set(key, now);
      return;
    }

    // انتقال بين القنوات
    if (newState.channel && oldState.channel && newState.channel.id !== oldState.channel.id) {
      speakingUsers.set(key, now);
      return;
    }

    // خروج نهائي من الصوت
    if (!newState.channel && oldState.channel) {
      const joinedAt = speakingUsers.get(key);
      speakingUsers.delete(key);
      if (!joinedAt) return;

      const deltaMinutes = Math.floor((now - joinedAt) / 60000);
      if (deltaMinutes <= 0) return;

      const xpAmount = deltaMinutes * 2; // عدّل المعدل إذا لزم

      const user = await UserXP.findOneAndUpdate(
        { guildId, userId },
        {},
        { upsert: true, new: true }
      );

      await resetIfNeeded(user);

      user.voiceXP += xpAmount;
      user.dailyVoiceXP += xpAmount;
      user.weeklyVoiceXP += xpAmount;
      user.monthlyVoiceXP += xpAmount;

      await user.save();
    }
  }
};
