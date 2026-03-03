const { Events } = require('discord.js');
const { upsertAdminProfile, hasAdminRole } = require('../utils/adminProfileService');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      for (const [, guild] of client.guilds.cache) {
        await guild.members.fetch();
        const admins = guild.members.cache.filter(m => hasAdminRole(m));
        for (const [, member] of admins) {
          await upsertAdminProfile(member);
        }
      }
      console.log('AdminProfile backfill done.');
    } catch (e) {
      console.error('Ready backfill error:', e);
    }
  }
};
