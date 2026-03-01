// utils/adminProgressService.js
const { EmbedBuilder } = require('discord.js');
const AdminProgress = require('../models/AdminProgress');
const { LEVEL_CONFIGS, ALIASES, POINT_TYPE_ALIASES } = require('../config/adminProgressConfig');

// دالة للحصول على أو إنشاء سجل الإداري
async function getOrCreate(guildId, adminId) {
  let doc = await AdminProgress.findOne({ guildId, adminId });
  if (!doc) {
    doc = new AdminProgress({ guildId, adminId });
    await doc.save();
  }
  return doc;
}

// إضافة نقاط (نفس أسلوبك السابق: إضافة فوق الموجود)
async function addPoints({ guildId, userId, xp = 0, tickets = 0, warns = 0, warnings = 0 }) {
  const doc = await getOrCreate(guildId, userId);

  const warnsAmount = warns || warnings || 0;

  if (xp) {
    doc.points.xp = (doc.points.xp || 0) + xp;
    doc.lifetime.xp = (doc.lifetime.xp || 0) + xp;
  }
  if (tickets) {
    doc.points.tickets = (doc.points.tickets || 0) + tickets;
    doc.lifetime.tickets = (doc.lifetime.tickets || 0) + tickets;
  }
  if (warnsAmount) {
    doc.points.warns = (doc.points.warns || 0) + warnsAmount;
    doc.lifetime.warns = (doc.lifetime.warns || 0) + warnsAmount;
  }

  await doc.save();
  return doc;
}

// الحصول على المضاعف بناءً على الرتب (لو حبيت تعدل لاحقاً)
function getMultiplier(member) {
  // تقدر تخلي فيه نظام رتب يعطوا مضاعفات؛ حالياً 1 ثابت
  return 1.0;
}

// الحصول على config المستوى التالي من LEVEL_CONFIGS
function getNextLevelConfig(currentLevel) {
  if (!Array.isArray(LEVEL_CONFIGS)) return null;
  return LEVEL_CONFIGS.find(cfg => cfg.level === currentLevel + 1) || null;
}

// حساب المتطلبات بعد تطبيق المضاعف
function scaledReq(req, multiplier) {
  if (!req) return null;
  return {
    tickets: Math.ceil((req.tickets || 0) * multiplier),
    warns: Math.ceil((req.warns || 0) * multiplier),
    xp: Math.ceil((req.xp || 0) * multiplier)
  };
}

// تطبيع نوع النقاط من alias إلى key داخلي
function normalizePointKey(key) {
  if (!key) return null;
  const lower = String(key).toLowerCase();

  if (POINT_TYPE_ALIASES) {
    for (const [type, aliases] of Object.entries(POINT_TYPE_ALIASES)) {
      if (aliases.map(a => a.toLowerCase()).includes(lower)) return type;
    }
  }

  // fallback بسيط
  if (['tickets', 'ticket', 'تكت', 'تذاكر', 'تكتات'].includes(lower)) return 'tickets';
  if (['warns', 'warnings', 'تحذير', 'تحذيرات', 'تحدير'].includes(lower)) return 'warns';
  if (['xp', 'خبرة', 'اكسبي'].includes(lower)) return 'xp';

  return null;
}

// تبديل النقاط بين نوعين لنفس الشخص
// ملاحظة: lifetime لا يتغير؛ لأنه إجمالي الإنجاز
async function convertPoints(doc, fromType, amount, toType) {
  const fromKey = normalizePointKey(fromType);
  const toKey = normalizePointKey(toType);

  if (!fromKey || !toKey) {
    throw new Error('نوع النقاط غير معروف.');
  }
  if (fromKey === toKey) {
    throw new Error('لا يمكن التبديل لنفس نوع النقاط.');
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('الكمية يجب أن تكون رقم صالح وأكبر من 0.');
  }

  doc.points[fromKey] = doc.points[fromKey] || 0;
  doc.points[toKey] = doc.points[toKey] || 0;

  if (doc.points[fromKey] < amt) {
    throw new Error('لا تملك نقاط كافية للتبديل.');
  }

  // ratio 1:1
  doc.points[fromKey] -= amt;
  doc.points[toKey] += amt;

  // lifetime لا نعبث به
  await doc.save();

  return { fromKey, toKey, amountIn: amt, amountOut: amt };
}

// تحويل نقاط بين إداريين
async function transferPoints(fromDoc, toDoc, typeArg, amount) {
  const key = normalizePointKey(typeArg);
  if (!key) throw new Error('نوع النقاط غير صالح.');

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('الكمية يجب أن تكون رقم صالح وأكبر من 0.');
  }

  fromDoc.points[key] = fromDoc.points[key] || 0;
  toDoc.points[key] = toDoc.points[key] || 0;

  if (fromDoc.points[key] < amt) {
    throw new Error('لا تملك نقاط كافية للتحويل.');
  }

  fromDoc.points[key] -= amt;
  toDoc.points[key] += amt;

  // lifetime لا يتغير في التحويل
  await fromDoc.save();
  await toDoc.save();

  return { docKey: key, amount: amt };
}

