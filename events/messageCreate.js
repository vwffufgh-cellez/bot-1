const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');
const Warning = require('../models/Warning');
const { resetIfNeeded } = require('../utils/resetHelpers');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';
const COOLDOWN = 60_000;

// التحذيرات
const WARN_LOG_CHANNEL_ID = '1463931942058852399';
const DM_USER_ON_WARN = true;
const MOD_REQUIRED_PERM = PermissionsBitField.Flags.ModerateMembers;
const WARN_ALIASES = ['warn', 'تحذير', 'تحدير', 'ت'];
const WARNINGS_ALIASES = ['warnings', 'warns', 'تحذيرات'];

// XP و TOP
const XP_PER_MESSAGE_MIN = 10;
const XP_PER_MESSAGE_MAX = 20;
const XP_COOLDOWN_PER_USER = 60_000;
const XP_ALIASES = ['xp', 'نقاط', 'خبرة'];
const TOP_BASE_ALIAS = 'top';
const TOP_SCOPE_KEYWORDS = {
  all: ['all', 'كل', 'عام', ''],
  daily: ['daily', 'day', 'يومي', 'يوم'],
  weekly: ['weekly', 'week', 'اسبوعي', 'أسبوعي', 'اسبوع'],
  monthly: ['monthly', 'month', 'شهري', 'شهر']
};

// التذاكر
const CLAIM_ALIASES = ['claim', 'استلام', 'انا'];
const UNCLAIM_ALIASES = ['unclaim', 'إلغاء', 'خروج'];

// خرائط الحماية
const processedCommands = new Map();
const userXpCooldowns = new Map();

function markProcessed(key, ttl = 3000) {
  if (processedCommands.has(key)) return false;
  const timeout = setTimeout(() => processedCommands.delete(key), ttl);
  processedCommands.set(key, timeout);
  return true;
}
function clearProcessed(key) {
  const t = processedCommands.get(key);
  if (!t) return;
  clearTimeout(t);
  processedCommands.delete(key);
}

// لوحات سريعة
const redPanel = (text, title = null) => {
  const embed = new EmbedBuilder().setColor(0xff0000).setDescription(`**${text}**`);
  if (title) embed.setTitle(title);
  return embed;
};
const bluePanel = (text, title = null) => {
  const embed = new EmbedBuilder().setColor(0x0099ff).setDescription(`**${text}**`);
  if (title) embed.setTitle(title);
  return embed;
};
const redConfirmPanel = text =>
  new EmbedBuilder().setColor(0xff0000).setDescription(`✅ ${text}`);

// ---- التحذيرات (نفس ما كان عندك) ----
const warnDetailEmbed = ({ guild, target, moderator, reason, caseId }) => {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('⚠️ تحذير جديد')
    .addFields(
      { name: 'المُحذَّر', value: `<@${target.id}> (${target.id})` },
      { name: 'المُصدر', value: `<@${moderator.id}> (${moderator.id})` },
      { name: 'السبب', value: reason },
      { name: 'الوقت', value: new Date().toLocaleString('ar-SA') },
      { name: 'رقم الحالة', value: caseId }
    )
    .setFooter({
      text: `بطلب من ${moderator.user ? moderator.user.tag : moderator.tag}`,
      iconURL: (moderator.user ?? moderator).displayAvatarURL?.({ size: 128 })
    });
};

const extractIdFromMention = arg => {
  if (!arg) return null;
  const m = arg.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d{15,21}$/.test(arg)) return arg;
  return null;
};
const fetchMember = async (guild, arg) => {
  const id = extractIdFromMention(arg);
  if (!id) return null;
  try { return await guild.members.fetch(id); } catch { return null; }
};

