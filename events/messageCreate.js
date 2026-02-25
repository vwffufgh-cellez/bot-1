const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-'; // عدل لو اسم ثاني

module.exports = {
  name: 'messageCreate',
  async execute(message) {

    if (message.author.bot) return;
    if (!message.guild) return;

    // ================================
    // 1️⃣ نظام XP العام لكل الأعضاء
    // ================================

    // تجاهل الأوامر
    if (!message.content.startsWith('!') && !message.content.startsWith('/')) {

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

    // =================================
    // 2️⃣ نظام احتساب التكت للإداري
    // =================================

    // لازم يكون روم تكت
    if (!message.channel.name.startsWith(TICKET_PREFIX)) return;

    // لازم يكون إداري
    if (!message.member.roles.cache.has(SUPPORT_ROLE_ID)) return;

    const existing = await TicketClaim.findOne({
      guildId: message.guild.id,
      channelId: message.channel.id
    });

    if (existing) return;

    // أول إداري يكتب = استلام تكت
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

    message.channel.send(
      `📌 تم احتساب التذكرة للإداري ${message.author}`
    );
  }
};
