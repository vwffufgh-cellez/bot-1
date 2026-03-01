// utils/adminProgressService.js
const { EmbedBuilder } = require('discord.js');
const AdminProgress = require('../models/AdminProgress');
const {
  LEVEL_CONFIGS,
  POINT_TYPE_ALIASES,
  SUPPORT_ROLE_ID,
  PROMOTION_ANNOUNCE_CHANNEL_ID
} = require('../config/adminProgressConfig');

// دالة للحصول على أو إنشاء سجل الإداري
async function getOrCreate(guildId, adminId) {
  let doc = await AdminProgress.findOne({ guildId, adminId });
  if (!doc) {
    doc = new AdminProgress({ guildId, adminId });
    await doc.save();
  }
  return doc;
}

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

function getMultiplier(member) {
  return 1.0;
}

function getNextLevelConfig(currentLevel) {
  if (!Array.isArray(LEVEL_CONFIGS)) return null;
  return LEVEL_CONFIGS.find(cfg => cfg.level === currentLevel + 1) || null;
}

function scaledReq(req, multiplier) {
  if (!req) return null;
  return {
    tickets: Math.ceil((req.tickets || 0) * multiplier),
    warns: Math.ceil((req.warns || 0) * multiplier),
    xp: Math.ceil((req.xp || 0) * multiplier)
  };
}

function normalizePointKey(key) {
  if (!key) return null;
  const lower = String(key).toLowerCase();

  if (POINT_TYPE_ALIASES) {
    for (const [type, aliases] of Object.entries(POINT_TYPE_ALIASES)) {
      if (aliases.map(a => a.toLowerCase()).includes(lower)) return type;
    }
  }

  if (['tickets', 'ticket', 'تكت', 'تذاكر', 'تكتات'].includes(lower)) return 'tickets';
  if (['warns', 'warnings', 'تحذير', 'تحذيرات', 'تحدير'].includes(lower)) return 'warns';
  if (['xp', 'خبرة', 'اكسبي'].includes(lower)) return 'xp';

  return null;
}

async function convertPoints(doc, fromType, amount, toType) {
  const fromKey = normalizePointKey(fromType);
  const toKey = normalizePointKey(toType);

  if (!fromKey || !toKey) throw new Error('نوع النقاط غير معروف.');
  if (fromKey === toKey) throw new Error('لا يمكن التبديل لنفس نوع النقاط.');

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('الكمية يجب أن تكون رقم صالح وأكبر من 0.');

  doc.points[fromKey] = doc.points[fromKey] || 0;
  doc.points[toKey] = doc.points[toKey] || 0;

  if (doc.points[fromKey] < amt) throw new Error('لا تملك نقاط كافية للتبديل.');

  doc.points[fromKey] -= amt;
  doc.points[toKey] += amt;

  await doc.save();
  return { fromKey, toKey, amountIn: amt, amountOut: amt };
}

async function transferPoints(fromDoc, toDoc, typeArg, amount) {
  const key = normalizePointKey(typeArg);
  if (!key) throw new Error('نوع النقاط غير صالح.');

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('الكمية يجب أن تكون رقم صالح وأكبر من 0.');

  fromDoc.points[key] = fromDoc.points[key] || 0;
  toDoc.points[key] = toDoc.points[key] || 0;

  if (fromDoc.points[key] < amt) throw new Error('لا تملك نقاط كافية للتحويل.');

  fromDoc.points[key] -= amt;
  toDoc.points[key] += amt;

  await fromDoc.save();
  await toDoc.save();

  return { docKey: key, amount: amt };
}

function roleNames(guild, roleIds = []) {
  if (!Array.isArray(roleIds) || !roleIds.length) return 'لا يوجد';
  return roleIds
    .map(id => guild.roles.cache.get(id)?.name || id)
    .join('، ');
}

