const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const UserXP = require('../models/UserXP');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');
const Warning = require('../models/Warning');
const { resetIfNeeded } = require('../utils/resetHelpers'); // تأكد من وجود هذا الملف

const SUPPORT_ROLE_ID = '1445473101629493383';
const TICKET_PREFIX = 'ticket-';
const COOLDOWN = 60_000; // 60 ثانية

// إعدادات نظام التحذيرات
const WARN_LOG_CHANNEL_ID = '1463931942058852399'; // اتركه '' لتعطيل اللوغ
const DM_USER_ON_WARN = true;
const MOD_REQUIRED_PERM = PermissionsBitField.Flags.ModerateMembers;

const WARN_ALIASES = ['warn', 'تحذير', 'تحدير', 'ت'];
const WARNINGS_ALIASES = ['warnings', 'warns', 'تحذيرات'];

// إعدادات نظام الخبرة (XP)
const XP_PER_MESSAGE_MIN = 10;
const XP_PER_MESSAGE_MAX = 20;
const XP_COOLDOWN_PER_USER = 60_000; // 1 دقيقة
const XP_ALIASES = ['xp', 'نقاط', 'خبرة'];
const TOP_ALIASES = ['top', 'الأعلى', 'المتصدرين']; // تم تعديل الأوامر البديلة

// إعدادات نظام التذاكر
const CLAIM_ALIASES = ['claim', 'استلام', 'انا'];
const UNCLAIM_ALIASES = ['unclaim', 'إلغاء', 'خروج'];

// لمنع معالجة نفس الرسالة مرتين (حارس بسيط)
const processedCommands = new Map(); // key -> expiry timeout id
const userXpCooldowns = new Map(); // userId -> timestamp of last XP gain for text messages

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
    processedCommands.delete(key); // تم التصحيح هنا
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

  // إرسال اللوغ المفصل في قناة اللوغ إن وُجدت وليست نفس القناة الحالية
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

// بنل أحمر عام (للأخطاء والتحذيرات)
function redPanel(text, title = null) {
  const embed = new EmbedBuilder().setColor(0xff0000).setDescription(`**${text}**`);
  if (title) embed.setTitle(title);
  return embed;
}

// بنل أزرق عام (للمعلومات والإشعارات العامة)
function bluePanel(text, title = null) {
  const embed = new EmbedBuilder().setColor(0x0099ff).setDescription(`**${text}**`);
  if (title) embed.setTitle(title);
  return embed;
}

// دالة لحساب المستوى بناءً على الخبرة الكلية النصية (افتراضي)
function calculateLevel(xp) {
  return Math.floor(0.1 * Math.sqrt(xp)); // صيغة بسيطة للمستوى (يمكنك تعديلها)
}

