const { EmbedBuilder } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';
const COOLDOWN = 60000;

function redPanel(text, title = null) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setDescription(`**${text}**`);

  if (title) embed.setTitle(title);
  return embed;
}

module.exports = {
  name: 'messageCreate',
  async execute(message) {

    if (!message.guild) return;
    if (message.author.bot) return;

    const content = message.content.toLowerCase().trim();

    await addTextXP(message);

    // ===========================
    // نظام التوب الاحترافي
    // ===========================
    if (content.startsWith('t')) {

      const args = content.split(' ').slice(1);

      let type = 'all';
      let period = 'all';

      if (args.includes('text')) type = 'text';
      if (args.includes('voice')) type = 'voice';
      if (args.includes('week')) period = 'week';
      if (args.includes('month')) period = 'month';

      const users = await UserXP.find({ guildId: message.guild.id });

      if (!users.length)
        return message.reply({ embeds: [redPanel('No Data Found')] });

      const calculated = users.map(u => {

        let total = 0;

        if (period === 'all') {
          if (type === 'all') total = u.textXP + u.voiceXP;
          if (type === 'text') total = u.textXP;
          if (type === 'voice') total = u.voiceXP;
        }

        if (period === 'week') {
          if (type === 'all') total = u.weeklyTextXP + u.weeklyVoiceXP;
          if (type === 'text') total = u.weeklyTextXP;
          if (type === 'voice') total = u.weeklyVoiceXP;
        }

        if (period === 'month') {
          if (type === 'all') total = u.monthlyTextXP + u.monthlyVoiceXP;
          if (type === 'text') total = u.monthlyTextXP;
          if (type === 'voice') total = u.monthlyVoiceXP;
        }

        return { userId: u.userId, total };
      });

      const sorted = calculated
        .filter(u => u.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      if (!sorted.length)
        return message.reply({ embeds: [redPanel('No Data In This Category')] });

      let text = '';

      for (let i = 0; i < sorted.length; i++) {
        const member = await message.guild.members
          .fetch(sorted[i].userId)
          .catch(() => null);

        if (!member) continue;

        text += `${i + 1}. ${member.user.username} - ${sorted[i].total}\n`;
      }

      return message.reply({
        embeds: [
          redPanel(text, 'Leaderboard')
        ]
      });
    }

    // ===========================
    // احتساب التكت
    // ===========================
    if (
      message.channel.name.startsWith(TICKET_PREFIX) &&
      message.member.roles.cache.has(SUPPORT_ROLE_ID)
    ) {

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

      message.channel.send({
        embeds: [redPanel(`Ticket claimed by ${message.author.username}`)]
      });
    }
  }
};

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
  if (data.lastMessage && now - data.lastMessage.getTime() < COOLDOWN) return;

  const xp = Math.floor(Math.random() * 10) + 5;

  data.textXP += xp;
  data.weeklyTextXP += xp;
  data.monthlyTextXP += xp;

  data.lastMessage = new Date();

  const total = data.textXP + data.voiceXP;
  const required = 5 * (data.level ** 2) + 50 * data.level + 100;

  if (total >= required) {
    data.level += 1;
    message.channel.send({
      embeds: [redPanel(`Level Up To ${data.level}`)]
    });
  }

  await data.save();
}
