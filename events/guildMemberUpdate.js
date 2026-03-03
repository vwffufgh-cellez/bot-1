const { Events } = require('discord.js');
const { upsertAdminProfile } = require('../utils/adminProfileService');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    try {
      // أي تحديث (خصوصًا رتب/اسم) يحدث البطاقة
      await upsertAdminProfile(newMember);
    } catch (e) {
      console.error('guildMemberUpdate profile sync error:', e);
    }
  }
};
