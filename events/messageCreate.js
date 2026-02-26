const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');
const Warning = require('../models/Warning');
const { resetIfNeeded, initializeXpObject, resetXpScopes } = require('../utils/resetHelpers');

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
const XP_COOLDOWN_PER_USER = 60_000; // Cooldown for each user to gain XP per message
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

// خرائط الحماية (لمنع تنفيذ الأوامر المتعددة بسرعة)
const processedCommands = new Map();
const userXpCooldowns = new Map(); // لتتبع متى آخر مرة كسب المستخدم XP

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

// ---- التحذيرات ----
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

// ---- مساعدات الـ XP (مُحدّثة) ----
const calculateLevel = (xp, isVoice = false) => {
  // يمكن تعديل صيغة المستوى لكل نوع إذا لزم الأمر
  // حالياً، تستخدم نفس الصيغة للجميع
  return Math.floor(0.1 * Math.sqrt(xp));
};
const xpForLevel = (level, isVoice = false) => {
  return 10 * (level ** 2);
};
const xpForNextLevel = (level, isVoice = false) => {
  return xpForLevel(level + 1, isVoice);
};

function detectTopScope(args) {
  const keyword = (args[0] || '').toLowerCase();
  for (const [scope, list] of Object.entries(TOP_SCOPE_KEYWORDS)) {
    if (list.includes(keyword)) return scope;
  }
  return 'all'; // الافتراضي
}