// محاولة ترقية الإداري وإرسال البنل الأحمر في الشات المحدد
async function tryPromote(interactionOrMessage, member) {
  if (!member) return;

  const guild = member.guild;
  if (!guild) return;

  const guildId = guild.id;
  const adminId = member.id;

  const doc = await getOrCreate(guildId, adminId);
  const multiplier = getMultiplier(member);
  const nextCfg = getNextLevelConfig(doc.level);

  if (!nextCfg) return; // لا يوجد مستوى بعده

  const nextReq = scaledReq(nextCfg.req, multiplier);
  if (!nextReq) return;

  // تحقق المتطلبات
  const canPromote =
    (doc.points.tickets || 0) >= (nextReq.tickets || 0) &&
    (doc.points.warns || 0) >= (nextReq.warns || 0) &&
    (doc.points.xp || 0) >= (nextReq.xp || 0);

  if (!canPromote) return;

  // جلب config المستوى الحالي (قبل الترقية) لمعرفة الرتب القديمة
  const previousCfg =
    doc.level > 0
      ? LEVEL_CONFIGS.find(cfg => cfg.level === doc.level) || { roles: [] }
      : { roles: [] };

  const oldRoles = Array.isArray(previousCfg.roles) ? previousCfg.roles : [];

  // تنفيذ الترقية
  doc.level += 1;
  doc.promotedAt = new Date();
  await doc.save();

  // IDs لرُتب يتم إزالتها كـ "رتب مشالة/تحذير" لو تحب تضيفهم هنا
  const WARNING_ROLE_IDS = [
    // 'ID_رتبة_تحذير_1',
    // 'ID_رتبة_تحذير_2'
  ];

  // إزالة الرتب القديمة + رتب التحذير
  const rolesToRemove = [...new Set([...oldRoles, ...WARNING_ROLE_IDS])];

  for (const roleId of rolesToRemove) {
    try {
      const role = guild.roles.cache.get(roleId);
      if (role && member.roles.cache.has(roleId)) {
        await member.roles.remove(role);
      }
    } catch (err) {
      console.error('Error removing role in promotion:', err);
    }
  }

  // إضافة الرتب الجديدة
  const newRoles = Array.isArray(nextCfg.roles) ? nextCfg.roles : [];
  for (const roleId of newRoles) {
    try {
      const role = guild.roles.cache.get(roleId);
      if (role && !member.roles.cache.has(roleId)) {
        await member.roles.add(role);
      }
    } catch (err) {
      console.error('Error adding role in promotion:', err);
    }
  }

  // الفرق بين القديمة والجديدة (الرتب المشالة من ناحية الأنظمة)
  const removedRolesForPanel = oldRoles.filter(r => !newRoles.includes(r));

  // تجهيز البنل الأحمر
  const SUPPORT_ROLE_ID = '1445473101629493383';
  const ANNOUNCE_CHANNEL_ID = '1463932101496799252';
  const announceChannel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);

  const gotRolesText =
    newRoles.length > 0
      ? newRoles.map(id => `<@&${id}>`).join(', ')
      : 'لا يوجد';

  const oldRolesText =
    oldRoles.length > 0
      ? oldRoles.map(id => `<@&${id}>`).join(', ')
      : 'لا يوجد';

  const removedRolesText =
    removedRolesForPanel.length > 0 || WARNING_ROLE_IDS.length > 0
      ? [...new Set([...removedRolesForPanel, ...WARNING_ROLE_IDS])]
          .map(id => `<@&${id}>`)
          .join(', ')
      : 'لا يوجد';

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('🚀 **ترقية إداري جديدة**')
    .setDescription(
      [
        `**<@&${SUPPORT_ROLE_ID}>**`,
        '',
        `**تمت ترقية الإداري <@${adminId}> (${member.user.tag})**`,
        '',
        `**الرتب التي ترقّى لها:**`,
        `${gotRolesText}`,
        '',
        `**الرتب التي قبلها:**`,
        `${oldRolesText}`,
        '',
        `**الرتب التي نُشلت (تحذيرات/أنظمة/إلخ):**`,
        `${removedRolesText}`
      ].join('\n')
    )
    .setImage(
      'https://cdn.discordapp.com/attachments/1390932617645260872/1391661420558422156/Picsart_25-07-07_09-05-01-827.png?ex=69a528b2&is=69a3d732&hm=1afa0cca211ad776f4f300106b39daa4f94427cc3c093f352a14f725d26c35bf'
    )
    .setFooter({
      text: `ترقية ${member.user.tag} إلى ${nextCfg.name || `Level ${doc.level}`}`,
      iconURL: member.displayAvatarURL({ size: 128 })
    });

  if (announceChannel) {
    try {
      await announceChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error('Error sending promotion announcement:', err);
    }
  }

  // رد بسيط للشخص نفسه في مكان الأمر/الزر (لو أمكن)
  try {
    if (interactionOrMessage && typeof interactionOrMessage.reply === 'function') {
      await interactionOrMessage.reply({
        content: `🎉 تم ترقيتك إلى **${nextCfg.name || `Level ${doc.level}`}**!`,
        allowedMentions: { repliedUser: true }
      });
    }
  } catch (err) {
    console.error('Error replying promotion message:', err);
  }
}

module.exports = {
  getOrCreate,
  addPoints,
  tryPromote,
  getMultiplier,
  getNextLevelConfig,
  scaledReq,
  normalizePointKey,
  convertPoints,
  transferPoints
};
