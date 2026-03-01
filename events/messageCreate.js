const { Events, EmbedBuilder, PermissionsBitField } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');
const Warning = require('../models/Warning');
const { resetIfNeeded } = require('../utils/resetHelpers');
const { ALIASES, POINT_TYPE_ALIASES } = require('../config/adminProgressConfig');
const {
  getOrCreate,
  addPoints,
  setPoints,
  tryPromote,
  convertPoints,
  transferPoints,
  getMultiplier,
  getNextLevelConfig,
  scaledReq,
  normalizePointKey
} = require('../utils/adminProgressService');

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';
const COOLDOWN = 60_000;

const WARN_LOG_CHANNEL_ID = '1463931942058852399';
const DM_USER_ON_WARN = true;
const MOD_REQUIRED_PERM = PermissionsBitField.Flags.ModerateMembers;

const WARN_ALIASES = ['warn', 'تحذير', 'تحدير', 'ت'];
const WARNINGS_ALIASES = ['warnings', 'warns', 'تحذيرات', 'تحديرات'];
const CLAIM_ALIASES = ['claim', 'استلام', 'انا'];
const UNCLAIM_ALIASES = ['unclaim', 'إلغاء', 'خروج'];
const XP_ALIASES = ['xp', 'نقاط', 'خبرة'];
const TOP_ALIASES = ['t', 'top', 'توب'];
const EDIT_ALIASES = ['تعديل', 'edit', 'mod'];

const TEXT_XP_MIN = 15;
const TEXT_XP_MAX = 25;
const TEXT_XP_COOLDOWN = 60_000;
const TOP_LIMIT = 10;
const TOP_PANEL_IMAGE_URL =
  'https://cdn.discordapp.com/attachments/1390932617645260872/1391661420558422156/Picsart_25-07-07_09-05-01-827.png?ex=69a3d732&is=69a285b2&hm=fc18c7619be199eef08ad19d733f6f7012952a24aa55a8edff97333d7420d76c';

const TOP_REPLY_TTL = 10_000;
const MANAGED_REPLY_COOLDOWN = 2000;
const MESSAGE_GUARD_TTL = 15_000;

const POINT_TYPE_LABELS = {
  tickets: 'نقاط التذاكر',
  warns: 'نقاط التحذيرات',
  xp: 'نقاط الخبرة'
};
const POINT_TYPE_EMOJIS = {
  tickets: '🎟️',
  warns: '⚠️',
  xp: '✨'
};

const recentCommands = new Map();
const processedCommands = new Map();
const textXpCooldowns = new Map();
const recentWarnActions = new Map();
const replyLocks = new Map();
const messageGuards = new Map();

const sendNoPing = (channel, payload) =>
  channel.send({ allowedMentions: { parse: [] }, ...payload });

function lockMessage(messageId, ttl = MESSAGE_GUARD_TTL) {
  if (messageGuards.has(messageId)) return false;
  const timeout = setTimeout(() => messageGuards.delete(messageId), ttl);
  messageGuards.set(messageId, timeout);
  return true;
}

function isDuplicateCommand(message, ms = 2000) {
  const key = `${message.guild?.id}:${message.author.id}:${message.content.trim().toLowerCase()}`;
  const now = Date.now();
  const last = recentCommands.get(key) || 0;
  if (now - last < ms) return true;
  recentCommands.set(key, now);
  setTimeout(() => recentCommands.delete(key), ms + 500);
  return false;
}

function markProcessed(key, ttl = 3000) {
  if (processedCommands.has(key)) return false;
  const timeout = setTimeout(() => processedCommands.delete(key), ttl);
  processedCommands.set(key, timeout);
  return true;
}

function shouldSendManagedReply(channelId, tag, ttl = MANAGED_REPLY_COOLDOWN) {
  const key = `${channelId}:${tag}`;
  const now = Date.now();
  const last = replyLocks.get(key) || 0;
  if (now - last < ttl) return false;
  replyLocks.set(key, now);
  setTimeout(() => {
    if (replyLocks.get(key) === now) replyLocks.delete(key);
  }, ttl * 2);
  return true;
}

async function sendManagedEmbedOnce(channel, tag, payload, ttl) {
  if (!shouldSendManagedReply(channel.id, tag, ttl ?? MANAGED_REPLY_COOLDOWN)) return;
  await sendNoPing(channel, payload);
}

// === كل البنلز أحمر ===
const redPanel = (text, title = null) => {
  const embed = new EmbedBuilder().setColor(0xff0000).setDescription(`**${text}**`);
  if (title) embed.setTitle(`**${title}**`);
  return embed;
};

const bluePanel = (text, title = null) => {
  const embed = new EmbedBuilder().setColor(0xff0000).setDescription(`**${text}**`);
  if (title) embed.setTitle(`**${title}**`);
  return embed;
};

const greenPanel = (text, title = null) => {
  const embed = new EmbedBuilder().setColor(0xff0000).setDescription(`**${text}**`);
  if (title) embed.setTitle(`**${title}**`);
  return embed;
};

const redConfirmPanel = text =>
  new EmbedBuilder().setColor(0xff0000).setDescription(`**✅ ${text}**`);

