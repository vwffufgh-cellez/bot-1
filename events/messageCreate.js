const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');
const Warning = require('../models/Warning');
const { resetIfNeeded } = require('../utils/resetHelpers');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';
const COOLDOWN = 60_000;

// إعدادات نظام التحذيرات
const WARN_LOG_CHANNEL_ID = '1463931942058852399'; // ضع آيدي قناة اللوغ هنا (اختياري). اتركه فارغ لتعطيله
const DM_USER_ON_WARN = true;
const MOD_REQUIRED_PERM = PermissionsBitField.Flags.ModerateMembers;

const WARN_ALIASES = ['warn', 'تحذير', 'تحدير', 'ت'];
const WARNINGS_ALIASES = ['warnings', 'warns', 'تحذيرات'];

// ==================== لوحة المتصدرين الموحدة ====================
async function handleCombinedLeaderboard(message, type = 'total', period = 'all') {
  const docs = await UserXP.find({ guildId: message.guild.id });
  let userData = await UserXP.findOne({
    guildId: message.guild.id,
    userId: message.author.id
  });

  await Promise.all(docs.map(doc => resetIfNeeded(doc)));

  const textField = getTypeXpField('text', period);
  const voiceField = getTypeXpField('voice', period);

  const textTop = docs
    .map(doc => ({ userId: doc.userId, xp: doc[textField] ?? 0 }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 5);

  const voiceTop = docs
    .map(doc => ({ userId: doc.userId, xp: doc[voiceField] ?? 0 }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 5);

  // --- تنسيق كتابي ---
  let textLines = '';
  const authorTextXP = textTop.find(e => e.userId === message.author.id);
  if (authorTextXP && authorTextXP.xp > 0) {
    const rank = textTop.findIndex(e => e.userId === message.author.id) + 1;
    textLines = `**#${rank}** | <@${message.author.id}> \\| **XP: ${authorTextXP.xp}**`;
    const others = textTop.filter(e => e.userId !== message.author.id).slice(0, 4);
    if (others.length > 0) {
      textLines += '\n' + others.map((entry, i) =>
        `**#${i + 2}** | <@${entry.userId}> \\| **XP: ${entry.xp}**`
      ).join('\n');
    }
  } else {
    textLines = `**#1** | <@${message.author.id}> \\| **XP: 0**`;
    const others = textTop.filter(e => e.userId !== message.author.id && e.xp > 0).slice(0, 4);
    if (others.length > 0) {
      textLines += '\n' + others.map((entry, i) =>
        `**#${i + 2}** | <@${entry.userId}> \\| **XP: ${entry.xp}**`
      ).join('\n');
    }
  }

  // --- تنسيق صوتي ---
  let voiceLines = '';
  const authorVoiceXP = voiceTop.find(e => e.userId === message.author.id);
  if (authorVoiceXP && authorVoiceXP.xp > 0) {
    const rank = voiceTop.findIndex(e => e.userId === message.author.id) + 1;
    voiceLines = `**#${rank}** | <@${message.author.id}> \\| **XP: ${authorVoiceXP.xp}**`;
    const others = voiceTop.filter(e => e.userId !== message.author.id).slice(0, 4);
    if (others.length > 0) {
      voiceLines += '\n' + others.map((entry, i) =>
        `**#${i + 2}** | <@${entry.userId}> \\| **XP: ${entry.xp}**`
      ).join('\n');
    }
  } else {
    voiceLines = `**#1** | <@${message.author.id}> \\| **XP: 0**`;
    const others = voiceTop.filter(e => e.userId !== message.author.id && e.xp > 0).slice(0, 4);
    if (others.length > 0) {
      voiceLines += '\n' + others.map((entry, i) =>
        `**#${i + 2}** | <@${entry.userId}> \\| **XP: ${entry.xp}**`
      ).join('\n');
    }
  }

  const sectionTitle = getPeriodSectionTitle(period);

  const embed = new EmbedBuilder()
    .setColor(0xE01B1B)
    .setAuthor({
      name: `قائمة متصدرين السيرفر ${sectionTitle}`,
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

// ------------------- أوامر التحذير -------------------
function extractIdFromMention(arg) {
  if (!arg) return null;
  const m = arg.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d{15,21}$/.test(arg)) return arg;
  return null;
}

async function fetchMember(guild, arg) {
  const id = extractIdFromMention(arg);
  if (!id) return null;
  try { return await guild.members.fetch(id); } catch { return null; }
}

function warnEmbed({ guild, target, moderator, reason, caseId }) {
  return new EmbedBuilder()
    .setColor(0xffcc00)
    .setTitle('تحذير جديد ⚠️')
    .addFields(
      { name: 'المُحذَّر', value: `<@${target.id}> (${target.id})`, inline: false },
      { name: 'الإداري', value: `<@${moderator.id}> (${moderator.id})`, inline: false },
      { name: 'السبب', value: reason, inline: false },
      { name: 'الوقت', value: new Date().toLocaleString('ar-SA'), inline: false }
    )
    .setFooter({
      text: `يطلب من ${moderator.user ? moderator.user.tag : moderator.tag}`,
      iconURL: (moderator.user ?? moderator).displayAvatarURL?.({ size: 128 })
    });
}

async function addWarningAndNotify(message, member, reason) {
  let doc = await Warning.findOne({ guildId: message.guild.id, userId: member.id });
  if (!doc) doc = new Warning({ guildId: message.guild.id, userId: member.id });
  const caseId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;

  doc.infractions.push({
    caseId,
    moderatorId: message.author.id,
    reason,
    createdAt: new Date()
  });
  doc.total += 1;
  await doc.save();

  // DM للمستخدم
  if (DM_USER_ON_WARN) {
    try {
      await member.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffcc00)
            .setTitle('تم تحذيرك')
            .setDescription(`تم تحذيرك في خادم ${message.guild.name}.`)
            .addFields(
              { name: 'السبب', value: reason, inline: false },
              { name: 'التاريخ', value: new Date().toLocaleString('ar-SA'), inline: false }
            )
            .setFooter({ text: `رقم الحالة: ${caseId}` })
        ]
      });
    } catch {
      // المستخدم قافل الخاص—نتجاهل الخطأ
    }
  }

  const embed = warnEmbed({
    guild: message.guild,
    target: member,
    moderator: message.member,
    reason,
    caseId
  });

  // أرسل في القناة الحالية
  await message.channel.send({ embeds: [embed] });

  // أرسل في قناة اللوق إن تم ضبطها
  if (WARN_LOG_CHANNEL_ID) {
    const logCh = message.guild.channels.cache.get(WARN_LOG_CHANNEL_ID);
    if (logCh) {
      try { await logCh.send({ embeds: [embed] }); } catch {}
    }
  }
}