async function addWarningAndNotify(message, member, reason) {
  let doc = await Warning.findOne({ guildId: message.guild.id, userId: member.id });
  if (!doc) doc = new Warning({ guildId: message.guild.id, userId: member.id, infractions: [], total: 0 });

  const caseId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
  doc.infractions.push({ caseId, moderatorId: message.author.id, reason, createdAt: new Date() });
  doc.total = (doc.total ?? 0) + 1;
  await doc.save();

  if (DM_USER_ON_WARN) {
    try {
      await member.send({ embeds: [warnDetailEmbed({ guild: message.guild, target: member, moderator: message.member, reason, caseId })] });
    } catch {}
  }

  await message.channel.send({ embeds: [redConfirmPanel(`تم تحذير ${member.user.username}`)] });

  if (WARN_LOG_CHANNEL_ID) {
    const logCh = message.guild.channels.cache.get(WARN_LOG_CHANNEL_ID);
    if (logCh && logCh.id !== message.channel.id) {
      try {
        await logCh.send({ embeds: [warnDetailEmbed({ guild: message.guild, target: member, moderator: message.member, reason, caseId })] });
      } catch {}
    }
  }
}

async function showWarnings(message, member) {
  const doc = await Warning.findOne({ guildId: message.guild.id, userId: member.id });
  if (!doc || (doc.total ?? 0) === 0) {
    await message.reply({ embeds: [redPanel(`لا توجد تحذيرات لـ <@${member.id}>`)] });
    return;
  }
  const last10 = [...doc.infractions].slice(-10).reverse();
  const lines = last10.map(inf => {
    const when = new Date(inf.createdAt).toLocaleString('ar-SA');
    return `• رقم الحالة: ${inf.caseId}\nالزمان: ${when}\nبواسطة: <@${inf.moderatorId}>\nالسبب: ${inf.reason}`;
  }).join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setAuthor({ name: `تحذيرات ${member.user.tag}`, iconURL: member.displayAvatarURL({ size: 128 }) })
    .setDescription(lines)
    .setFooter({ text: `الإجمالي: ${doc.total} • بطلب من ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ size: 128 }) });

  await message.reply({ embeds: [embed] });
}

// ---- مساعدات الـ XP ----
const startOfDay = date => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};
const startOfWeek = date => {
  const d = new Date(date);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};
const startOfMonth = date => {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

function resetXpScopes(doc, now = Date.now()) {
  if (!doc.dailyResetAt || doc.dailyResetAt < startOfDay(now)) {
    doc.dailyXp = 0;
    doc.dailyResetAt = startOfDay(now);
  }
  if (!doc.weeklyResetAt || doc.weeklyResetAt < startOfWeek(now)) {
    doc.weeklyXp = 0;
    doc.weeklyResetAt = startOfWeek(now);
  }
  if (!doc.monthlyResetAt || doc.monthlyResetAt < startOfMonth(now)) {
    doc.monthlyXp = 0;
    doc.monthlyResetAt = startOfMonth(now);
  }
}

const calculateLevel = xp => Math.floor(0.1 * Math.sqrt(xp));
const xpForLevel = level => 10 * (level ** 2);
const xpForNextLevel = level => xpForLevel(level + 1);

function detectTopScope(args) {
  const keyword = (args[0] || '').toLowerCase();
  for (const [scope, list] of Object.entries(TOP_SCOPE_KEYWORDS)) {
    if (list.includes(keyword)) return scope;
  }
  return 'all';
}

function scopeField(scope) {
  switch (scope) {
    case 'daily': return 'dailyXp';
    case 'weekly': return 'weeklyXp';
    case 'monthly': return 'monthlyXp';
    default: return 'xp';
  }
}

function scopeLabel(scope) {
  switch (scope) {
    case 'daily': return 'اليومي';
    case 'weekly': return 'الأسبوعي';
    case 'monthly': return 'الشهري';
    default: return 'الإجمالي';
  }
}

// ---- الكود الرئيسي ----
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (!message.guild || message.author.bot) return;

    await resetIfNeeded(message.guild.id);

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const tokens = lower.split(/\s+/);

    // ----- أوامر التحذير -----
    if (WARN_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:warn`;
      if (!markProcessed(guardKey)) return;

      if (!message.member.permissions.has(MOD_REQUIRED_PERM)) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا تملك صلاحية تحذير الأعضاء.')] });
        return;
      }

      const parts = message.content.trim().split(/\s+/);
      const targetArg = parts[1];
      const targetMember = await fetchMember(message.guild, targetArg);

      if (!targetMember) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لم أستطع العثور على العضو. استخدم منشن أو آيدي صالح.')] });
        return;
      }
      if (targetMember.user.bot) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا يمكن تحذير بوت.')] });
        return;
      }
      if (targetMember.id === message.author.id) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا يمكنك تحذير نفسك.')] });
        return;
      }
      if (message.guild.ownerId !== message.author.id &&
          message.member.roles.highest.position <= targetMember.roles.highest.position) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا يمكنك تحذير هذا العضو لأن رتبته أعلى أو مساوية لرتبتك.')] });
        return;
      }

      const reason = parts.slice(2).join(' ').trim();
      if (!reason) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('الرجاء كتابة سبب التحذير. الاستخدام: `warn @user سبب`')] });
        return;
      }

      await addWarningAndNotify(message, targetMember, reason);
      return;
    }

    if (WARNINGS_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:warnings`;
      if (!markProcessed(guardKey)) return;
      const parts = message.content.trim().split(/\s+/);
      const targetArg = parts[1];
      const member = (await fetchMember(message.guild, targetArg)) || message.member;
      await showWarnings(message, member);
      return;
    }

    // ----- نظام التذاكر -----
    const isTicketChannel = message.channel.name?.startsWith(TICKET_PREFIX);
    const hasSupportRole = message.member.roles.cache.has(SUPPORT_ROLE_ID);

    if (CLAIM_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:claim`;
      if (!markProcessed(guardKey, COOLDOWN)) return;

      if (!isTicketChannel) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('هذا الأمر يعمل فقط داخل قنوات التذاكر.')] });
        return;
      }
      if (!hasSupportRole) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا تملك صلاحيات الاستلام.')] });
        return;
      }

      let ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });
      if (ticketClaim) {
        clearProcessed(guardKey);
        if (ticketClaim.claimedById === message.author.id) {
          await message.reply({ embeds: [bluePanel('لقد استلمت هذه التذكرة بالفعل.')] });
        } else {
          await message.reply({ embeds: [redPanel(`التذكرة مستلمة حالياً بواسطة <@${ticketClaim.claimedById}>.`)] });
        }
        return;
      }

      ticketClaim = new TicketClaim({
        guildId: message.guild.id,
        channelId: message.channel.id,
        claimedById: message.author.id,
        claimedAt: new Date()
      });
      await ticketClaim.save();

      await AdminStats.findOneAndUpdate(
        { guildId: message.guild.id, adminId: message.author.id },
        { $inc: { claimsCount: 1 } },
        { upsert: true }
      );

      await message.channel.send({ embeds: [bluePanel(`✅ <@${message.author.id}> قام باستلام التذكرة.`)] });
      return;
    }

    if (UNCLAIM_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:unclaim`;
      if (!markProcessed(guardKey, COOLDOWN)) return;

      if (!isTicketChannel) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('هذا الأمر يعمل فقط داخل قنوات التذاكر.')] });
        return;
      }
      if (!hasSupportRole) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا تملك صلاحيات الإلغاء.')] });
        return;
      }

      const ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });
      if (!ticketClaim) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا يوجد استلام مرتبط بهذه التذكرة.')] });
        return;
      }
      if (ticketClaim.claimedById !== message.author.id) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel(`لا يمكنك إلغاء استلام شخص آخر (<@${ticketClaim.claimedById}>).`)] });
        return;
      }

      await TicketClaim.deleteOne({ channelId: message.channel.id });
      await message.channel.send({ embeds: [bluePanel(`✅ <@${message.author.id}> ألغى استلام التذكرة.`)] });
      return;
    }

    // ----- منح الخبرة -----
    const now = Date.now();
    const lastXp = userXpCooldowns.get(message.author.id) || 0;
    if (now - lastXp >= XP_COOLDOWN_PER_USER) {
      const xpAmount = Math.floor(Math.random() * (XP_PER_MESSAGE_MAX - XP_PER_MESSAGE_MIN + 1)) + XP_PER_MESSAGE_MIN;
      let userXp = await UserXP.findOne({ guildId: message.guild.id, userId: message.author.id });
      if (!userXp) {
        userXp = new UserXP({
          guildId: message.guild.id,
          userId: message.author.id,
          xp: 0,
          level: 0,
          dailyXp: 0,
          weeklyXp: 0,
          monthlyXp: 0,
          dailyResetAt: startOfDay(now),
          weeklyResetAt: startOfWeek(now),
          monthlyResetAt: startOfMonth(now)
        });
      }

      resetXpScopes(userXp, now);
      const oldLevel = userXp.level;

      userXp.xp += xpAmount;
      userXp.dailyXp += xpAmount;
      userXp.weeklyXp += xpAmount;
      userXp.monthlyXp += xpAmount;
      userXp.level = calculateLevel(userXp.xp);

      await userXp.save();
      userXpCooldowns.set(message.author.id, now);

      if (userXp.level > oldLevel) {
        await message.channel.send({ embeds: [bluePanel(`🎉 تهانينا <@${message.author.id}>! وصلت إلى المستوى **${userXp.level}**`)] }).catch(() => {});
      }
    }

    // ----- أمر XP -----
    if (XP_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:xp`;
      if (!markProcessed(guardKey)) return;

      const parts = message.content.trim().split(/\s+/);
      const targetArg = parts[1];
      const member = (await fetchMember(message.guild, targetArg)) || message.member;
      const userXp = await UserXP.findOne({ guildId: message.guild.id, userId: member.id });

      if (!userXp || userXp.xp === 0) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel(`لا يوجد لدى <@${member.id}> أي خبرة حتى الآن.`)] });
        return;
      }

      resetXpScopes(userXp, now);
      await userXp.save();

      const currentLevel = userXp.level;
      const currentLevelStart = xpForLevel(currentLevel);
      const xpInCurrentLevel = userXp.xp - currentLevelStart;
      const xpNeeded = xpForNextLevel(currentLevel) - userXp.xp;

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setAuthor({ name: `خبرة ${member.user.tag}`, iconURL: member.displayAvatarURL({ size: 128 }) })
        .setDescription(
          `• **المستوى:** \`${currentLevel}\`\n` +
          `• **الخبرة الكلية:** \`${userXp.xp}\`\n` +
          `• **خبرة هذا الأسبوع:** \`${userXp.weeklyXp}\`\n` +
          `• **خبرة هذا اليوم:** \`${userXp.dailyXp}\`\n` +
          `• **متبقي للمستوى التالي:** \`${xpNeeded}\` نقطة`
        )
        .setFooter({ text: `بطلب من ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ size: 128 }) });

      await message.reply({ embeds: [embed] });
      return;
    }

    // ----- أمر TOP متعدد النطاقات -----
    if (tokens[0] === TOP_BASE_ALIAS || tokens[0] === 'توب' || tokens[0] === 'الأعلى') {
      const guardKey = `${message.id}:top`;
      if (!markProcessed(guardKey, 2000)) return;

      const args = tokens.slice(1);
      const scope = detectTopScope(args);
      const field = scopeField(scope);

      const topUsers = await UserXP.find({ guildId: message.guild.id })
        .sort({ [field]: -1 })
        .limit(10);

      if (topUsers.length === 0) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا توجد بيانات خبرة مسجلة بعد.')] });
        return;
      }

      const label = scopeLabel(scope);
      const lines = topUsers.map((doc, idx) => {
        const value = doc[field] || 0;
   
