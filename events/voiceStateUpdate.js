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
    if (newState.channel && !oldState.channel) {
      speakingUsers.set(`${guildId}-${userId}`, now);
      return;
    }

    if (!newState.channel && oldState.channel) {
      const key = `${guildId}-${userId}`;
      const joinedAt = speakingUsers.get(key);
      if (!joinedAt) return;
      const deltaMinutes = Math.floor((now - joinedAt) / 1000 / 60);
      speakingUsers.delete(key);

      if (deltaMinutes <= 0) return;

      const xpAmount = deltaMinutes * 2; // تستطيع تعديل المعدل

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