// ✅ ترقية مع خصم المطلوب + ترحيل الزيادة + منشن خارج البنل
async function tryPromote(interactionOrMessage, member) {
  if (!member?.guild) return;

  const guild = member.guild;
  const doc = await getOrCreate(guild.id, member.id);
  const multiplier = getMultiplier(member);

  const startingLevel = doc.level;
  let promotedCount = 0;
  const consumed = { tickets: 0, warns: 0, xp: 0 };

  // نجيب أول رتبة قديمة قبل أول ترقية
  const startingCfg =
    doc.level > 0
      ? LEVEL_CONFIGS.find(cfg => cfg.level === doc.level) || { roles: [] }
      : { roles: [] };

  // حلقة ترقيات متعددة عند وجود فائض
  while (true) {
    const nextCfg = getNextLevelConfig(doc.level);
    if (!nextCfg) break;

    const nextReq = scaledReq(nextCfg.req, multiplier);
    if (!nextReq) break;

    const canPromote =
      (doc.points.tickets || 0) >= (nextReq.tickets || 0) &&
      (doc.points.warns || 0) >= (nextReq.warns || 0) &&
      (doc.points.xp || 0) >= (nextReq.xp || 0);

    if (!canPromote) break;

    // خصم المطلوب للمستوى الحالي (والفائض يبقى)
    doc.points.tickets = (doc.points.tickets || 0) - (nextReq.tickets || 0);
    doc.points.warns = (doc.points.warns || 0) - (nextReq.warns || 0);
    doc.points.xp = (doc.points.xp || 0) - (nextReq.xp || 0);

    consumed.tickets += nextReq.tickets || 0;
    consumed.warns += nextReq.warns || 0;
    consumed.xp += nextReq.xp || 0;

    doc.level += 1;
    doc.promotedAt = new Date();
    promotedCount += 1;
  }

  if (!promotedCount) return;

  await doc.save();

  const finalCfg = LEVEL_CONFIGS.find(cfg => cfg.level === doc.level) || { roles: [] };
  const oldRoles = Array.isArray(startingCfg.roles) ? startingCfg.roles : [];
  const newRoles = Array.isArray(finalCfg.roles) ? finalCfg.roles : [];

  const WARNING_ROLE_IDS = [];
  const rolesToRemove = [...new Set([...oldRoles, ...WARNING_ROLE_IDS])];

  for (const roleId of rolesToRemove) {
    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
      }
    } catch (err) {
      console.error('Error removing role in promotion:', err);
    }
  }

  for (const roleId of newRoles) {
    try {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
      }
    } catch (err) {
      console.error('Error adding role in promotion:', err);
    }
  }

  const announceChannel = guild.channels.cache.get(PROMOTION_ANNOUNCE_CHANNEL_ID);
  if (announceChannel) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('🚀 ترقية إداري')
      .setDescription(
        [
          `**تمت ترقية:** <@${member.id}>`,
          `**من مستوى:** ${startingLevel}`,
          `**إلى مستوى:** ${doc.level}`,
          `**المستوى الحالي:** ${finalCfg.name || `Level ${doc.level}`}`,
          '',
          `**الرتبة السابقة:** ${roleNames(guild, oldRoles)}`,
          `**الرتبة الجديدة:** ${roleNames(guild, newRoles)}`,
          '',
          `**المطلوب المخصوم خلال الترقية:**`,
          `🎟️ تذاكر: ${consumed.tickets}`,
          `⚠️ تحذيرات: ${consumed.warns}`,
          `✨ XP: ${consumed.xp}`,
          '',
          `**المتبقي بعد الترحيل:**`,
          `🎟️ ${doc.points.tickets} | ⚠️ ${doc.points.warns} | ✨ ${doc.points.xp}`
        ].join('\n')
      )
      .setFooter({
        text: `${member.user.tag} • ${new Date().toLocaleString('ar-SA')}`,
        iconURL: member.displayAvatarURL({ size: 128 })
      });

    try {
      await announceChannel.send({
        content: `<@&${SUPPORT_ROLE_ID}>`, // ✅ المنشن برا البنل
        allowedMentions: { roles: [SUPPORT_ROLE_ID] },
        embeds: [embed]
      });
    } catch (err) {
      console.error('Error sending promotion announcement:', err);
    }
  }

  // إشعار بسيط للشخص (بدون كسر لو الرد مستخدم)
  try {
    if (interactionOrMessage && typeof interactionOrMessage.reply === 'function') {
      await interactionOrMessage.reply({
        content: `🎉 تم ترقيتك إلى **${finalCfg.name || `Level ${doc.level}`}**`,
        allowedMentions: { repliedUser: true }
      });
    }
  } catch {}
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