// دالة لحساب الخبرة المطلوبة للمستوى التالي
function xpForNextLevel(level) {
  return 10 * (level + 1) * (level + 1); // معكوس صيغة calculateLevel
}

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (!message.guild || message.author.bot) return;

    // استدعاء وظيفة إعادة التعيين (مثال: مرة واحدة يومياً، أسبوعياً، شهرياً)
    // هذا سيعالج إعادة تعيين الإحصائيات إذا كان الوقت مناسبًا.
    // يجب أن تكون هذه الوظيفة معرفة في '../utils/resetHelpers.js'
    await resetIfNeeded(message.guild.id);

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

    // ======= أوامر التذاكر (Claim/Unclaim) =======
    const isTicketChannel = message.channel.name.startsWith(TICKET_PREFIX);
    const hasSupportRole = message.member.roles.cache.has(SUPPORT_ROLE_ID);

    if (CLAIM_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:claim`;
      if (!markProcessed(guardKey, COOLDOWN)) return; // استخدام COOLDOWN للـ guard

      if (!isTicketChannel) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('هذا الأمر يمكن استخدامه فقط في قنوات التذاكر.')] });
        return;
      }
      if (!hasSupportRole) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا تملك الصلاحيات لاستلام التذاكر.')] });
        return;
      }

      let ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });

      if (ticketClaim) {
        if (ticketClaim.claimedById === message.author.id) {
          clearProcessed(guardKey);
          await message.reply({ embeds: [bluePanel('لقد قمت بالفعل باستلام هذه التذكرة.')] });
          return;
        } else {
          clearProcessed(guardKey);
          await message.reply({ embeds: [redPanel(`تم استلام هذه التذكرة بواسطة <@${ticketClaim.claimedById}> بالفعل.`)] });
          return;
        }
      }

      // إذا لم يتم استلامها، قم بإنشاء مطالبة جديدة
      ticketClaim = new TicketClaim({
        guildId: message.guild.id,
        channelId: message.channel.id,
        claimedById: message.author.id,
        claimedAt: new Date(),
      });
      await ticketClaim.save();

      // تحديث إحصائيات الأدمن
      await AdminStats.findOneAndUpdate(
        { guildId: message.guild.id, adminId: message.author.id },
        { $inc: { claimsCount: 1 } },
        { upsert: true, new: true }
      );

      await message.channel.send({ embeds: [bluePanel(`✅ <@${message.author.id}> لقد قمت باستلام هذه التذكرة بنجاح.`)] });
      return;
    }

    if (UNCLAIM_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:unclaim`;
      if (!markProcessed(guardKey, COOLDOWN)) return;

      if (!isTicketChannel) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('هذا الأمر يمكن استخدامه فقط في قنوات التذاكر.')] });
        return;
      }
      if (!hasSupportRole) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('لا تملك الصلاحيات لإلغاء استلام التذاكر.')] });
        return;
      }

      const ticketClaim = await TicketClaim.findOne({ channelId: message.channel.id });

      if (!ticketClaim) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel('هذه التذكرة لم يتم استلامها من قبل أي شخص.')] });
        return;
      }

      if (ticketClaim.claimedById !== message.author.id) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel(`لا يمكنك إلغاء استلام تذكرة تم استلامها بواسطة <@${ticketClaim.claimedById}>.`)] });
        return;
      }

      // إذا كان هو من استلمها، قم بحذف المطالبة
      await TicketClaim.deleteOne({ channelId: message.channel.id });
      await message.channel.send({ embeds: [bluePanel(`✅ <@${message.author.id}> لقد قمت بإلغاء استلام هذه التذكرة.`)] });
      return;
    }

    // ======= منطق إضافة الخبرة (XP) للرسائل النصية =======
    const now = Date.now();
    const lastXp = userXpCooldowns.get(message.author.id) || 0;

    // تحقق من انتهاء فترة انتظار الخبرة
    if (now - lastXp > XP_COOLDOWN_PER_USER) {
      const xpAmount = Math.floor(Math.random() * (XP_PER_MESSAGE_MAX - XP_PER_MESSAGE_MIN + 1)) + XP_PER_MESSAGE_MIN;

      let userXp = await UserXP.findOne({ guildId: message.guild.id, userId: message.author.id });
      if (!userXp) {
        userXp = new UserXP({
          guildId: message.guild.id,
          userId: message.author.id,
          // تهيئة الحقول الجديدة إذا لم تكن موجودة
          xp: 0, // هذا الحقل القديم، يمكن استخدامه للمستوى فقط
          level: 0,
          totalTextXp: 0,
          totalVoiceXp: 0,
          dailyTextXp: 0,
          dailyVoiceXp: 0,
          weeklyTextXp: 0,
          weeklyVoiceXp: 0,
          monthlyTextXp: 0,
          monthlyVoiceXp: 0,
          lastDailyReset: new Date(),
          lastWeeklyReset: new Date(),
          lastMonthlyReset: new Date(),
        });
      }

      const oldLevel = userXp.level; // المستوى القديم قبل إضافة الخبرة

      // تحديث جميع حقول الخبرة النصية
      userXp.xp += xpAmount; // يمكن الاحتفاظ بهذا الحقل كإجمالي خبرة عامة أو إلغاؤه
      userXp.totalTextXp = (userXp.totalTextXp || 0) + xpAmount;
      userXp.dailyTextXp = (userXp.dailyTextXp || 0) + xpAmount;
      userXp.weeklyTextXp = (userXp.weeklyTextXp || 0) + xpAmount;
      userXp.monthlyTextXp = (userXp.monthlyTextXp || 0) + xpAmount;

      // حساب المستوى بناءً على الخبرة الكلية النصية
      userXp.level = calculateLevel(userXp.totalTextXp);
      await userXp.save();

      userXpCooldowns.set(message.author.id, now); // تحديث وقت آخر كسب للخبرة

      if (userXp.level > oldLevel) {
        await message.channel.send({
          embeds: [bluePanel(`🎉 تهانينا <@${message.author.id}>! لقد وصلت إلى المستوى **${userXp.level}**!`)]
        }).catch(() => {}); // نتجاهل الأخطاء إذا لم نتمكن من إرسال الرسالة
      }
    }


    // ======= أمر عرض الخبرة (XP) لمستخدم معين =======
    if (XP_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:xp`;
      if (!markProcessed(guardKey)) return;

      const parts = message.content.trim().split(/\s+/);
      const targetArg = parts[1];
      const member = (await fetchMember(message.guild, targetArg)) || message.member;

      const userXp = await UserXP.findOne({ guildId: message.guild.id, userId: member.id });

      // يتم عرض فقط إجمالي الخبرة النصية والمستوى هنا
      if (!userXp || (userXp.totalTextXp ?? 0) === 0) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel(`لا يوجد لدى <@${member.id}> أي خبرة كتابية حتى الآن.`)] });
        return;
      }

      const currentLevel = userXp.level;
      const xpToNextLevelVal = xpForNextLevel(currentLevel);
      // حساب الخبرة المتبقية للمستوى التالي بشكل صحيح
      const xpNeededForCurrentLevel = currentLevel === 0 ? 0 : xpForNextLevel(currentLevel - 1);
      const xpInCurrentLevel = userXp.totalTextXp - xpNeededForCurrentLevel;
      const remainingXp = xpToNextLevelVal - xpInCurrentLevel;


      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setAuthor({ name: `خبرة ${member.user.tag}`, iconURL: member.displayAvatarURL({ size: 128 }) })
        .setDescription(
          `**المستوى:** \`${currentLevel}\`\n` +
          `**الخبرة الكلية (كتابية):** \`${userXp.totalTextXp}\`\n` +
          `**الخبرة للمستوى التالي:** \`${remainingXp > 0 ? remainingXp : 0}\` نقطة`
        )
        .setFooter({
          text: `يطلب من ${message.author.tag}`,
          iconURL: message.author.displayAvatarURL({ size: 128 })
        });

      await message.reply({ embeds: [embed] });
      return;
    }

    // ======= أمر المتصدرين (TOP) =======
    if (TOP_ALIASES.includes(tokens[0])) {
      const guardKey = `${message.id}:top`;
      if (!markProcessed(guardKey)) return;

      const parts = message.content.trim().split(/\s+/);
      let timeframe = 'total'; // افتراضي: إجمالي
      let xpType = 'text';    // افتراضي: كتابي

      // معالجة الوسيط الثاني (إذا كان موجوداً)
      if (parts[1]) {
        const arg1 = parts[1].toLowerCase();
        if (['daily', 'يومي'].includes(arg1)) timeframe = 'daily';
        else if (['weekly', 'أسبوعي'].includes(arg1)) timeframe = 'weekly';
        else if (['monthly', 'شهري'].includes(arg1)) timeframe = 'monthly';
        else if (['total', 'إجمالي', 'عام'].includes(arg1)) timeframe = 'total';
        else if (['text', 'كتابي'].includes(arg1)) xpType = 'text'; // لو كانت الكلمة الأولى هي نوع الـ XP
        else if (['voice', 'صوتي'].includes(arg1)) xpType = 'voice';
      }

      // معالجة الوسيط الثالث (إذا كان موجوداً) في حال تم تحديد timeframe أولاً
      if (parts[2]) {
        const arg2 = parts[2].toLowerCase();
        if (['text', 'كتابي'].includes(arg2)) xpType = 'text';
        else if (['voice', 'صوتي'].includes(arg2)) xpType = 'voice';
      }

      // تحديد حقل الخبرة للبحث والترتيب بناءً على timeframe و xpType
      let xpFieldName = `${timeframe}${xpType.charAt(0).toUpperCase() + xpType.slice(1)}Xp`;
      if (timeframe === 'total') { // لحالة 'total' لا نحتاج 'Total' مكررة
         xpFieldName = `total${xpType.charAt(0).toUpperCase() + xpType.slice(1)}Xp`;
      }

      // التأكد من أن الحقل صحيح، وإلا فالرجوع إلى 'totalTextXp' كافتراضي أو الإبلاغ عن خطأ
      const validXpFields = ['totalTextXp', 'totalVoiceXp', 'dailyTextXp', 'dailyVoiceXp', 'weeklyTextXp', 'weeklyVoiceXp', 'monthlyTextXp', 'monthlyVoiceXp'];
      if (!validXpFields.includes(xpFieldName)) {
          // يمكن هنا إعادة تعيين أو إبلاغ المستخدم بوسيط غير صحيح
          xpFieldName = 'totalTextXp'; // العودة للافتراضي
          timeframe = 'total';
          xpType = 'text';
      }


      const topUsers = await UserXP.find({
          guildId: message.guild.id,
          [xpFieldName]: { $gt: 0 } // فقط المستخدمين الذين لديهم خبرة في هذا النوع
        })
        .sort({ [xpFieldName]: -1 }) // ترتيب تنازلي حسب الخبرة المطلوبة
        .limit(10); // أعلى 10 مستخدمين

      if (topUsers.length === 0) {
        clearProcessed(guardKey);
        await message.reply({ embeds: [redPanel(`لا توجد بيانات خبرة ${timeframe === 'total' ? 'إجمالية' : timeframe === 'daily' ? 'يومية' : timeframe === 'weekly' ? 'أسبوعية' : 'شهرية'} ${xpType === 'text' ? 'كتابية' : 'صوتية'} في هذا السيرفر بعد.`)] });
        return;
      }

      const leaderboardText = topUsers.map((userDoc, index) => {
        const xpValue = userDoc[xpFieldName] ?? 0; // استخدام الحقل المحدد
        return `**#${index + 1}** | <@${userDoc.userId}> | XP: ${xpValue}`;
      }).join('\n');

      let titleTimeframe = '';
      if (timeframe === 'daily') titleTimeframe = 'اليومية';
      else if (timeframe === 'weekly') titleTimeframe = 'الأسبوعية';
      else if (timeframe === 'monthly') titleTimeframe = 'الشهرية';
      else titleTimeframe = 'الإجمالية';

      let titleXpType = '';
      if (xpType === 'text') titleXpType = 'الكتابية';
      else if (xpType === 'voice') titleXpType = 'الصوتية';


      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`🏆 قائمة المتصدرين ${titleTimeframe} ${titleXpType} في ${message.guild.name}`)
        .setDescription(leaderboardText)
        .setFooter({
          text: `يطلب من ${message.author.tag}`,
          iconURL: message.author.displayAvatarURL({ size: 128 })
        });

      await message.reply({ embeds: [embed] });
      return;
    }
  }
};
