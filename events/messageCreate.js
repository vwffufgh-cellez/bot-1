const { EmbedBuilder } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');
const { resetIfNeeded } = require('../utils/resetHelpers');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';
const COOLDOWN = 60_000;

// ==================== لوحة المتصدرين الموحدة ====================
async function handleCombinedLeaderboard(message) {
  const docs = await UserXP.find({ guildId: message.guild.id });
  
  // جلب بيانات المستخدم الحالي
  let userData = await UserXP.findOne({
    guildId: message.guild.id,
    userId: message.author.id
  });

  // تطبيق resets إذا كان عندك في resetHelpers
  await Promise.all(docs.map(doc => resetIfNeeded(doc)));
  
  // استخراج التوب الكتابي
  const textTop = docs
    .map(doc => ({
      userId: doc.userId,
      xp: doc.textXP ?? 0
    }))
    .filter(x => x.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 5);

  // استخراج التوب الصوتي
  const voiceTop = docs
    .map(doc => ({
      userId: doc.userId,
      xp: doc.voiceXP ?? 0
    }))
    .filter(x => x.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 5);

  // --- تنسيق كتابي ---
  let textLines = '';
  if (textTop.length > 0) {
    textLines = textTop
      .map((entry, i) => `**#${i + 1}** | <@${entry.userId}> \| **XP: ${entry.xp}**`)
      .join('\n');
  } else if (userData?.textXP && userData.textXP > 0) {
    textLines = `**#1** | <@${message.author.id}> \| **XP: ${userData.textXP}**`;
  } else {
    textLines = `**#1** | <@${message.author.id}> \| **XP: 0**`;
  }

  // --- تنسيق صوتي ---
  let voiceLines = '';
  if (voiceTop.length > 0) {
    voiceLines = voiceTop
      .map((entry, i) => `**#${i + 1}** | <@${entry.userId}> \| **XP: ${entry.xp}**`)
      .join('\n');
  } else if (userData?.voiceXP && userData.voiceXP > 0) {
    voiceLines = `**#1** | <@${message.author.id}> \| **XP: ${userData.voiceXP}**`;
  } else {
    voiceLines = `**#1** | <@${message.author.id}> \| **XP: 0**`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xE01B1B)
    .setAuthor({
      name: 'قائمة متصدرين السيرفر',
      iconURL: message.guild.iconURL({ size: 128 }) || undefined
    })
    .addFields(
      { name: '💬 أعلى كتابياً', value: textLines, inline: true },
      { name: '🔊 أعلى صوتياً', value: voiceLines, inline: true }
    )
    .setFooter({
      text: `${message.author.tag} • ${new Date().toLocaleString('ar-SA')}`,
      iconURL: message.author.displayAvatarURL({ size: 128 })
    });

  await message.reply({ embeds: [embed] });
}

// ==================== بنل أحمر عام ====================
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
    if (!message.guild || message.author.bot) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const tokens = lower.split(/\s+/);

    // ==================== أمر التوب بدون برفكس ====================
    if (tokens[0] === 't' || tokens[0] === 'top') {
      await handleCombinedLeaderboard(message);
      return; // لا نضيف XP لهذه الرسالة
    }

    // ==================== نظام XP الكتابي + مستويات ====================
    await addTextXP(message);

    // ==================== نظام التكت والدعم ====================
    if (
      message.channel?.name?.startsWith(TICKET_PREFIX) &&
      message.member?.roles.cache.has(SUPPORT_ROLE_ID)
    ) {
      const existing = await TicketClaim.findOne({
        guildId: message.guild.id,
        channelId: message.channel.id
      });

      if (!existing) {
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

        await message.channel.send({
          embeds: [redPanel(`Ticket claimed by ${message.author.username}`)]
        });
      }
    }
  }
};

// ==================== نظام XP الكتابي ====================
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

  await resetIfNeeded(data);

  const now = Date.now();
  if (data.lastMessage && now - data.lastMessage.getTime() < COOLDOWN) return;

  const xp = Math.floor(Math.random() * 10) + 5;

  data.textXP = (data.textXP ?? 0) + xp;
  data.dailyTextXP = (data.dailyTextXP ?? 0) + xp;
  data.weeklyTextXP = (data.weeklyTextXP ?? 0) + xp;
  data.monthlyTextXP = (data.monthlyTextXP ?? 0) + xp;

  data.lastMessage = new Date();
  if (typeof data.level !== 'number') data.level = 0;
  if (typeof data.voiceXP !== 'number') data.voiceXP = 0;

  const total = data.textXP + data.voiceXP;
  const required = 5 * (data.level ** 2) + 50 * data.level + 100;

  if (total >= required) {
    data.level += 1;
    await message.channel.send({
      embeds: [redPanel(`Level Up To ${data.level}`)]
    });
  }

  await data.save();
}