const warnDetailEmbed = ({ target, moderator, reason, caseId }) => {
  const modUser = moderator.user ?? moderator;
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('**⚠️ تحذير جديد**')
    .addFields(
      { name: '**المُحذَّر**', value: `**<@${target.id}> (${target.id})**` },
      { name: '**المُصدر**', value: `**<@${modUser.id}> (${modUser.id})**` },
      { name: '**السبب**', value: `**${reason}**` },
      { name: '**الوقت**', value: `**${new Date().toLocaleString('ar-SA')}**` },
      { name: '**رقم الحالة**', value: `**${caseId}**` }
    )
    .setFooter({
      text: `بطلب من ${modUser.tag}`,
      iconURL: modUser.displayAvatarURL?.({ size: 128 })
    });
};

const extractIdFromMention = arg => {
  if (!arg) return null;
  const match = arg.match(/^<@!?(\d+)>$/);
  if (match) return match[1];
  if (/^\d{15,21}$/.test(arg)) return arg;
  return null;
};

const fetchMember = async (guild, arg) => {
  const id = extractIdFromMention(arg);
  if (!id) return null;
  try {
    return await guild.members.fetch(id);
  } catch {
    return null;
  }
};

function isDuplicateWarnAction(guildId, modId, targetId, reason, ms = 5000) {
  const key = `${guildId}:${modId}:${targetId}:${reason.trim().toLowerCase()}`;
  const now = Date.now();
  const last = recentWarnActions.get(key) || 0;
  if (now - last < ms) return true;
  recentWarnActions.set(key, now);
  setTimeout(() => recentWarnActions.delete(key), ms + 500);
  return false;
}

async function addWarningAndNotify(message, member, reason) {
  let doc = await Warning.findOne({ guildId: message.guild.id, userId: member.id });
  if (!doc) {
    doc = new Warning({
      guildId: message.guild.id,
      userId: member.id,
      infractions: [],
      total: 0
    });
  }

  const caseId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
  doc.infractions.push({
    caseId,
    moderatorId: message.author.id,
    reason,
    createdAt: new Date()
  });
  doc.total = (doc.total ?? 0) + 1;
  await doc.save();

  await addPoints({ guildId: message.guild.id, userId: message.author.id, warnings: 1 });
  await tryPromote(message, message.member);

  const detailEmbed = warnDetailEmbed({ target: member, moderator: message.member, reason, caseId });

  if (DM_USER_ON_WARN) {
    try {
      await member.send({ embeds: [detailEmbed] });
    } catch {}
  }

  await sendNoPing(message.channel, { embeds: [redConfirmPanel(`تم تحذير ${member.user.username}`)] });

  if (WARN_LOG_CHANNEL_ID) {
    const logChannel = message.guild.channels.cache.get(WARN_LOG_CHANNEL_ID);
    if (logChannel && logChannel.id !== message.channel.id) {
      try {
        await sendNoPing(logChannel, { embeds: [detailEmbed] });
      } catch {}
    }
  }
}

async function showWarnings(message, member) {
  const doc = await Warning.findOne({ guildId: message.guild.id, userId: member.id });
  if (!doc || (doc.total ?? 0) === 0) {
    await sendNoPing(message.channel, { embeds: [redPanel(`لا توجد تحذيرات لـ <@${member.id}>`)] });
    return;
  }

  const last10 = [...doc.infractions].slice(-10).reverse();
  const lines = last10
    .map(inf => {
      const when = new Date(inf.createdAt).toLocaleString('ar-SA');
      return `**• رقم الحالة: ${inf.caseId}\nالزمان: ${when}\nبواسطة: <@${inf.moderatorId}>\nالسبب: ${inf.reason}**`;
    })
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setAuthor({ name: `**تحذيرات ${member.user.tag}**`, iconURL: member.displayAvatarURL({ size: 128 }) })
    .setDescription(`**${lines}**`)
    .setFooter({
      text: `الإجمالي: ${doc.total} • بطلب من ${message.author.tag}`,
      iconURL: message.author.displayAvatarURL({ size: 128 })
    });

  await sendNoPing(message.channel, { embeds: [embed] });
}

const calculateLevel = xp => Math.floor(0.1 * Math.sqrt(xp));
const startOfDay = value => {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};
const startOfWeek = value => {
  const d = new Date(value);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};
