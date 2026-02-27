const { Events, EmbedBuilder, PermissionsBitField } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');
const Warning = require('../models/Warning');
const { resetIfNeeded } = require('../utils/resetHelpers');

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
const TEXT_XP_MIN = 15;
const TEXT_XP_MAX = 25;
const TEXT_XP_COOLDOWN = 60_000;

const TOP_ALIASES = ['t', 'top', 'توب'];
const TOP_LIMIT = 10;
const TOP_PANEL_IMAGE_URL = 'PUT_YOUR_SERVER_LINE_IMAGE_URL_HERE';

const recentCommands = new Map();
const processedCommands = new Map();
const textXpCooldowns = new Map();
const recentWarnActions = new Map();
const ticketReplyLocks = new Map();
const TICKET_REPLY_COOLDOWN = 2000;

const sendNoPing = (channel, payload) =>
  channel.send({ allowedMentions: { parse: [] }, ...payload });

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

function clearProcessed(key) {
  const timeout = processedCommands.get(key);
  if (!timeout) return;
  clearTimeout(timeout);
  processedCommands.delete(key);
}

function shouldSendTicketReply(channelId, tag, ttl = TICKET_REPLY_COOLDOWN) {
  const key = `${channelId}:${tag}`;
  const now = Date.now();
  const last = ticketReplyLocks.get(key) || 0;
  if (now - last < ttl) return false;
  ticketReplyLocks.set(key, now);
  setTimeout(() => {
    if (ticketReplyLocks.get(key) === now) ticketReplyLocks.delete(key);
  }, ttl * 2);
  return true;
}

async function sendTicketEmbedOnce(channel, tag, payload) {
  if (!shouldSendTicketReply(channel.id, tag)) return;
  await sendNoPing(channel, payload);
}

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
  new EmbedBuilder().setColor(0xff0000).setDescription(`**✅ ${text}**`);

