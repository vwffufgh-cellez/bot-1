const UserXP = require('../models/UserXP');

const VOICE_XP_PER_MINUTE = 5;

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {

    if (!newState.member || newState.member.user.bot) return;

    if (!oldState.channel && newState.channel) {
      // دخل فويس
      newState.member.voice.joinTime = Date.now();
    }

    if (oldState.channel && !newState.channel) {
      // خرج من فويس
      const joinTime = oldState.member.voice.joinTime;
      if (!joinTime) return;

      const minutes = Math.floor((Date.now() - joinTime) / 60000);
      if (minutes <= 0) return;

      let data = await UserXP.findOne({
        guildId: oldState.guild.id,
        userId: oldState.member.id
      });

      if (!data) {
        data = new UserXP({
          guildId: oldState.guild.id,
          userId: oldState.member.id
        });
      }

      const xpGain = minutes * VOICE_XP_PER_MINUTE;

      data.voiceXP += xpGain;
      data.history.push({ amount: xpGain, type: "voice" });

      await data.save();
    }
  }
};