async function showWarnings(message, member) {
  const doc = await Warning.findOne({ guildId: message.guild.id, userId: member.id });
  if (!doc || doc.total === 0) {
    await message.reply({ embeds: [redPanel(`لا توجد تحذيرات لـ <@${member.id}>`)] });
    return;
  }

  const last10 = [...doc.infractions].slice(-10).reverse();
  const lines = last10.map((inf, i) => {
    const num = doc.total - i;
    const when = new Date(inf.createdAt).toLocaleString('ar-SA');
    return `#${num} • ${when}\nبواسطة: <@${inf.moderatorId}>\nالسبب: ${inf.reason}`;
  }).join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: `تحذيرات ${member.user.tag}`, iconURL: member.displayAvatarURL({ size: 128 }) })
    .setDescription(lines)
    .setFooter({
      text: `الإجمالي: ${doc.total} • يطلب من ${message.author.tag}`,
      iconURL: message.author.displayAvatarURL({ size: 128 })
    });

  await message.reply({ embeds: [embed] });
}

// ------------------- دوال مساعدة -------------------
function getTypeXpField(type, period) {
  if (period === 'all') {
    return type === 'voice' ? 'voiceXP' : 'textXP';
  }
  const prefix =
    period === 'day' ? 'daily' :
    period === 'week' ? 'weekly' :
    period === 'month' ? 'monthly' : null;
  if (!prefix) return type === 'voice' ? 'voiceXP' : 'textXP';
  return type === 'voice' ? `${prefix}VoiceXP` : `${prefix}TextXP`;
}

function getPeriodSectionTitle(period) {
  const titles = { all: '', day: 'اليوم', week: 'الأسبوع', month: 'الشهر' };
  return titles[period] ? ` (${titles[period]})` : '';
}

// ==================== بنل أحمر عام ====================
function redPanel(text, title = null) {
  const embed = new EmbedBuilder().setColor(0xff0000).setDescription(`**${text}**`);
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

    // ========= أوامر التحذير =========
    if (WARN_ALIASES.includes(tokens[0])) {
      if (!message.member.permissions.has(MOD_REQUIRED_PERM)) {
        await message.reply({ embeds: [redPanel('لا تملك صلاحية تحذير الأعضاء.')] });
        return;
      }
      const targetArg = message.content.split(/\s+/)[1]; // استخدم النص الأصلي لحفظ المنشن كما هو
      const targetMember = await fetchMember(message.guild, targetArg);
      if (!targetMember) {
        await message.reply({ embeds: [redPanel('لم أستطع العثور على العضو. استخدم منشن أو آيدي صالح.')] });
        return;
      }
      const reason = message.content.split(/\s+/).slice(2).join(' ').trim() || 'غير مُحدد';
      await addWarningAndNotify(message, targetMember, reason);
      return;
    }

    if (WARNINGS_ALIASES.includes(tokens[0])) {
      const targetArg = message.content.split(/\s+/)[1];
      const member = (await fetchMember(message.guild, targetArg)) || message.member;
      await showWarnings(message, member);
      return;
    }

    // ==================== أمر التوب بدون برفكس ====================
    if (tokens[0] === 't' || tokens[0] === 'top') {
      const secondToken = tokens[1];
      let type = 'text';
      let period = 'all';

      if (secondToken) {
        if (['day', 'd'].includes(secondToken)) { type = 'text'; period = 'day'; }
        else if (['week', 'w'].includes(secondToken)) { type = 'text'; period = 'week'; }
        else if (['month', 'm'].includes(secondToken)) { type = 'text'; period = 'month'; }
        else if (['v', 'voice'].includes(secondToken)) { type = 'voice'; period = 'all'; }
        else if ((secondToken.startsWith('v') && ['vday', 'vd'].includes(secondToken))) { type = 'voice'; period = 'day'; }
        else if ((secondToken.startsWith('v') && ['vweek', 'vw'].includes(secondToken))) { type = 'voice'; period = 'week'; }
        else if ((secondToken.startsWith('v') && ['vmonth', 'vm'].includes(secondToken))) { type = 'voice'; period = 'month'; }
      }

      await handleCombinedLeaderboard(message, type, period);
      return;
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
    await message.channel.send({ embeds: [redPanel(`Level Up To ${data.level}`)] });
  }

  await data.save();
}
