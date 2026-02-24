const { Events } = require('discord.js');
const getAdmin = require('../utils/getAdmin');

const messageCounter = new Map(); 
// يخزن عدد الرسائل لكل إداري داخل كل تكت

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {

    if (message.author.bot) return;
    if (!message.guild) return;

    // نتأكد أن الروم تكت
    if (!message.channel.name.startsWith('ticket-')) return;

    // نتأكد أن العضو إداري (غير اسم الرتبة حسب سيرفرك)
    if (!message.member.roles.cache.some(r => r.name === "Staff")) return;

    const key = `${message.guild.id}-${message.channel.id}-${message.author.id}`;

    const current = messageCounter.get(key) || 0;
    messageCounter.set(key, current + 1);

    // إذا وصل 5 رسائل نحسبها تكت
    if (messageCounter.get(key) >= 5) {

      const admin = await getAdmin(message.guild.id, message.author.id);

      admin.ticketsCount += 1;
      admin.xp += 300;

      await admin.save();

      messageCounter.delete(key);

      message.channel.send(`✅ تم احتساب تكت للإداري <@${message.author.id}>`);
    }

  }
};
