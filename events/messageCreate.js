const { EmbedBuilder } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');
const { resetIfNeeded } = require('../utils/resetHelpers');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';
const COOLDOWN = 60_000;

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (!message.guild || message.author.bot) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const tokens = lower.split(/\s+/);

    // ========= أمر التوب — بنل واحد فيه كتابي + صوتي =========
    if (tokens[0] === 't') {
      const period = tokens[1]; // week, day, month أو فاضي
      await handleCombinedLeaderboard(message, period);
      return;
    }

    // ========= نظام XP الكتابي + مستويات =========
    await addTextXP(message);

    // ========= نظام التكت والدعم =========
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

// ===== لوحة متصدرين واحدة فيها كتابي + صوتي =====
async function handleCombinedLeaderboard(message, period) {
  const docs = await UserXP.find({ guildId: message.guild.id });

  if (!docs.length) {
    const emptyEmbed = new EmbedBuilder()
      .setColor(0xE01B1B)
      .setAuthor({
        name: 'لائحة متصدرين نقاط السيرفر',
        iconURL: message.guild.iconURL({ size: 128 }) || undefined
      })
      .addFields(
        { name: '💬 أعلى ٥ كتابياً', value: 'لا يوجد بيانات بعد.', inline: true },
        { name: '🔊 أعلى ٥ صوتياً', value: 'لا يوجد بيانات بعد.', inline: true }
      )
      .setFooter({
        text: `${message.author.tag} • ${new Date().toLocaleString('ar-SA')}`,
        iconURL: message.author.displayAvatarURL({ size: 128 })
      });

    await message.reply({ embeds: [emptyEmbed] });
    return;
  }

  await Promise.all(docs.map(doc => resetIfNeeded(doc)));

  // تحديد حقل الـ XP حسب الفترة
  let textField = 'textXP';
  let voiceField = 'voiceXP';
  let periodLabel = '';

  if (period === 'day') {
    textField = 'dailyTextXP';
    voiceField = 'dailyVoiceXP';
    periodLabel = ' (اليوم)';
  } else if (period === 'week') {
    textField = 'weeklyTextXP';
    voiceField = 'weeklyVoiceXP';
    periodLabel = ' (الأسبوع)';
  } else if (period === 'month') {
    textField = 'monthlyTextXP';
    voiceField = 'monthlyVoiceXP';
    periodLabel = ' (الشهر)';
  }

  // توب 5 كتابي
  const textTop = docs
    .map(doc => ({ userId: doc.userId, xp: doc[textField] ?? 0 }))
    .filter(x => x.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 5);

  // توب 5 صوتي
  const voiceTop = docs
    .map(doc => ({ userId: doc.userId, xp: doc[voiceField] ?? 0 }))
    .filter(x => x.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 5);

  const textLines = textTop.length
    ? textTop
        .map((e, i) => `**#${i + 1}** | <@${e.userId}> | **XP: ${e.xp}**`)
        .join('\n')
    : 'لا يوجد بيانات بعد.';

  const voiceLines = voiceTop.length
    ? voiceTop
        .map((e, i) => `**#${i + 1}** | <@${e.userId}> | **XP: ${e.xp}**`)
        .join('\n')
    : 'لا يوجد بيانات بعد.';

  // حقل فاصل وسط بين العمودين
  const topTextTag = textTop.length
    ? `<top text <@&week/ ✨المزيد`
    : '';
  const topVoiceTag = voiceTop.length
    ? `<top voice <@&week/ ✨المزيد`
    : '';

  const embed = new EmbedBuilder()
    .setColor(0xE01B1B)
    .setAuthor({
      name: `لائحة متصدرين نقاط السيرفر${periodLabel}`,
      iconURL: message.guild.iconURL({ size: 128 }) || undefined
    })
    .addFields(
      {
        name: '🔊 أعلى ٥ صوتياً',
        value: voiceLines,
        inline: true
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: true
      },
      {
        name: '💬 أعلى ٥ كتابياً',
        value: textLines,
        inline: true
      }
    )
    .setFooter({
      text: `${message.author.tag} • ${new Date().toLocaleString('ar-SA')}`,
      iconURL: message.author.displayAvatarURL({ size: 128 })
    });

  await message.reply({ embeds: [embed] });
}

// ===== بنل أحمر عام =====
function redPanel(text, title = null) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setDescription(`**${text}**`);
  if (title) embed.setTitle(title);
  return embed;
}

// ===== نظام XP الكتابي =====
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
