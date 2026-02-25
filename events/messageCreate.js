const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');

const SUPPORT_ROLE_ID = 'ID_SUPPORT_ROLE';
const TICKET_PREFIX = 'ticket-'; // عدل لو اسم ثاني

module.exports = {
  name: 'messageCreate',
  async execute(message) {

    // تجاهل البوتات
    if (message.author.bot) return;

    // لازم يكون روم تكت
    if (!message.channel.name.startsWith(TICKET_PREFIX)) return;

    // لازم يكون إداري
    if (!message.member.roles.cache.has(SUPPORT_ROLE_ID)) return;

    // تحقق: هل التكت محسوب من قبل؟
    const existing = await TicketClaim.findOne({
      guildId: message.guild.id,
      channelId: message.channel.id
    });

    if (existing) return;

    // ✅ أول إداري كتب = استلام تكت
    await TicketClaim.create({
      guildId: message.guild.id,
      channelId: message.channel.id,
      adminId: message.author.id
    });

    // تحديث إحصائيات الإداري
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

    // إشعار (اختياري)
    message.channel.send(
      `📌 تم احتساب التذكرة للإداري ${message.author}`
    );
  }
};