const startOfMonth = value => {
  const d = new Date(value);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

function resetScopes(doc, now) {
  let changed = false;
  const daily = startOfDay(now);
  const weekly = startOfWeek(now);
  const monthly = startOfMonth(now);

  if (!doc.dailyResetAt || doc.dailyResetAt < daily) {
    doc.dailyTextXp = 0;
    doc.dailyVoiceXp = 0;
    doc.dailyResetAt = daily;
    changed = true;
  }
  if (!doc.weeklyResetAt || doc.weeklyResetAt < weekly) {
    doc.weeklyTextXp = 0;
    doc.weeklyVoiceXp = 0;
    doc.weeklyResetAt = weekly;
    changed = true;
  }
  if (!doc.monthlyResetAt || doc.monthlyResetAt < monthly) {
    doc.monthlyTextXp = 0;
    doc.monthlyVoiceXp = 0;
    doc.monthlyResetAt = monthly;
    changed = true;
  }

  return changed;
}

const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function grantTextXp(message) {
  const hasPayload = message.content.trim().length > 0 || message.attachments.size > 0;
  if (!hasPayload) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const last = textXpCooldowns.get(key) || 0;
  if (now - last < TEXT_XP_COOLDOWN) return;
  textXpCooldowns.set(key, now);

  const xpAmount = randomBetween(TEXT_XP_MIN, TEXT_XP_MAX);

  if (message.member?.roles.cache.has(SUPPORT_ROLE_ID)) {
    await addPoints({ guildId: message.guild.id, userId: message.author.id, xp: xpAmount });
    await tryPromote(message, message.member);
  }

  let userXp = await UserXP.findOne({ guildId: message.guild.id, userId: message.author.id });

  if (!userXp) {
    userXp = new UserXP({
      guildId: message.guild.id,
      userId: message.author.id,
      textXp: 0,
      voiceXp: 0,
      totalXp: 0,
      level: 0,
      dailyResetAt: startOfDay(now),
      weeklyResetAt: startOfWeek(now),
      monthlyResetAt: startOfMonth(now),
      dailyTextXp: 0,
      weeklyTextXp: 0,
      monthlyTextXp: 0,
      dailyVoiceXp: 0,
      weeklyVoiceXp: 0,
      monthlyVoiceXp: 0
    });
  }

  resetScopes(userXp, now);

  userXp.textXp = (userXp.textXp || 0) + xpAmount;
  userXp.dailyTextXp = (userXp.dailyTextXp || 0) + xpAmount;
  userXp.weeklyTextXp = (userXp.weeklyTextXp || 0) + xpAmount;
  userXp.monthlyTextXp = (userXp.monthlyTextXp || 0) + xpAmount;

  userXp.voiceXp = userXp.voiceXp || 0;
  userXp.dailyVoiceXp = userXp.dailyVoiceXp || 0;
  userXp.weeklyVoiceXp = userXp.weeklyVoiceXp || 0;
  userXp.monthlyVoiceXp = userXp.monthlyVoiceXp || 0;

  userXp.totalXp = (userXp.textXp || 0) + (userXp.voiceXp || 0);
  userXp.level = calculateLevel(userXp.totalXp);

  await userXp.save();
}

function getTopScopeFromArg(arg) {
  const v = (arg || '').trim().toLowerCase();
  if (!v) return 'all';

  if (['day', 'daily', 'يومي', 'اليومي'].includes(v)) return 'day';
  if (['week', 'weekly', 'اسبوع', 'أسبوع', 'اسبوعي', 'أسبوعي'].includes(v)) return 'week';
  if (['month', 'monthly', 'شهري', 'الشهري'].includes(v)) return 'month';
  if (['all', 'global', 'server', 'عام', 'العام', 'سيرفر', 'كل'].includes(v)) return 'all';

  return null;
}

function getScopedValues(doc, scope, now) {
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const dayValid = doc.dailyResetAt && doc.dailyResetAt >= dayStart;
  const weekValid = doc.weeklyResetAt && doc.weeklyResetAt >= weekStart;
  const monthValid = doc.monthlyResetAt && doc.monthlyResetAt >= monthStart;

  if (scope === 'day') {
    const textXp = dayValid ? doc.dailyTextXp || 0 : 0;
    const voiceXp = dayValid ? doc.dailyVoiceXp || 0 : 0;
    return { textXp, voiceXp, totalXp: textXp + voiceXp };
  }

  if (scope === 'week') {
    const textXp = weekValid ? doc.weeklyTextXp || 0 : 0;
    const voiceXp = weekValid ? doc.weeklyVoiceXp || 0 : 0;
    return { textXp, voiceXp, totalXp: textXp + voiceXp };
  }

  if (scope === 'month') {
    const textXp = monthValid ? doc.monthlyTextXp || 0 : 0;
    const voiceXp = monthValid ? doc.monthlyVoiceXp || 0 : 0;
    return { textXp, voiceXp, totalXp: textXp + voiceXp };
  }

  return {
    textXp: doc.textXp || 0,
    voiceXp: doc.voiceXp || 0,
    totalXp: doc.totalXp || (doc.textXp || 0) + (doc.voiceXp || 0)
  };
}

function scopeLabel(scope) {
  if (scope === 'day') return 'اليومي';
  if (scope === 'week') return 'الأسبوعي';
  if (scope === 'month') return 'الشهري';
  return 'العام';
}

function formatTopField(rows, key) {
  return rows.map(r => `**#${r.rank}** | <@${r.userId}> | **XP: ${r[key]}**`).join('\n') || '**لا توجد بيانات.**';
}

function formatProgress(current, required) {
  if (!required || required <= 0) return '—';
  const pct = Math.min(100, Math.round((current / required) * 100));
  return `**${current}/${required} (${pct}%)**`;
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot) return;
    if (!lockMessage(message.id)) return;

    if (typeof resetIfNeeded === 'function') {
      try {
        await resetIfNeeded(message.guild.id);
      } catch {}
    }

    if (message.content.trim().length > 0 || message.attachments.size > 0) {
      await grantTextXp(message);
    }

    const content = message.content.trim();
    if (!content.length) return;

    const tokens = content.split(/\s+/);
    const command = tokens.shift().toLowerCase();

    const isWarnCommand = WARN_ALIASES.includes(command);
    const isWarningsCommand = WARNINGS_ALIASES.includes(command);
    const isClaimCommand = CLAIM_ALIASES.includes(command);
    const isUnclaimCommand = UNCLAIM_ALIASES.includes(command);
    const isXpCommand = XP_ALIASES.includes(command);
    const isTopCommand = TOP_ALIASES.includes(command);
    const isTasksCommand = ALIASES.TASKS?.includes(command);
    const isStatsCommand = ALIASES.STATS?.includes(command);
    const isConvertCommand = ALIASES.CONVERT?.includes(command);
    const isTransferCommand = ALIASES.TRANSFER?.includes(command);
    const isEditCommand = EDIT_ALIASES.includes(command);

    if (
      !(
        isWarnCommand ||
        isWarningsCommand ||
        isClaimCommand ||
        isUnclaimCommand ||
        isXpCommand ||
        isTopCommand ||
        isTasksCommand ||
        isStatsCommand ||
        isConvertCommand ||
        isTransferCommand ||
        isEditCommand
      )
    ) {
      return;
    }

    if (isDuplicateCommand(message)) return;

    const isTicketChannel = message.channel.name?.startsWith(TICKET_PREFIX);
    const hasSupportRole = message.member.roles.cache.has(SUPPORT_ROLE_ID);

    if (isTasksCommand) {
      const guardKey = `${message.id}:tasks`;
      if (!markProcessed(guardKey)) return;

      if (!hasSupportRole) return;

      await sendNoPing(message.channel, { embeds: [redPanel('**أمر المهام سيتم تفعيله لاحقاً.**')] });
      return;
    }

    if (isStatsCommand) {
      const guardKey = `${message.id}:stats`;
      if (!markProcessed(guardKey)) return;

      if (!hasSupportRole) return;

      const targetArg = tokens.shift();
      let member = message.member;
      
      if (targetArg) {
        const fetchedMember = await fetchMember(message.guild, targetArg);
        if (!fetchedMember) {
          await sendNoPing(message.channel, { embeds: [redPanel('**لم أستطع العثور على العضو.**')] });
          return;
        }
        if (!fetchedMember.roles.cache.has(SUPPORT_ROLE_ID)) {
          await sendNoPing(message.channel, { embeds: [redPanel('**هذا العضو ليس إدارياً.**')] });
          return;
        }
        member = fetchedMember;
      }

      const doc = await getOrCreate(message.guild.id, member.id);
      
      const userXpDoc = await UserXP.findOne({ guildId: message.guild.id, userId: member.id });
      const totalUserXp = userXpDoc ? (userXpDoc.textXp || 0) + (userXpDoc.voiceXp || 0) : 0;
      
      const nextCfg = getNextLevelConfig(doc.level);
      const multiplier = getMultiplier(member);
      const nextReq = nextCfg ? scaledReq(nextCfg.req, multiplier) : null;

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setAuthor({
          name: `**بطاقة الإداري - ${member.user.tag}**`,
          iconURL: member.displayAvatarURL({ size: 256 }) || message.guild.iconURL({ dynamic: true })
        })
        .addFields(
          {
            name: '**🔢 المستوى الحالي**',
            value: `**Level ${doc.level}**${doc.promotedAt ? `\n**آخر ترقية:** <t:${Math.floor(doc.promotedAt.getTime() / 1000)}:R>` : ''}`,
            inline: true
          },
          {
            name: '**🎚️ المضاعف الحالي**',
            value: `**x${multiplier.toFixed(2)}**`,
            inline: true
          },
          {
            name: '**🎟️ نقاطك الحالية**',
            value: `**تذاكر:** ${doc.points.tickets}\n**تحذيرات:** ${doc.points.warns}\n**خبرة:** ${doc.points.xp}`,
            inline: false
          },
          {
            name: '**📊 إجمالي XP (نصي + صوتي)**',
            value: `**${totalUserXp} XP**`,
            inline: false
          },
          {
            name: '**📦 إجمالي مساهماتك**',
            value: `**تذاكر:** ${doc.lifetime.tickets}\n**تحذيرات:** ${doc.lifetime.warns}\n**خبرة:** ${doc.lifetime.xp}`,
            inline: false
          }
        )
        .setFooter({
          text: `**بناءً على طلب ${message.author.tag}**`,
          iconURL: message.author.displayAvatarURL({ size: 128 })
        });

      if (nextReq) {
        embed.addFields({
          name: `**🚀 الترقية القادمة • ${nextCfg?.name || `Level ${doc.level + 1}`}**`,
          value: [
            `**🎟️** ${formatProgress(doc.points.tickets, nextReq.tickets)}`,
            `**⚠️** ${formatProgress(doc.points.warns, nextReq.warns)}`,
            `**✨** ${formatProgress(doc.points.xp, nextReq.xp)}`
          ].join('\n'),
          inline: false
        });
      } else {
        embed.addFields({
          name: '**🚀 الترقية القادمة**',
          value: '**أنت في أعلى مستوى متاح حالياً.**',
          inline: false
        });
      }

      await sendNoPing(message.channel, { embeds: [embed] });
      return;
    }

    if (isConvertCommand) {
      const guardKey = `${message.id}:convert`;
      if (!markProcessed(guardKey)) return;

      if (!hasSupportRole) return;

      const [amountRaw, fromType, toType] = tokens;

      if (!amountRaw || !fromType || !toType) {
        await sendNoPing(message.channel, {
          embeds: [redPanel('**الاستخدام الصحيح:**\n`تبديل <الكمية> <من-نوع> <إلى-نوع>`\n**مثال:** `تبديل 20 تحذير اكسبي`')]
        });
        return;
      }

      const amount = Number(amountRaw);
      if (!Number.isFinite(amount) || amount <= 0) {
        await sendNoPing(message.channel, { embeds: [redPanel('**الكمية يجب أن تكون رقم صالح وأكبر من 0.**')] });
        return;
      }

      const doc = await getOrCreate(message.guild.id, message.author.id);

      try {
        const result = await convertPoints(doc, fromType, amount, toType);
        const embed = greenPanel(
          [
            `**تم التبديل بنجاح!**`,
            `${POINT_TYPE_EMOJIS[result.fromKey] || '•'} **-${result.amountIn} ${POINT_TYPE_LABELS[result.fromKey] || result.fromKey}**`,
            `${POINT_TYPE_EMOJIS[result.toKey] || '•'} **+${result.amountOut} ${POINT_TYPE_LABELS[result.toKey] || result.toKey}**`
          ].join('\n'),
          '**🔄 تبديل النقاط**'
        ).setFooter({
          text: `**${message.author.tag} • ${new Date().toLocaleString('ar-SA', {
            dateStyle: 'medium',
            timeStyle: 'short'
          })}**`,
          iconURL: message.author.displayAvatarURL({ size: 128 })
        });

        await sendNoPing(message.channel, { embeds: [embed] });
      } catch (err) {
        await sendNoPing(message.channel, { embeds: [redPanel(`**${err.message || 'فشل التبديل.'}**`)] });
      }
      return;
    }

    if (isTransferCommand) {
      const guardKey = `${message.id}:transfer`;
      if (!markProcessed(guardKey)) return;

      if (!hasSupportRole) return;

      if (tokens.length < 3) {
        await sendNoPing(message.channel, {
          embeds: [redPanel(
            '**الاستخدام الصحيح:**\n' +
            '`تحويل <نوع> <@عضو> <الكمية>`\n\n' +
            '**أنواع النقاط:**\n' +
            '**• تذاكر:** `تكت`, `تذاكر`, `تكتات`\n' +
            '**• تحذيرات:** `تحذير`, `تحذيرات`, `تحدير`\n' +
            '**• خبرة:** `اكسبي`, `xp`, `خبرة`\n\n' +
            '**أمثلة:**\n' +
            '`تحويل تكت @User 50`\n' +
            '`تحويل تحذير 123456789 30`\n' +
            '`تحويل xp @User 1000`'
          )]
        });
        return;
      }

      const typeArg = tokens[0];
      const targetArg = tokens[1];
      const amountArg = tokens[2];

      const pointType = normalizePointKey(typeArg);
      if (!pointType) {
        await sendNoPing(message.channel, {
          embeds: [redPanel(
            '**نوع النقاط غير معروف.**\n\n' +
            '**الأنواع المتاحة:**\n' +
            '**• تذاكر:** `تكت`, `تذاكر`, `تكتات`\n' +
            '**• تحذيرات:** `تحذير`, `تحذيرات`, `تحدير`\n' +
            '**• خبرة:** `اكسبي`, `xp`, `خبرة`'
          )]
        });
        return;
      }

      const targetMember = await fetchMember(message.guild, targetArg);
      if (!targetMember) {
        await sendNoPing(message.channel, { embeds: [redPanel('**لم أستطع العثور على العضو. استخدم منشن أو آيدي صالح.**')] });
        return;
      }

      if (targetMember.id === message.author.id) {
        await sendNoPing(message.channel, { embeds: [redPanel('**لا يمكنك تحويل نقاط لنفسك. استخدم أمر التبديل بدلاً من ذلك.**')] });
        return;
      }

      if (!targetMember.roles.cache.has(SUPPORT_ROLE_ID)) {
        await sendNoPing(message.channel, { embeds: [redPanel('**لا يمكن التحويل لعضو ليس إدارياً.**')] });
        return;
      }

      const amount = Number(amountArg);
      if (!Number.isFinite(amount) || amount <= 0) {
        await sendNoPing(message.channel, { embeds: [redPanel('**الكمية يجب أن تكون رقم صالح وأكبر من 0.**')] });
        return;
      }

      const fromDoc = await getOrCreate(message.guild.id, message.author.id);
      const toDoc = await getOrCreate(message.guild.id, targetMember.id);

      try {
        const result = await transferPoints(fromDoc, toDoc, typeArg, amount);
        const embed = greenPanel(
          [
            `**تم التحويل بنجاح!**`,
            ``,
            `**من:** <@${message.author.id}>`,
            `**إلى:** <@${targetMember.id}>`,
            `**النوع:** ${POINT_TYPE_LABELS[result.docKey] || result.docKey}`,
            `**الكمية:** ${POINT_TYPE_EMOJIS[result.docKey] || '•'} ${result.amount}`
          ].join('\n'),
          '**📤 تحويل النقاط**'
        ).setFooter({
          text: `**${message.author.tag} • ${new Date().toLocaleString('ar-SA', {
            dateStyle: 'medium',
            timeStyle: 'short'
          })}**`,
          iconURL: message.author.displayAvatarURL({ size: 128 })
        });

        await sendNoPing(message.channel, { embeds: [embed] });
      } catch (err) {
        await sendNoPing(message.channel, { embeds: [redPanel(`**${err.message || 'فشل التحويل.'}**`)] });
      }
      return;
    }

    // === أمر التعديل (استبدال بدل إضافة) ===
    if (isEditCommand) {
      const guardKey = `${message.id}:edit`;
      if (!markProcessed(guardKey)) return;

      if (message.author.id !== '1086312520874217644') {
        return;
      }

      if (tokens.length < 2) {
        await sendNoPing(message.channel, {
          embeds: [redPanel('**الاستخدام:** `تعديل <نوع> <كمية> [@عضو اختياري]`\n**أمثلة:**\n`تعديل تكت 1000` أو `تعديل تحذيرات @user 500`')]
        });
        return;
      }

      const typeArg = tokens[0];
      const amountArg = tokens[1];
      const targetArg = tokens[2];

      const pointType = normalizePointKey(typeArg);
      if (!pointType) {
        await sendNoPing(message.channel, {
          embeds: [redPanel('**نوع غير معروف. استخدم: تكت، تحذيرات، xp، إلخ.**')]
        });
        return;
      }

      const amount = Number(amountArg);
      if (!Number.isFinite(amount) || amount < 0) {
        await sendNoPing(message.channel, { embeds: [redPanel('**الكمية يجب أن تكون رقم صالح (0 أو أكبر).**')] });
        return;
      }

      let targetMember = message.member;
      let targetId = message.author.id;

      if (targetArg) {
        targetMember = await fetchMember(message.guild, targetArg);
        if (!targetMember) {
          await sendNoPing(message.channel, { embeds: [redPanel('**لم أستطع العثور على العضو.**')] });
          return;
        }
        if (!targetMember.roles.cache.has(SUPPORT_ROLE_ID)) {
          await sendNoPing(message.channel, { embeds: [redPanel('**العضو المستهدف ليس إدارياً.**')] });
          return;
        }
        targetId = targetMember.id;
      }

      const doc = await getOrCreate(message.guild.id, targetId);
      const oldValue = doc.points[pointType];

      // === التعديل: تعيين مباشر (استبدال) ===
      await setPoints({
        guildId: message.guild.id,
        userId: targetId,
        [pointType]: amount
      });

      // محاولة ترقية بعد التعديل
      await tryPromote(message, targetMember);

      const changeText = amount > oldValue 
        ? `إضافة **${amount - oldValue}**` 
        : (amount < oldValue 
          ? `خصم **${oldValue - amount}**` 
          : `تعيين على**${amount}**`);

      const embed = greenPanel(
        `**تم ${changeText} ${POINT_TYPE_LABELS[pointType] || pointType} لـ <@${targetId}>!**\n**القيمة السابقة:** ${oldValue} → **القيمة الجديدة:** ${amount}`,
        '**✏️ تعديل الإحصائيات**'
      ).setFooter({
        text: `**${message.author.tag} • ${new Date().toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })}**`,
        iconURL: message.author.displayAvatarURL({ size: 128 })
      });

      await sendNoPing(message.channel, { embeds: [embed] });
      return;
    }

    if (isWarnCommand) {
      const guardKey = `${message.id}:warn`;
      if (!markProcessed(guardKey)) return;

      if (!message.member.permissions.has(MOD_REQUIRED_PERM)) {
        await sendNoPing(message.channel, { embeds: [redPanel('**لا تملك صلاحية تحذير الأعضاء.**')] });
        return;
      }

      const targetArg = tokens.shift();
      if (!targetArg) {
        await sendNoPing(message.channel, { embeds: [redPanel('**الرجاء تحديد العضو:** `warn @user السبب`')] });
        return;
      }

      const targetMember = await fetchMember(message.guild, targetArg);
      if (!targetMember) {
        await sendNoPing(message.channel, { embeds: [redPanel('**لم أستطع العثور على العضو. استخدم منشن أو آيدي صالح.**')] });
        return;
      }

      if (targetMember.user.bot) {
        await sendNoPing(message.channel, { embeds: [redPanel('**لا يمكن تحذير بوت.**')] });
        return;
      }

      if (targetMember.id === message.author.id) {
        await sendNoPing(message.channel, { embeds: [redPanel('**لا يمكنك تحذير نفسك.**')] });
        return;
      }

      if (
        message.guild.ownerId !== message.author.id &&
        message.member.roles.highest.position <= targetMember.roles.highest.position
      ) {
        await sendNoPing(message.channel, {
          embeds: [redPanel('**لا يمكنك تحذير هذا العضو لأن رتبته أعلى أو مساوية لرتبتك.**')]
        });
        return;
      }

      const reason = tokens.join(' ').trim();
      if (!reason) {
        await sendNoPing(message.channel, { embeds: [redPanel('**الرجاء كتابة سبب التحذير.**')] });
        return;
      }

      if (isDuplicateWarnAction(message.guild.id, message.author.id, targetMember.id, reason)) {
        return;
      }

      await addWarningAndNotify(message, targetMember, reason);
      return;
    }

    if (isWarningsCommand) {
      const guardKey = `${message.id}:warnings`;
      if (!markProcessed(guardKey)) return;

      const targetArg = tokens.shift();
      const member = targetArg ? await fetchMember(message.guild, targetArg) : message.member;
      if (!member) {
        await sendNoPing(message.channel, { embeds: [redPanel('**لم أستطع العثور على العضو.**')] });
        return;
      }

      await showWarnings(message, member);
      return;
    }

    if (isClaimCommand) {
      const guardKey = `${message.id}:claim`;
      if (!markProcessed(guardKey, COOLDOWN)) return;

      if (!isTicketChannel) {
        await sendManagedEmbedOnce(message.channel, 'claim-outside', {
          embeds: [redPanel('**هذا الأمر يعمل فقط داخل قنوات التذاكر.**')]
        });
        return;
      }
      if (!hasSupportRole) {
        await sendManagedEmbedOnce(message.channel, 'claim-no-role', {
          embeds: [redPanel('**لا تملك صلاحيات الاستلام.**')]
        });
        return;
      }

      let ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });
      if (ticketClaim) {
        if (ticketClaim.claimedById === message.author.id) {
          await sendManagedEmbedOnce(message.channel, 'claim-self', {
            embeds: [bluePanel('**لقد استلمت هذه التذكرة بالفعل.**')]
          });
        } else {
          await sendManagedEmbedOnce(message.channel, 'claim-other', {
            embeds: [redPanel(`**التذكرة مستلمة حالياً بواسطة <@${ticketClaim.claimedById}>.**`)]
          });
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

      try {
        await addPoints({ guildId: message.guild.id, userId: message.author.id, tickets: 1 });
        await tryPromote(message, message.member);
      } catch (err) {
        console.error('Error adding ticket points:', err);
      }

      try {
        await AdminStats.findOneAndUpdate(
          { guildId: message.guild.id, adminId: message.author.id },
          { $inc: { claimsCount: 1 } },
          { upsert: true }
        );
      } catch (err) {
        console.error('Error updating admin stats:', err);
      }

      await sendManagedEmbedOnce(message.channel, 'claim-success', {
        embeds: [bluePanel(`**✅ <@${message.author.id}> قام باستلام التذكرة.**`)]
      });
      return;
    }

    if (isUnclaimCommand) {
      const guardKey = `${message.id}:unclaim`;
      if (!markProcessed(guardKey, COOLDOWN)) return;

      if (!isTicketChannel) {
        await sendManagedEmbedOnce(message.channel, 'unclaim-outside', {
          embeds: [redPanel('**هذا الأمر يعمل فقط داخل قنوات التذاكر.**')]
        });
        return;
      }
      if (!hasSupportRole) {
        await sendManagedEmbedOnce(message.channel, 'unclaim-no-role', {
          embeds: [redPanel('**لا تملك صلاحيات الإلغاء.**')]
        });
        return;
      }

      const ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });
      if (!ticketClaim) {
        await sendManagedEmbedOnce(message.channel, 'unclaim-empty', {
          embeds: [redPanel('**لا يوجد استلام مرتبط بهذه التذكرة.**')]
        });
        return;
      }
      if (ticketClaim.claimedById !== message.author.id) {
        await sendManagedEmbedOnce(message.channel, 'unclaim-other', {
          embeds: [redPanel(`**لا يمكنك إلغاء استلام شخص آخر (<@${ticketClaim.claimedById}>).**`)]
        });
        return;
      }

      await TicketClaim.deleteOne({ channelId: message.channel.id });
      await sendManagedEmbedOnce(message.channel, 'unclaim-success', {
        embeds: [bluePanel(`**✅ <@${message.author.id}> ألغى استلام التذكرة.**`)]
      });
      return;
    }

    if (isXpCommand) {
      const guardKey = `${message.id}:xp`;
      if (!markProcessed(guardKey)) return;

      const targetArg = tokens.shift();
      const member = targetArg ? await fetchMember(message.guild, targetArg) : message.member;
      if (!member) {
        await sendNoPing(message.channel, { embeds: [redPanel('**لم أستطع العثور على العضو.**')] });
        return;
      }

      const now = Date.now();
      let userXp = await UserXP.findOne({ guildId: message.guild.id, userId: member.id });
      if (!userXp) {
        userXp = new UserXP({
          guildId: message.guild.id,
          userId: member.id,
          textXp: 0,
          voiceXp: 0,
          totalXp: 0,
          level: 0,
          dailyResetAt: startOfDay(now),
          weeklyResetAt: startOfWeek(now),
          monthlyResetAt: startOfMonth(now),
          dailyTextXp: 0,
          weeklyTextXp: 0,
          monthlyTextXp: 0,
          dailyVoiceXp: 0,
          weeklyVoiceXp: 0,
          monthlyVoiceXp: 0
        });
      }

      resetScopes(userXp, now);

      userXp.textXp = userXp.textXp || 0;
      userXp.voiceXp = userXp.voiceXp || 0;
      userXp.dailyTextXp = userXp.dailyTextXp || 0;
      userXp.weeklyTextXp = userXp.weeklyTextXp || 0;
      userXp.monthlyTextXp = userXp.monthlyTextXp || 0;
      userXp.dailyVoiceXp = userXp.dailyVoiceXp || 0;
      userXp.weeklyVoiceXp = userXp.weeklyVoiceXp || 0;
      userXp.monthlyVoiceXp = userXp.monthlyVoiceXp || 0;

      userXp.totalXp = (userXp.textXp || 0) + (userXp.voiceXp || 0);
      userXp.level = calculateLevel(userXp.totalXp);
      await userXp.save();

      const leaderboardDocs = await UserXP.find({ guildId: message.guild.id })
        .sort({ totalXp: -1, userId: 1 })
        .select({ userId: 1, totalXp: 1 });

      const totalRanked = leaderboardDocs.length;
      const rankIndex = leaderboardDocs.findIndex(entry => entry.userId === member.id);
      const rankPosition = rankIndex >= 0 ? rankIndex + 1 : totalRanked + 1;

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setAuthor({
          name: `**لوحة XP - ${message.guild.name}**`,
          iconURL: message.guild.iconURL({ dynamic: true }) || message.client.user.displayAvatarURL()
        })
        .addFields(
          {
            name: '**🏅 مستواك**',
            value: `**Level ${userXp.level} • ${userXp.totalXp} XP**`,
            inline: true
          },
          {
            name: '**📊 ترتيبك**',
            value:
              rankIndex >= 0 && totalRanked > 0
                ? `**#${rankPosition} من ${totalRanked}**`
                : `**خارج الترتيب الحالي**`,
            inline: true
          },
          {
            name: '**📝 خبرة كتابية**',
            value: [
              `**الإجمالي:** ${userXp.textXp} XP`,
              `**اليومي:** ${userXp.dailyTextXp} XP`,
              `**الأسبوعي:** ${userXp.weeklyTextXp} XP`,
              `**الشهري:** ${userXp.monthlyTextXp} XP`
            ].join('\n'),
            inline: false
          },
          {
            name: '**🎙️ خبرة صوتية**',
            value: [
              `**الإجمالي:** ${userXp.voiceXp} XP`,
              `**اليومي:** ${userXp.dailyVoiceXp} XP`,
              `**الأسبوعي:** ${userXp.weeklyVoiceXp} XP`,
              `**الشهري:** ${userXp.monthlyVoiceXp} XP`
            ].join('\n'),
            inline: false
          }
        )
        .setFooter({
          text: `**${message.author.username} • ${new Date().toLocaleString('ar-SA', {
            dateStyle: 'medium',
            timeStyle: 'short'
          })}**`,
          iconURL: message.author.displayAvatarURL({ dynamic: true })
        });

      await sendNoPing(message.channel, { embeds: [embed] });
      return;
    }

    if (isTopCommand) {
      const guardKey = `${message.id}:t`;
      if (!markProcessed(guardKey, 2000)) return;

      const scopeArg = tokens.shift();
      const scope = getTopScopeFromArg(scopeArg);

      if (!scope) {
        await sendNoPing(message.channel, {
          embeds: [
            redPanel('**استخدم:** `top day`, `top week`, `top month`, أو `top all`\n**(أو المكافئ بالعربي).**')
          ]
        });
        return;
      }

      const topReplyTag = `top:${scope}:${message.author.id}`;
      if (!shouldSendManagedReply(message.channel.id, topReplyTag, TOP_REPLY_TTL)) {
        return;
      }

      const now = Date.now();
      const docs = await UserXP.find({ guildId: message.guild.id });

      const dirtyWrites = [];
      const rows = docs.map(doc => {
        if (scope !== 'all' && resetScopes(doc, now)) dirtyWrites.push(doc.save());

        const scoped = getScopedValues(doc, scope, now);
        const totalForLevel = doc.totalXp || (doc.textXp || 0) + (doc.voiceXp || 0);
        return {
          userId: doc.userId,
          textXp: scoped.textXp,
          voiceXp: scoped.voiceXp,
          totalXp: scoped.totalXp,
          level: doc.level ?? calculateLevel(totalForLevel)
        };
      });

      const sortedRows = [...rows].sort((a, b) => b.totalXp - a.totalXp);
      const rankedRows = sortedRows.map((row, index) => ({ ...row, rank: index + 1 }));
      const nonZeroRows = rankedRows.filter(row => row.totalXp > 0);
      const topRows = nonZeroRows.slice(0, TOP_LIMIT);

      if (scope !== 'all' && dirtyWrites.length) {
        Promise.allSettled(dirtyWrites).catch(() => {});
      }

      if (!nonZeroRows.length) {
        await sendNoPing(message.channel, {
          embeds: [redPanel(`**لا توجد بيانات XP ${scopeLabel(scope)}ة حالياً.**`)]
        });
        return;
      }

      const myRow = rankedRows.find(row => row.userId === message.author.id);
      const inTopList = topRows.some(r => r.userId === message.author.id);
      const myRankValue = myRow
        ? inTopList
          ? `**أنت ضمن المتصدرين:** #${myRow.rank} • XP: ${myRow.totalXp} • Lv: ${myRow.level}`
          : `**#${myRow.rank}** | <@${myRow.userId}> | **XP: ${myRow.totalXp}** | **Lv: ${myRow.level}**`
        : '**لا توجد بيانات عن ترتيبك بعد.**';

      const mainList = topRows
        .map(r => `**#${r.rank}** | <@${r.userId}> | **XP: ${r.totalXp}** | **Lv: ${r.level}**`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setAuthor({
          name: `**قائمة متصدرين السيرفر - ${scopeLabel(scope)}**`,
          iconURL: message.guild.iconURL({ dynamic: true, size: 256 }) || message.client.user.displayAvatarURL()
        })
        .setThumbnail(
          message.guild.iconURL({ dynamic: true, size: 512 }) || message.client.user.displayAvatarURL()
        )
        .addFields(
          { name: '**🏆 المتصدرون**', value: mainList || '**لا توجد بيانات.**', inline: false },
          { name: '**📌 ترتيبك الحالي**', value: myRankValue, inline: false },
          { name: '**📝 Top Text XP**', value: formatTopField(topRows, 'textXp'), inline: true },
          { name: '**🎙️ Top Voice XP**', value: formatTopField(topRows, 'voiceXp'), inline: true }
        )
        .setFooter({
          text: `**${message.author.username} • ${new Date().toLocaleString('ar-SA', {
            dateStyle: 'medium',
            timeStyle: 'short'
          })}**`,
          iconURL: message.author.displayAvatarURL({ dynamic: true })
        });

      if (TOP_PANEL_IMAGE_URL && /^https?:\/\//i.test(TOP_PANEL_IMAGE_URL)) {
        embed.setImage(TOP_PANEL_IMAGE_URL);
      }

      await sendNoPing(message.channel, { embeds: [embed] });
      return;
    }
  }
};
