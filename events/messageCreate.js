const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';

const DAY = 1000 * 60 * 60 * 24;

module.exports = {
  name: 'messageCreate',
  async execute(message) {

    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.toLowerCase().trim();

    // =====================================
    // 1️⃣ أمر t (XP المستخدم نفسه)
    // =====================================
    if (content.startsWith('t')) {
      const args = content.split(/\s+/);
      if (args[0] === 't') {

        const type = args[1] || 'all';

        const data = await UserXP.findOne({
          guildId: message.guild.id,
          userId: message.author.id
        });

        if (!data) {
          return message.reply('❌ ما عندك XP للحين');
        }

        let xp = data.xp;

        if (type !== 'all') {
          const days = type === 'week' ? 7 : 30;
          const now = Date.now();

          xp = data.history
            .filter(h => now - h.date.getTime() <= days * DAY)
            .reduce((a, b) => a + b.amount, 0);
        }

        return message.reply(`
⭐ **XP حقك**
━━━━━━━━━━━━
📊 XP: ${xp}
📅 النوع: ${
          type === 'all'
            ? 'الكل'
            : type === 'week'
            ? 'أسبوعي'
            : 'شهري'
        }
        `);
      }
    }

    // =====================================
    // 2️⃣ نظام XP العام (كل رسالة)
    // =====================================
    if (!content.startsWith('!') && !content.startsWith('/')) {

      let userData = await UserXP.findOne({
        guildId: message.guild.id,
        userId: message.author.id
      });

      if (!userData) {
        userData = new UserXP({
          guildId: message.guild.id,
          userId: message.author.id
        });
      }

      const xpGain = Math.floor(Math.random() * 5) + 1;

      userData.xp += xpGain;
      userData.history.push({ amount: xpGain });

      await userData.save();
    }

    // =====================================
    // 3️⃣ احتساب التكت للإداري
    // =====================================
    if (!message.channel.name.startsWith(TICKET_PREFIX)) return;
    if (!message.member.roles.cache.has(SUPPORT_ROLE_ID)) return;

    const existing = await TicketClaim.findOne({
      guildId: message.guild.id,
      channelId: message.channel.id
    });

    if (existing) return;

    await TicketClaim.create({
      guildId: message.guild.id,
      channelId: message.channel.id,
      adminId: message.author.id
    });

    let stats = await AdminStats.findOne({
      guildId: message.guild.id,
      adminId: message.author.id
    });

    if (!stats) {
      stats = new AdminStats({
        guildId: message.guild.id,
        adminId: message.author.id
      });
    }

    stats.ticketsClaimed += 1;
    stats.xp += 5;

    await stats.save();

    message.channel.send(`📌 تم احتساب التذكرة للإداري ${message.author}`);
  }
};
const { EmbedBuilder } = require('discord.js');
const UserXP = require('../models/UserXP');

const COOLDOWN = 60 * 1000; // دقيقة

async function addTextXP(message) {
  let data = await UserXP.findOne({
    guildId: message.guild.id,
    userId: message.author.id
  });

  if (!data) {
    data = new UserXP({
      guildId: message.guild.id,
      userId: message.author.id
    });
  }

  const now = Date.now();

  if (data.lastMessage && now - data.lastMessage < COOLDOWN) return;

  const xpGain = Math.floor(Math.random() * 10) + 5;

  data.textXP += xpGain;
  data.lastMessage = now;
  data.history.push({ amount: xpGain, type: "text" });

  // نظام لفلات
  const totalXP = data.textXP + data.voiceXP;
  const requiredXP = 5 * (data.level ** 2) + 50 * data.level + 100;

  if (totalXP >= requiredXP) {
    data.level += 1;

    message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor('#00ff88')
          .setTitle('🎉 Level Up!')
          .setDescription(`مبروك ${message.author} وصلت لفل **${data.level}** 🔥`)
      ]
    });
  }

  await data.save();
}
