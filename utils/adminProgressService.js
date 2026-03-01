const { EmbedBuilder } = require('discord.js');
const AdminProgress = require('../models/AdminProgress');
const { LEVEL_CONFIGS, POINT_TYPE_ALIASES } = require('../config/adminProgressConfig');

// دالة للحصول على أو إنشاء سجل الإداري
async function getOrCreate(guildId, adminId) {
  let doc = await AdminProgress.findOne({ guildId, adminId });
  if (!doc) {
    doc = new AdminProgress({ guildId, adminId });
    await doc.save();
  }
  return doc;
}

// إضافة نقاط (جمع)
async function addPoints({ guildId, userId, xp = 0, tickets = 0, warnings = 0 }) {
  const doc = await getOrCreate(guildId, userId);

  if (xp > 0) {
    doc.points.xp += xp;
    doc.lifetime.xp += xp;
  }
  if (tickets > 0) {
    doc.points.tickets += tickets;
    doc.lifetime.tickets += tickets;
  }
  if (warnings > 0) {
    doc.points.warns += warnings;
    doc.lifetime.warns += warnings;
  }

  await doc.save();
  return doc;
}

// تعيين نقاط مباشرة (استبدال - لأمر التعديل)
async function setPoints({ guildId, userId, tickets = null, warns = null, xp = null }) {
  const doc = await getOrCreate(guildId, userId);

  if (tickets !== null) {
    doc.points.tickets = tickets;
  }
  if (warns !== null) {
    doc.points.warns = warns;
  }
  if (xp !== null) {
    doc.points.xp = xp;
  }

  await doc.save();
  return doc;
}

// الحصول على المضاعف
function getMultiplier(member) {
  return 1.0;
}

// الحصول على config المستوى التالي
function getNextLevelConfig(currentLevel) {
  const configs = LEVEL_CONFIGS || [];
  return configs.find(cfg => cfg.level === currentLevel + 1) || null;
}

// الحصول على config المستوى الحالي
function getCurrentLevelConfig(currentLevel) {
  const configs = LEVEL_CONFIGS || [];
  if (currentLevel === 0) return { level: 0, name: 'بدون رتبة', roles: [] };
  return configs.find(cfg => cfg.level === currentLevel) || { level: currentLevel, name: `Level ${currentLevel}`, roles: [] };
}

// حساب المتطلبات المعدّلة بالمضاعف
function scaledReq(req, multiplier) {
  return {
    tickets: Math.ceil(req.tickets * multiplier),
    warns: Math.ceil(req.warns * multiplier),
    xp: Math.ceil(req.xp * multiplier)
  };
}

// تطبيع اسم نوع النقاط
function normalizePointKey(key) {
  const lower = key.toLowerCase();
  for (const [type, aliases] of Object.entries(POINT_TYPE_ALIASES || {})) {
    if (aliases.includes(lower)) return type;
  }
  return null;
}

// تبديل النقاط
async function convertPoints(doc, fromType, amount, toType) {
  const fromKey = normalizePointKey(fromType);
  const toKey = normalizePointKey(toType);
  if (!fromKey || !toKey || fromKey === toKey) throw new Error('أنواع غير صالحة أو متطابقة.');

  if (doc.points[fromKey] < amount) throw new Error('لا تملك نقاط كافية للتبديل.');

  const amountOut = amount;
  doc.points[fromKey] -= amount;
  doc.points[toKey] += amountOut;
  await doc.save();

  return { fromKey, toKey, amountIn: amount, amountOut };
}

// تحويل نقاط بين مستخدمين
async function transferPoints(fromDoc, toDoc, typeArg, amount) {
  const key = normalizePointKey(typeArg);
  if (!key) throw new Error('نوع غير صالح.');

  if (fromDoc.points[key] < amount) throw new Error('لا تملك نقاط كافية للتحويل.');

  fromDoc.points[key] -= amount;
  toDoc.points[key] += amount;
  await fromDoc.save();
  await toDoc.save();

  return { docKey: key, amount };
}

// === محاولة الترقية (مُصلحة تماماً) ===
async function tryPromote(interactionOrMessage, member) {
  if (!member) return;

  const guildId = member.guild.id;
  const adminId = member.id;
  const doc = await getOrCreate(guildId, adminId);
  
  const multiplier = getMultiplier(member);
  const nextCfg = getNextLevelConfig(doc.level);
  if (!nextCfg) return;

  const nextReq = scaledReq(nextCfg.req, multiplier);
  
  // === التصحيح: >= بدل === ===
  const canPromote = 
    doc.points.tickets >= nextReq.tickets &&
    doc.points.warns >= nextReq.warns &&
    doc.points.xp >= nextReq.xp;

  if (!canPromote) return;

  // جلب الرتب القديمة
  const currentCfg = getCurrentLevelConfig(doc.level);
  const oldRoles = currentCfg.roles || [];

  // الترقية
  const oldLevel = doc.level;
  doc.level = oldLevel + 1;
  doc.promotedAt = new Date();
  await doc.save();

  // إزالة الرتب القديمة
  for (const roleId of oldRoles) {
    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
      }
    } catch (err) {
      console.error('Error removing role:', err);
    }
  }

  // إضافة الرتب الجديدة
  const newRoles = nextCfg.roles || [];
  for (const roleId of newRoles) {
    try {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
      }
    } catch (err) {
      console.error('Error adding role:', err);
    }
  }

  // حساب الرتب المشالة
  const removedRoles = oldRoles.filter(roleId => !newRoles.includes(roleId));
  const removedNames = removedRoles.length > 0 
    ? removedRoles.map(id => `<@&${id}>`).join(' ')
    : '**لا يوجد**';

  // === إرسال الإشعار ===
  const announcementChannelId = '1463932101496799252';
  const announcementChannel = member.guild.channels.cache.get(announcementChannelId);
  
  if (announcementChannel) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('**تمت ترقية الإداري**')
      .setDescription('**<@&1445473101629493383>**')
      .addFields(
        {
          name: '**الإداري المرقى**',
          value: `**<@${adminId}>**`,
          inline: false
        },
        {
          name: '**الرتب التي أُعطيت له**',
          value: newRoles.length > 0 
            ? newRoles.map(id => `<@&${id}>`).join(' ')
            : '**لا يوجد**',
          inline: false
        },
        {
          name: '**الرتب التي كان يملكها**',
          value: oldRoles.length > 0 
            ? oldRoles.map(id => `<@&${id}>`).join(' ')
            : '**لا يوجد**',
          inline: false
        },
        {
          name: '**الرتب التي أُزيلت**',
          value: removedNames,
          inline: false
        }
      )
      .setImage('https://cdn.discordapp.com/attachments/1390932617645260872/1391661420558422156/Picsart_25-07-07_09-05-01-827.png?ex=69a528b2&is=69a3d732&hm=1afa0cca211ad776f4f300106b39daa4f94427cc3c093f352a14f725d26c35bf')
      .setFooter({
        text: `${member.user.tag} ← ${nextCfg.name || `Level ${doc.level}`}`,
        iconURL: member.displayAvatarURL({ size: 128 })
      });

    try {
      await announcementChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error('Error sending promotion announcement:', err);
    }
  }
}

module.exports = {
  getOrCreate,
  addPoints,
  setPoints,
  tryPromote,
  getMultiplier,
  getNextLevelConfig,
  getCurrentLevelConfig,
  scaledReq,
  normalizePointKey,
  convertPoints,
  transferPoints
};
