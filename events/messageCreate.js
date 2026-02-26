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
const WARN_LOG_CHANNEL_ID = '1463931942058852399'; // اتركه '' لتعطيل اللوغ
const DM_USER_ON_WARN = true;
const MOD_REQUIRED_PERM = PermissionsBitField.Flags.ModerateMembers;

const WARN_ALIASES = ['warn', 'تحذير', 'تحدير', 'ت'];
const WARNINGS_ALIASES = ['warnings', 'warns', 'تحذيرات'];

// لمنع معالجة نفس الرسالة مرتين (حارس بسيط)
const processedCommands = new Map(); // key -> expiry timeout id

function markProcessed(key, ttl = 3000) {
  if (processedCommands.has(key)) return false;
  const timeout = setTimeout(() => processedCommands.delete(key), ttl);
  processedCommands.set(key, timeout);
  return true;
}

function clearProcessed(key) {
  const t = processedCommands.get(key);
  if (t) {
    clearTimeout(t);
    processedCommands.delete(key);
  }
}

// بنل أحمر مبسط للتأكيد
function redConfirmPanel(text) {
  return new EmbedBuilder()
    .setColor(0xff0000) // أحمر دائم
    .setDescription(`✅ ${text}`);
}

// بنل تحذير مفصل (لـ DM أو للوغ)
function warnDetailEmbed({ guild, target, moderator, reason, caseId }) {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('⚠️ تحذير جديد')
    .addFields(
      { name: 'المُحذَّر', value: `<@${target.id}> (${target.id})`, inline: false },
      { name: 'المُصدر', value: `<@${moderator.id}> (${moderator.id})`, inline: false },
      { name: 'السبب', value: reason, inline: false },
      { name: 'الوقت', value: new Date().toLocaleString('ar-SA'), inline: false },
      { name: 'رقم الحالة', value: caseId, inline: false }
    )
    .setFooter({
      text: `بطلب من ${moderator.user ? moderator.user.tag : moderator.tag}`,
      iconURL: (moderator.user ?? moderator).displayAvatarURL?.({ size: 128 })
    });
}

// استخراج الآيدي من منشن أو آيدي نصي
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

// إضافة التحذير + إرسال الإشعارات
async function addWarningAndNotify(message, member, reason) {
  // أنشئ/حدّث السجل
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

  // DM للمستخدم (التفصيلي)
  if (DM_USER_ON_WARN) {
    try {
      await member.send({
        embeds: [
          warnDetailEmbed({
            guild: message.guild,
            target: member,
            moderator: message.member,
            reason,
            caseId
          })
        ]
      });
    } catch (err) {
      // لو الخاص مقفول نتجاهل الخطأ (لكن لا نرسل رسالة خطأ للعامة)
      // console.log('DM failed for', member.id);
    }
  }

  // إرسال تأكيد بسيط في القناة الحالية (بنل أحمر صغير مع علامة ✓)
  await message.channel.send({ embeds: [redConfirmPanel(`تم تحذير ${member.user.username}`)] });

  // إرسال اللوق المفصل في قناة اللوق إن وُجدت وليست نفس القناة الحالية
  if (WARN_LOG_CHANNEL_ID) {
    const logCh = message.guild.channels.cache.get(WARN_LOG_CHANNEL_ID);
    if (logCh && logCh.id !== message.channel.id) {
      try {
        await logCh.send({
          embeds: [
            warnDetailEmbed({
              guild: message.guild,
              target: member,
              moderator: message.member,
              reason,
              caseId
            })
          ]
        });
      } catch (err) {
        // لا نكسر التنفيذ لو فشل إرسال اللوغ
      }
    }
  }
}

// عرض التحذيرات
async function showWarnings(message, member) {
  const doc = await Warning.findOne({ guildId: message.guild.id, userId: member.id });
  if (!doc || (doc.total ?? 0) === 0) {
    await message.reply({ embeds: [redPanel(`لا توجد تحذيرات لـ <@${member.id}>`)] });
    return;
  }

  const last10 = [...doc.infractions].slice(-10).reverse();
  const lines = last10.map((inf, idx) => {
    const when = new Date(inf.createdAt).toLocaleString('ar-SA');
    return `• رقم الحالة: ${inf.caseId}\nالزمان: ${when}\nبواسطة: <@${inf.moderatorId}>\nالسبب: ${inf.reason}`;
  }).join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setAuthor({ name: `تحذيرات ${member.user.tag}`, iconURL: member.displayAvatarURL({ size: 128 }) })
    .setDescription(lines)
    .setFooter({
      text: `الإجمالي: ${doc.total} • يطلب من ${message.author.tag}`,
      iconURL: message.author.displayAvatarURL({ size: 128 })
    });

  await message.reply({ embeds: [embed] });
}

// بنل أحمر عام
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

    // ======= أوامر التحذير =======
    if (WARN_ALIASES.includes(tokens[0])) {
      // تجنب معالجة نفس الرسالة مرتين (حارس ضد تسجيل الحدث مرتين)
      const guardKey = `${message.id}:warn`;
      if (!markProcessed(guardKey)) return;

      // صلاحية المودير
      if (!message.member.permissions.has(MOD_REQUIRED_PERM)) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا تملك صلاحية تحذير الأعضاء.')] });
        return;
      }

      // جلب منشن/آيدي من النص الأصلي (حتى نحافظ على البنية)
      const parts = message.content.trim().split(/\s+/);
      const targetArg = parts[1];
      const targetMember = await fetchMember(message.guild, targetArg);

      if (!targetMember) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لم أستطع العثور على العضو. استخدم منشن أو آيدي صالح.')] });
        return;
      }

      // لا تسمح بتحذير البوت أو النفس
      if (targetMember.user.bot) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا يمكن تحذير بوت.') ]});
        return;
      }
      if (targetMember.id === message.author.id) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا يمكنك تحذير نفسك.')] });
        return;
      }

      // تحقق رتبي — لا تسمح بتحذير من له رتبة أعلى أو مالك السيرفر
      if (message.guild.ownerId !== message.author.id) {
        if (message.member.roles.highest.position <= targetMember.roles.highest.position) {
          clearProcessed(guardKey);
          await message.reply({ embeds: [redPanel('لا يمكنك تحذير هذا العضو لأن رتبته أعلى أو مساوية لرتبتك.')] });
          return;
        }
      }

      // اجلب السبب؛ الآن لن نسمح بخانة سبب فارغة
      const reason = parts.slice(2).join(' ').trim();
      if (!reason) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('الرجاء كتابة سبب التحذير. الاستخدام: `warn @user سبب`')] });
        return;
      }

      // كل شيء تمام — أضف التحذير وأخبر
      await addWarningAndNotify(message, targetMember, reason);
      // نترك الـ guard ينتهي بالزمن المحدد
      return;
    }

    // ===== عرض التحذيرات =====
    if (WARNINGS_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:warnings`;
      if (!markProcessed(guardKey)) return;

      const parts = message.content.trim().split(/\s+/);
      const targetArg = parts[1];
      const member = (await fetchMember(message.guild, targetArg)) || message.member;
      await showWarnings(message, member);
      return;
    }

    // ... باقي كودك (top, xp, tickets) كما كان ...
  }
};
