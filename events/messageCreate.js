const { EmbedBuilder } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');
const { resetIfNeeded } = require('../utils/resetHelpers');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';
const COOLDOWN = 60_000;

const TEXT_EMOJI = '💬';
const VOICE_EMOJI = '🔊';

const PERIOD_FIELDS = {
  total: { text: 'textXP', voice: 'voiceXP', label: 'لائحة متصدري نقاط السيرفر' },
  day: { text: 'dailyTextXP', voice: 'dailyVoiceXP', label: 'لائحة متصدري نقاط اليوم' },
  week: { text: 'weeklyTextXP', voice: 'weeklyVoiceXP', label: 'لائحة متصدري نقاط الأسبوع' },
  month: { text: 'monthlyTextXP', voice: 'monthlyVoiceXP', label: 'لائحة متصدري نقاط الشهر' }
};

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

    // ===========================
    // نظام التوب بدون برفكس
    // ===========================
    if (tokens[0] === 't') {
      const args = tokens.slice(1);
      let period = 'total';
      let focus = 'all';

      for (const arg of args) {
        if (['day', 'week', 'month'].includes(arg)) period = arg;
        if (['text', 'voice'].includes(arg)) focus = arg;
      }

      await handleTopCommand(message, period, focus);
      return; // لا نضيف XP لرسائل الأمر
    }

    // ===========================
    // XP الكتابي + الليفل
    // ===========================
    await addTextXP(message);

    // ===========================
    // نظام التكت
    // ===========================
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

async function handleTopCommand(message, periodKey, focusKey) {
  const period = PERIOD_FIELDS[periodKey] ?? PERIOD_FIELDS.total;
  const focus = ['text', 'voice'].includes(focusKey) ? focusKey : 'all';

  const docs = await UserXP.find({ guildId: message.guild.id });
  if (!docs.length) {
    await message.reply({ embeds: [redPanel('لا توجد بيانات بعد.')] });
    return;
  }

  await Promise.all(docs.map(doc => resetIfNeeded(doc)));

  const leaderboard = docs
    .map(doc => {
      const textXP = doc[period.text] ?? 0;
      const voiceXP = doc[period.voice] ?? 0;
      const sortValue =
        focus === 'text' ? textXP :
        focus === 'voice' ? voiceXP :
        textXP + voiceXP;

      return {
        userId: doc.userId,
        text: textXP,
        voice: voiceXP,
        sortValue
      };
    })
    .filter(entry => entry.sortValue > 0)
    .sort((a, b) => b.sortValue - a.sortValue)
    .slice(0, 5);

  if (!leaderboard.length) {
    await message.reply({ embeds: [redPanel('لا يوجد بيانات في هذا التصنيف.')] });
    return;
  }

  const focusLabel =
    focus === 'text' ? ' (ترتيب كتابي)' :
    focus === 'voice' ? ' (ترتيب صوتي)' : '';

  const description = leaderboard
    .map((entry, index) =>
      `#${index + 1} | <@${entry.userId}>  ${TEXT_EMOJI} ${entry.text}  ${VOICE_EMOJI} ${entry.voice}`
    )
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xE01B1B)
    .setAuthor({
      name: `${period.label}${focusLabel}`,
      iconURL: message.guild.iconURL({ size: 128 }) ?? undefined
    })
    .setDescription(description)
    .setFooter({
      text: `${message.author.tag} • ${new Date().toLocaleString('ar-SA')}`,
      iconURL: message.author.displayAvatarURL({ size: 128 })
    });

  await message.channel.send({ embeds: [embed] });
}

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