function scopeField(scope) {
  switch (scope) {
    case 'daily': return 'daily';
    case 'weekly': return 'weekly';
    case 'monthly': return 'monthly';
    default: return 'xp'; // 'xp' هو الحقل الكلي
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

    // استدعاء وظيفة إعادة التعيين العامة
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
        // الرد في نفس القناة بدون mention
        await message.channel.send({ embeds: [redPanel('لا تملك صلاحية تحذير الأعضاء.')] });
        return;
      }

      const parts = message.content.trim().split(/\s+/);
      const targetArg = parts[1];
      const targetMember = await fetchMember(message.guild, targetArg);

      if (!targetMember) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel('لم أستطع العثور على العضو. استخدم منشن أو آيدي صالح.')] });
        return;
      }
      if (targetMember.user.bot) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel('لا يمكن تحذير بوت.')] });
        return;
      }
      if (targetMember.id === message.author.id) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel('لا يمكنك تحذير نفسك.')] });
        return;
      }
      if (message.guild.ownerId !== message.author.id &&
          message.member.roles.highest.position <= targetMember.roles.highest.position) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel('لا يمكنك تحذير هذا العضو لأن رتبته أعلى أو مساوية لرتبتك.')] });
        return;
      }

      const reason = parts.slice(2).join(' ').trim();
      if (!reason) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel('الرجاء كتابة سبب التحذير. الاستخدام: `warn @user سبب`')] });
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
        await message.channel.send({ embeds: [redPanel('هذا الأمر يعمل فقط داخل قنوات التذاكر.')] });
        return;
      }
      if (!hasSupportRole) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel('لا تملك صلاحيات الاستلام.')] });
        return;
      }

      let ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });
      if (ticketClaim) {
        clearProcessed(guardKey);
        if (ticketClaim.claimedById === message.author.id) {
          await message.channel.send({ embeds: [bluePanel('لقد استلمت هذه التذكرة بالفعل.')] });
        } else {
          await message.channel.send({ embeds: [redPanel(`التذكرة مستلمة حالياً بواسطة <@${ticketClaim.claimedById}>.`)] });
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
        await message.channel.send({ embeds: [redPanel('هذا الأمر يعمل فقط داخل قنوات التذاكر.')] });
        return;
      }
      if (!hasSupportRole) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel('لا تملك صلاحيات الإلغاء.')] });
        return;
      }

      const ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });
      if (!ticketClaim) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel('لا يوجد استلام مرتبط بهذه التذكرة.')] });
        return;
      }
      if (ticketClaim.claimedById !== message.author.id) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel(`لا يمكنك إلغاء استلام شخص آخر (<@${ticketClaim.claimedById}>).`)] });
        return;
      }

      await TicketClaim.deleteOne({ channelId: message.channel.id });
      await message.channel.send({ embeds: [bluePanel(`✅ <@${message.author.id}> ألغى استلام التذكرة.`)] });
      return;
    }

    // ----- منح الخبرة (الرسائل النصية) -----
    const now = Date.now();
    const lastXp = userXpCooldowns.get(message.author.id) || 0;
    if (now - lastXp >= XP_COOLDOWN_PER_USER) {
      const xpAmount = Math.floor(Math.random() * (XP_PER_MESSAGE_MAX - XP_PER_MESSAGE_MIN + 1)) + XP_PER_MESSAGE_MIN;
      
      let userXp = await UserXP.findOne({ guildId: message.guild.id, userId: message.author.id });
      if (!userXp) {
        // إنشاء سجل جديد بالهياكل الداخلية (text, voice)
        userXp = new UserXP({
          guildId: message.guild.id,
          userId: message.author.id,
          text: { xp: 0, level: 0, daily: 0, weekly: 0, monthly: 0, dailyResetAt: 0, weeklyResetAt: 0, monthlyResetAt: 0 },
          voice: { xp: 0, level: 0, daily: 0, weekly: 0, monthly: 0, dailyResetAt: 0, weeklyResetAt: 0, monthlyResetAt: 0 },
        });
      }

      // التأكد من وجود الكائنات الداخلية وتعيين التواريخ الأولية
      userXp.text = initializeXpObject(userXp.text);
      userXp.voice = initializeXpObject(userXp.voice);
      
      // إعادة تعيين الخبرة اليومية/الأسبوعية/الشهرية قبل إضافة المزيد
      resetXpScopes(userXp, now); 
      
      const oldTextLevel = userXp.text.level;

      // إضافة الخبرة الكتابية
      userXp.text.xp += xpAmount;
      userXp.text.daily += xpAmount;
      userXp.text.weekly += xpAmount;
      userXp.text.monthly += xpAmount;
      userXp.text.level = calculateLevel(userXp.text.xp);

      await userXp.save();
      userXpCooldowns.set(message.author.id, now); // تحديث آخر مرة كسب فيها XP

      // إشعار بالوصول للمستوى الجديد (كتابي)
      if (userXp.text.level > oldTextLevel) {
        await message.channel.send({ embeds: [bluePanel(`🎉 تهانينا <@${message.author.id}>! وصلت إلى المستوى **${userXp.text.level}** (كتابي)`)] }).catch(() => {});
      }
    }

    // ----- أمر XP (عرض خبرة المستخدم) -----
    if (XP_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:xp`;
      if (!markProcessed(guardKey)) return;

      const parts = message.content.trim().split(/\s+/);
      const targetArg = parts[1];
      const member = (await fetchMember(message.guild, targetArg)) || message.member;
      const userXp = await UserXP.findOne({ guildId: message.guild.id, userId: member.id });

      if (!userXp || (userXp.text.xp === 0 && userXp.voice.xp === 0)) {
        clearProcessed(guardKey);
        await message.channel.send({ embeds: [redPanel(`لا يوجد لدى <@${member.id}> أي خبرة حتى الآن.`)] });
        return;
      }

      // التأكد من إعادة تعيين النطاقات الزمنية قبل عرض الخبرة
      resetXpScopes(userXp, now);
      await userXp.save(); // حفظ التغييرات بعد إعادة التعيين

      // الخبرة الكتابية
      const textLevel = userXp.text.level;
      const textXpNeededForNextLevel = xpForNextLevel(textLevel);
      const textRemainingXp = textXpNeededForNextLevel - userXp.text.xp;

      // الخبرة الصوتية
      const voiceLevel = userXp.voice.level;
      const voiceXpNeededForNextLevel = xpForNextLevel(voiceLevel);
      const voiceRemainingXp = voiceXpNeededForNextLevel - userXp.voice.xp;

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setAuthor({ name: `خبرة ${member.user.tag}`, iconURL: member.displayAvatarURL({ size: 128 }) })
        .setDescription(
          `**خبرة كتابية:**\n` +
          `• المستوى: \`${textLevel}\`\n` +
          `• الخبرة الكلية: \`${userXp.text.xp}\`\n` +
          `• خبرة هذا الأسبوع: \`${userXp.text.weekly}\`\n` +
          `• خبرة هذا اليوم: \`${userXp.text.daily}\`\n` +
          `• متبقي للمستوى التالي: \`${textRemainingXp > 0 ? textRemainingXp : 0}\` نقطة\n\n` +
          `**خبرة صوتية:**\n` +
          `• المستوى: \`${voiceLevel}\`\n` +
          `• الخبرة الكلية: \`${userXp.voice.xp}\`\n` +
          `• خبرة هذا الأسبوع: \`${userXp.voice.weekly}\`\n` +
          `• خبرة هذا اليوم: \`${userXp.voice.daily}\`\n` +
          `• متبقي للمستوى التالي: \`${voiceRemainingXp > 0 ? voiceRemainingXp : 0}\` نقطة`
        )
        // إضافة التاريخ واسم المستخدم الذي قام بالاستدعاء
        .setFooter({ text: `بطلب من ${message.author.tag} • ${new Date().toLocaleString('ar-SA')}`, iconURL: message.author.displayAvatarURL({ size: 128 }) });

      // الرد في نفس القناة بدون mention
      await message.channel.send({ embeds: [embed] });
      return;
    }

    // ----- أمر TOP متعدد النطاقات -----
    if (tokens[0] === TOP_BASE_ALIAS || tokens[0] === 'توب' || tokens[0] === 'الأعلى' || tokens[0] === 'قائمة') {
      const guardKey = `${message.id}:top`;
      if (!markProcessed(guardKey, 2000)) return; // Cooldown قصير لأمر TOP

      const args = tokens.slice(1);
      const scope = detectTopScope(args); // مثل 'all', 'daily', 'weekly', 'monthly'
      const label = scopeLabel(scope);    // مثل 'الإجمالي', 'اليومي'

      // --- استعلام عن أفضل 10 في الخبرة الكتابية ---
      const textScopeField = scopeField(scope); // 'xp', 'daily', 'weekly', 'monthly'
      const topTextUsers = await UserXP.find({ guildId: message.guild.id, [`text.${textScopeField}`]: { $gt: 0 } })
        .sort({ [`text.${textScopeField}`]: -1 })
        .limit(10);

      // --- استعلام عن أفضل 10 في الخبرة الصوتية ---
      const voiceScopeField = scopeField(scope); // نفس الحقول
      const topVoiceUsers = await UserXP.find({ guildId: message.guild.id, [`voice.${voiceScopeField}`]: { $gt: 0 } })
        .sort({ [`voice.${voiceScopeField}`]: -1 })
        .limit(10);

      // --- بناء لوحة المتصدرين الكتابية ---
      let textLines = [];
      if (topTextUsers.length > 0) {
        textLines = topTextUsers.map((doc, idx) => {
          const xpValue = doc.text[textScopeField] || 0;
          return `**#${idx + 1}.** <@${doc.userId}> • XP \`${xpValue}\` • مستوى \`${doc.text.level}\``;
        }).join('\n');
      } else {
        textLines = "لا توجد بيانات خبرة كتابية مسجلة.";
      }

      const textEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`🏆 قائمة المتصدرين (كتابي - ${label}) في ${message.guild.name}`)
        .setDescription(textLines)
        .setFooter({ text: `بطلب من ${message.author.tag} • ${new Date().toLocaleString('ar-SA')}`, iconURL: message.author.displayAvatarURL({ size: 128 }) });

      // --- بناء لوحة المتصدرين الصوتية ---
      let voiceLines = [];
      if (topVoiceUsers.length > 0) {
        voiceLines = topVoiceUsers.map((doc, idx) => {
          const xpValue = doc.voice[voiceScopeField] || 0;
          return `**#${idx + 1}.** <@${doc.userId}> • XP \`${xpValue}\` • مستوى \`${doc.voice.level}\``;
        }).join('\n');
      } else {
        voiceLines = "لا توجد بيانات خبرة صوتية مسجلة.";
      }

      const voiceEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`🏆 قائمة المتصدرين (صوتي - ${label}) في ${message.guild.name}`)
        .setDescription(voiceLines)
        .setFooter({ text: `بطلب من ${message.author.tag} • ${new Date().toLocaleString('ar-SA')}`, iconURL: message.author.displayAvatarURL({ size: 128 }) });

      // إرسال الردود في نفس القناة بدون mention
      await message.channel.send({ embeds: [textEmbed] });
      await message.channel.send({ embeds: [voiceEmbed] });
    }
  }
};
