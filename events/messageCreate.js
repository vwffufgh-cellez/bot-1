const { EmbedBuilder } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';
const COOLDOWN = 60 * 1000; // دقيقة

module.exports = {
  name: 'messageCreate',
  async execute(message) {

    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.toLowerCase().trim();

    // =====================================================
    // 🔥 1️⃣ إضافة XP لكل رسالة
    // =====================================================
    await addTextXP(message);

    // =====================================================
    // 📊 2️⃣ أمر t (إحصائيات المستخدم)
    // =====================================================
    if (content === 't') {

      const data = await UserXP.findOne({
        guildId: message.guild.id,
        userId: message.author.id
      });

      if (!data) return message.reply('❌ ما عندك بيانات');

      const totalXP = data.textXP + data.voiceXP;

      const rank =
        await UserXP.countDocuments({
          guildId: message.guild.id,
          $expr: {
            $gt: [
              { $add: ["$textXP", "$voiceXP"] },
              totalXP
            ]
          }
        }) + 1;

      const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setAuthor({
          name: message.author.username,
          iconURL: message.author.displayAvatarURL()
        })
        .setTitle('📊 إحصائياتك')
        .addFields(
          { name: '⭐ XP الكلي', value: `${totalXP}`, inline: true },
          { name: '💬 XP كتابي', value: `${data.textXP}`, inline: true },
          { name: '🎧 XP فويس', value: `${data.voiceXP}`, inline: true },
          { name: '🏆 اللفل', value: `${data.level}`, inline: true },
          { name: '📈 ترتيبك', value: `#${rank}`, inline: true }
        )
        .setFooter({ text: `Server: ${message.guild.name}` });

      return message.reply({ embeds: [embed] });
    }

    // =====================================================
    // 🏆 3️⃣ أمر t top
    // =====================================================
    if (content === 't top') {

      const allUsers = await UserXP.find({ guildId: message.guild.id });

      const sorted = allUsers
        .map(u => ({
          ...u._doc,
          total: u.textXP + u.voiceXP
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      if (!sorted.length)
        return message.reply('لا يوجد بيانات بعد');

      let description = '';

      for (let i = 0; i < sorted.length; i++) {
        const member = await message.guild.members.fetch(sorted[i].userId).catch(() => null);
        if (!member) continue;

        description += `**${i + 1}.** ${member.user.username} — ${sorted[i].total} XP\n`;
      }

      const embed = new EmbedBuilder()
        .setColor('#ffd700')
        .setTitle('🏆 أفضل 10 أعضاء')
        .setDescription(description);

      return message.reply({ embeds: [embed] });
    }

    // =====================================================
    // 🎟 4️⃣ احتساب التكت للإداري
    // =====================================================
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

// =====================================================
// 🔥 دالة إضافة XP
// =====================================================
async function addTextXP(message) {

  let data = await UserXP.findOne({
    guildId: message.guild.id,
    userId: message.author.id
  });

  if (!data) {
    data = new UserXP({
      guildId: message.guild.id,
      userId: message.author.id,
      textXP: 0,
      voiceXP: 0,
      level: 0,
      history: []
    });
  }

  const now = Date.now();

  if (data.lastMessage && now - data.lastMessage < COOLDOWN) return;

  const xpGain = Math.floor(Math.random() * 10) + 5;

  data.textXP += xpGain;
  data.lastMessage = now;
  data.history.push({ amount: xpGain, type: "text" });

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