const warnDetailEmbed = ({ target, moderator, reason, caseId }) => {
  const modUser = moderator.user ?? moderator;
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('⚠️ **تحذير جديد**')
    .addFields(
      { name: 'المُحذَّر', value: `**<@${target.id}> (${target.id})**` },
      { name: 'المُصدر', value: `**<@${modUser.id}> (${modUser.id})**` },
      { name: 'السبب', value: `**${reason}**` },
      { name: 'الوقت', value: `**${new Date().toLocaleString('ar-SA')}**` },
      { name: 'رقم الحالة', value: `**${caseId}**` }
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
  if (!doc)
    doc = new Warning({ guildId: message.guild.id, userId: member.id, infractions: [], total: 0 });

  const caseId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
  doc.infractions.push({ caseId, moderatorId: message.author.id, reason, createdAt: new Date() });
  doc.total = (doc.total ?? 0) + 1;
  await doc.save();

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
    .setAuthor({ name: `تحذيرات ${member.user.tag}`, iconURL: member.displayAvatarURL({ size: 128 }) })
    .setDescription(lines)
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
  let userXp = await UserXP.findOne({ guildId: message.guild.id, userId: message.author.id });

  if (!userXp) {
    userXp = new UserXP({
      guildId: message.guild.id,
      userId: message.author.id,
      dailyResetAt: startOfDay(now),
      weeklyResetAt: startOfWeek(now),
      monthlyResetAt: startOfMonth(now)
    });
  }

  resetScopes(userXp, now);

  userXp.textXp += xpAmount;
  userXp.dailyTextXp += xpAmount;
  userXp.weeklyTextXp += xpAmount;
  userXp.monthlyTextXp += xpAmount;

  userXp.totalXp = userXp.textXp + userXp.voiceXp;
  userXp.level = calculateLevel(userXp.totalXp);

  await userXp.save();
}

function getTopScopeFromArg(arg) {
  const v = (arg || '').toLowerCase();
  if (['day', 'daily', 'يومي', 'اليومي'].includes(v)) return 'day';
  if (['week', 'weekly', 'اسبوع', 'أسبوع', 'اسبوعي', 'أسبوعي'].includes(v)) return 'week';
  if (['month', 'monthly', 'شهري', 'الشهري'].includes(v)) return 'month';
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

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot) return;

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

    if (
      !(
        isWarnCommand ||
        isWarningsCommand ||
        isClaimCommand ||
        isUnclaimCommand ||
        isXpCommand ||
        isTopCommand
      )
    ) {
      return;
    }

    if (isDuplicateCommand(message)) return;

    const isTicketChannel = message.channel.name?.startsWith(TICKET_PREFIX);
    const hasSupportRole = message.member.roles.cache.has(SUPPORT_ROLE_ID);

    if (isWarnCommand) {
      const guardKey = `${message.id}:warn`;
      if (!markProcessed(guardKey)) return;

      if (!message.member.permissions.has(MOD_REQUIRED_PERM)) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, { embeds: [redPanel('لا تملك صلاحية تحذير الأعضاء.')] });
        return;
      }

      const targetArg = tokens.shift();
      if (!targetArg) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, { embeds: [redPanel('الرجاء تحديد العضو: `warn @user السبب`')] });
        return;
      }

      const targetMember = await fetchMember(message.guild, targetArg);
      if (!targetMember) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, { embeds: [redPanel('لم أستطع العثور على العضو. استخدم منشن أو آيدي صالح.')] });
        return;
      }

      if (targetMember.user.bot) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, { embeds: [redPanel('لا يمكن تحذير بوت.')] });
        return;
      }

      if (targetMember.id === message.author.id) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, { embeds: [redPanel('لا يمكنك تحذير نفسك.')] });
        return;
      }

      if (
        message.guild.ownerId !== message.author.id &&
        message.member.roles.highest.position <= targetMember.roles.highest.position
      ) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, {
          embeds: [redPanel('لا يمكنك تحذير هذا العضو لأن رتبته أعلى أو مساوية لرتبتك.')]
        });
        return;
      }

      const reason = tokens.join(' ').trim();
      if (!reason) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, { embeds: [redPanel('الرجاء كتابة سبب التحذير.')] });
        return;
      }

      if (isDuplicateWarnAction(message.guild.id, message.author.id, targetMember.id, reason)) {
        clearProcessed(guardKey);
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
        clearProcessed(guardKey);
        await sendNoPing(message.channel, { embeds: [redPanel('لم أستطع العثور على العضو.')] });
        return;
      }

      await showWarnings(message, member);
      return;
    }

    if (isClaimCommand) {
      const guardKey = `${message.id}:claim`;
      if (!markProcessed(guardKey, COOLDOWN)) return;

      if (!isTicketChannel) {
        clearProcessed(guardKey);
        await sendTicketEmbedOnce(message.channel, 'claim-outside', {
          embeds: [redPanel('هذا الأمر يعمل فقط داخل قنوات التذاكر.')]
        });
        return;
      }
      if (!hasSupportRole) {
        clearProcessed(guardKey);
        await sendTicketEmbedOnce(message.channel, 'claim-no-role', {
          embeds: [redPanel('لا تملك صلاحيات الاستلام.')]
        });
        return;
      }

      let ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });
      if (ticketClaim) {
        clearProcessed(guardKey);
        if (ticketClaim.claimedById === message.author.id) {
          await sendTicketEmbedOnce(message.channel, 'claim-self', {
            embeds: [bluePanel('لقد استلمت هذه التذكرة بالفعل.')]
          });
        } else {
          await sendTicketEmbedOnce(message.channel, 'claim-other', {
            embeds: [redPanel(`التذكرة مستلمة حالياً بواسطة <@${ticketClaim.claimedById}>.`)]
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

      await AdminStats.findOneAndUpdate(
        { guildId: message.guild.id, adminId: message.author.id },
        { $inc: { claimsCount: 1 } },
        { upsert: true }
      );

      await sendTicketEmbedOnce(message.channel, 'claim-success', {
        embeds: [bluePanel(`✅ <@${message.author.id}> قام باستلام التذكرة.`)]
      });
      return;
    }

    if (isUnclaimCommand) {
      const guardKey = `${message.id}:unclaim`;
      if (!markProcessed(guardKey, COOLDOWN)) return;

      if (!isTicketChannel) {
        clearProcessed(guardKey);
        await sendTicketEmbedOnce(message.channel, 'unclaim-outside', {
          embeds: [redPanel('هذا الأمر يعمل فقط داخل قنوات التذاكر.')]
        });
        return;
      }
      if (!hasSupportRole) {
        clearProcessed(guardKey);
        await sendTicketEmbedOnce(message.channel, 'unclaim-no-role', {
          embeds: [redPanel('لا تملك صلاحيات الإلغاء.')]
        });
        return;
      }

      const ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });
      if (!ticketClaim) {
        clearProcessed(guardKey);
        await sendTicketEmbedOnce(message.channel, 'unclaim-empty', {
          embeds: [redPanel('لا يوجد استلام مرتبط بهذه التذكرة.')]
        });
        return;
      }
      if (ticketClaim.claimedById !== message.author.id) {
        clearProcessed(guardKey);
        await sendTicketEmbedOnce(message.channel, 'unclaim-other', {
          embeds: [redPanel(`لا يمكنك إلغاء استلام شخص آخر (<@${ticketClaim.claimedById}>).`)]
        });
        return;
      }

      await TicketClaim.deleteOne({ channelId: message.channel.id });
      await sendTicketEmbedOnce(message.channel, 'unclaim-success', {
        embeds: [bluePanel(`✅ <@${message.author.id}> ألغى استلام التذكرة.`)]
      });
      return;
    }

    if (isXpCommand) {
      const guardKey = `${message.id}:xp`;
      if (!markProcessed(guardKey)) return;

      const targetArg = tokens.shift();
      const member = targetArg ? await fetchMember(message.guild, targetArg) : message.member;
      if (!member) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, { embeds: [redPanel('لم أستطع العثور على العضو.')] });
        return;
      }

      const now = Date.now();
      let userXp = await UserXP.findOne({ guildId: message.guild.id, userId: member.id });
      if (!userXp) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, { embeds: [redPanel(`لا توجد بيانات لهذا العضو بعد.`)] });
        return;
      }

      resetScopes(userXp, now);
      await userXp.save();

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setAuthor({
          name: `قائمة XP - ${message.guild.name}`,
          iconURL: message.guild.iconURL({ dynamic: true }) || message.client.user.displayAvatarURL()
        })
        .setDescription(`**رتبتك ومعلوماتك:**\n**<@${member.id}> | XP: ${userXp.totalXp} | Level: ${userXp.level}**`)
        .addFields(
          {
            name: '📝 **خبرة كتابية**',
            value: [
              `**إجمالي: ${userXp.textXp} XP**`,
              `**يومي: ${userXp.dailyTextXp} XP**`,
              `**أسبوعي: ${userXp.weeklyTextXp} XP**`,
              `**شهري: ${userXp.monthlyTextXp} XP**`
            ].join('\n'),
            inline: true
          },
          {
            name: '🎙️ **خبرة فويس**',
            value: [
              `**إجمالي: ${userXp.voiceXp} XP**`,
              `**يومي: ${userXp.dailyVoiceXp} XP**`,
              `**أسبوعي: ${userXp.weeklyVoiceXp} XP**`,
              `**شهري: ${userXp.monthlyVoiceXp} XP**`
            ].join('\n'),
            inline: true
          }
        )
        .setFooter({
          text: `${message.author.username} • ${new Date().toLocaleString('ar-SA', {
            dateStyle: 'medium',
            timeStyle: 'short'
          })}`,
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
        clearProcessed(guardKey);
        await sendNoPing(message.channel, {
          embeds: [
            redPanel(
              `استخدام الأمر:\n\`top day\` أو \`top week\` أو \`top month\`\n` +
                `(يمكنك استعمال الكلمات العربية مثل "top يومي" أيضاً)`
            )
          ]
        });
        return;
      }

      const now = Date.now();
      const docs = await UserXP.find({ guildId: message.guild.id });

      const dirtyWrites = [];
      const scopedRows = docs
        .map(doc => {
          if (resetScopes(doc, now)) dirtyWrites.push(doc.save());
          const scoped = getScopedValues(doc, scope, now);
          const totalForLevel = doc.totalXp || (doc.textXp || 0) + (doc.voiceXp || 0);
          return {
            userId: doc.userId,
            textXp: scoped.textXp,
            voiceXp: scoped.voiceXp,
            totalXp: scoped.totalXp,
            level: doc.level ?? calculateLevel(totalForLevel)
          };
        })
        .filter(r => r.totalXp > 0);

      if (dirtyWrites.length) {
        Promise.allSettled(dirtyWrites).catch(() => {});
      }

      if (!scopedRows.length) {
        clearProcessed(guardKey);
        await sendNoPing(message.channel, {
          embeds: [redPanel(`لا توجد بيانات XP ${scopeLabel(scope)}ة حالياً.`)]
        });
        return;
      }

      scopedRows.sort((a, b) => b.totalXp - a.totalXp);
      const withRank = scopedRows.map((r, i) => ({ ...r, rank: i + 1 }));
      const topRows = withRank.slice(0, TOP_LIMIT);

      const myRow = withRank.find(r => r.userId === message.author.id);
      const myRankText = myRow
        ? `**رتبتك: #${myRow.rank} | <@${myRow.userId}> | XP: ${myRow.totalXp} | Level: ${myRow.level}**`
        : `**رتبتك: خارج قائمة المتصدرين حالياً**`;

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setAuthor({
          name: `قائمة متصدرين السيرفر - ${scopeLabel(scope)}`,
          iconURL: message.guild.iconURL({ dynamic: true, size: 256 }) || message.client.user.displayAvatarURL()
        })
        .setThumbnail(
          message.guild.iconURL({ dynamic: true, size: 512 }) || message.client.user.displayAvatarURL()
        )
        .setDescription(
          [
            `**Top ${scopeLabel(scope)}**`,
            '',
            ...topRows.map(
              r => `**#${r.rank}** | <@${r.userId}> | **XP: ${r.totalXp}** | **Lv: ${r.level}**`
            ),
            '',
            myRankText
          ].join('\n')
        )
        .addFields(
          { name: '📝 **Top Text XP**', value: formatTopField(topRows, 'textXp'), inline: true },
          { name: '🎙️ **Top Voice XP**', value: formatTopField(topRows, 'voiceXp'), inline: true }
        )
        .setFooter({
          text: `${message.author.username} • ${new Date().toLocaleString('ar-SA', {
            dateStyle: 'medium',
            timeStyle: 'short'
          })}`,
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
