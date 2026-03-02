// utils/adminProgressService.js
const { EmbedBuilder } = require('discord.js');
const AdminProgress = require('../models/AdminProgress');
const {
  LEVEL_CONFIGS,
  POINT_TYPE_ALIASES,
  SUPPORT_ROLE_ID,
  PROMOTION_ANNOUNCE_CHANNEL_ID,
  WARNING_ROLE_IDS: CFG_WARNING_ROLE_IDS,
  ADMIN_WARN_TIERS = [],
  POINT_VALUE = {}
} = require('../config/adminProgressConfig');

const WARNING_ROLE_IDS = Array.isArray(CFG_WARNING_ROLE_IDS)
  ? CFG_WARNING_ROLE_IDS
  : String(process.env.WARNING_ROLE_IDS || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

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

/**
 * يأخذ أعلى مضاعف من رتب التحذير فقط (بدون stacking).
 * مثال: إذا معه تحذير1 و2 و3 => يأخذ 2.1 فقط.
 */
function getMultiplier(member) {
  if (!member?.roles?.cache) return 1.0;
  if (!Array.isArray(ADMIN_WARN_TIERS) || !ADMIN_WARN_TIERS.length) return 1.0;

  let max = 1.0;
  for (const tier of ADMIN_WARN_TIERS) {
    const roleId = String(tier?.roleId || '');
    const multiplier = Number(tier?.multiplier || 1);

    if (!roleId || !Number.isFinite(multiplier) || multiplier <= 0) continue;
    if (member.roles.cache.has(roleId) && multiplier > max) {
      max = multiplier;
    }
  }
  return max;
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

function pointValueByKey(key) {
  if (key === 'tickets') return Number(POINT_VALUE.ticket || 300);
  if (key === 'warns') return Number(POINT_VALUE.warn || 150);
  if (key === 'xp') return Number(POINT_VALUE.xp || 1);
  return NaN;
}

/**
 * تحويل بالنِّسَب الصحيحة:
 * 1 ticket = 300 xp
 * 1 warn = 150 xp
 * 1 ticket = 2 warns
 */
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

  const fromValue = pointValueByKey(fromKey);
  const toValue = pointValueByKey(toKey);

  if (!Number.isFinite(fromValue) || !Number.isFinite(toValue) || fromValue <= 0 || toValue <= 0) {
    throw new Error('قيمة التحويل غير صحيحة في الإعدادات.');
  }

  const base = amt * fromValue;
  const outRaw = base / toValue;
  const out = Math.floor(outRaw); // نقاط صحيحة

  if (out <= 0) throw new Error('الكمية الناتجة أقل من الحد الأدنى للتحويل.');

  doc.points[fromKey] -= amt;
  doc.points[toKey] += out;

  await doc.save();
  return { fromKey, toKey, amountIn: amt, amountOut: out };
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

function roleMentions(roleIds = []) {
  if (!Array.isArray(roleIds) || !roleIds.length) return 'لا يوجد';
  return roleIds.map(id => `<@&${id}>`).join('، ');
}

async function syncMemberRolesForLevel(member, fromLevel, toLevel) {
  const fromCfg = LEVEL_CONFIGS.find(cfg => cfg.level === fromLevel) || { roles: [] };
  const toCfg = LEVEL_CONFIGS.find(cfg => cfg.level === toLevel) || { roles: [] };

  const fromRoles = Array.isArray(fromCfg.roles) ? fromCfg.roles : [];
  const toRoles = Array.isArray(toCfg.roles) ? toCfg.roles : [];

  const removeSet = [...new Set([...fromRoles, ...WARNING_ROLE_IDS])];
  const removedRoles = [];
  const addedRoles = [];

  for (const roleId of removeSet) {
    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        removedRoles.push(roleId);
      }
    } catch (err) {
      console.error('Error removing role:', err);
    }
  }

  for (const roleId of toRoles) {
    try {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
        addedRoles.push(roleId);
      }
    } catch (err) {
      console.error('Error adding role:', err);
    }
  }

  return { removedRoles, addedRoles, fromCfg, toCfg };
}

async function tryPromote(message, member, options = {}) {
  if (!member?.guild) return { promoted: false };

  const announceInChannel = options.announceInChannel ?? true;
  const dmOnPromote = options.dmOnPromote ?? true;

  const guild = member.guild;
  const doc = await getOrCreate(guild.id, member.id);
  const multiplier = getMultiplier(member);

  const startingLevel = doc.level;
  let promotedCount = 0;
  const consumed = { tickets: 0, warns: 0, xp: 0 };

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

  if (!promotedCount) return { promoted: false };

  await doc.save();

  const { removedRoles, addedRoles, fromCfg, toCfg } = await syncMemberRolesForLevel(
    member,
    startingLevel,
    doc.level
  );

  const oldLevelName = fromCfg?.name || `Level ${startingLevel}`;
  const newLevelName = toCfg?.name || `Level ${doc.level}`;

  const promoteEmbed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('🚀 ترقية إداري')
    .setDescription(
      [
        `**الإداري:** <@${member.id}>`,
        `**من مستوى:** ${startingLevel}`,
        `**إلى مستوى:** ${doc.level}`,
        `**الرتبة السابقة:** ${oldLevelName}`,
        `**الرتبة الجديدة:** ${newLevelName}`,
        '',
        `**الرتب المحذوفة:** ${roleMentions(removedRoles)}`,
        `**الرتب المضافة:** ${roleMentions(addedRoles)}`,
        '',
        `**المطلوب المخصوم خلال الترقية:**`,
        `🎟️ تذاكر: ${consumed.tickets}`,
        `⚠️ تحذيرات: ${consumed.warns}`,
        `✨ XP: ${consumed.xp}`
      ].join('\n')
    )
    .setFooter({
      text: `${member.user.tag} • ${new Date().toLocaleString('ar-SA')}`,
      iconURL: member.displayAvatarURL({ size: 128 })
    });

  if (announceInChannel) {
    const announceChannel = guild.channels.cache.get(PROMOTION_ANNOUNCE_CHANNEL_ID);
    if (announceChannel) {
      try {
        await announceChannel.send({
          content: `<@&${SUPPORT_ROLE_ID}>`,
          allowedMentions: { roles: [SUPPORT_ROLE_ID] },
          embeds: [promoteEmbed]
        });
      } catch (err) {
        console.error('Error sending promotion announcement:', err);
      }
    }
  }

  if (dmOnPromote) {
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🎉 مبروك لقد ترقيت تهانينا')
        .setDescription(
          [
            `**<@${member.id}>**`,
            `تمت ترقيتك بنجاح.`,
            `**من:** ${oldLevelName}`,
            `**إلى:** ${newLevelName}`
          ].join('\n')
        );

      await member.send({ embeds: [dmEmbed] });
    } catch {}
  }

  return {
    promoted: true,
    fromLevel: startingLevel,
    toLevel: doc.level,
    fromName: oldLevelName,
    toName: newLevelName,
    removedRoles,
    addedRoles
  };
}

async function demoteOneLevel(guild, member, options = {}) {
  const reason = String(options.reason || '').trim();
  if (!reason) {
    throw new Error('لا يمكن تنفيذ كسر بدون سبب.');
  }

  const doc = await getOrCreate(guild.id, member.id);
  if (!doc || (doc.level ?? 0) <= 0) {
    throw new Error('هذا العضو في أقل مستوى بالفعل.');
  }

  const fromLevel = doc.level;
  const toLevel = fromLevel - 1;

  doc.level = toLevel;
  doc.promotedAt = new Date();
  await doc.save();

  const { removedRoles, addedRoles, fromCfg, toCfg } = await syncMemberRolesForLevel(
    member,
    fromLevel,
    toLevel
  );

  return {
    fromLevel,
    toLevel,
    fromName: fromCfg?.name || `Level ${fromLevel}`,
    toName: toCfg?.name || `Level ${toLevel}`,
    removedRoles,
    addedRoles,
    reason
  };
}

module.exports = {
  getOrCreate,
  addPoints,
  tryPromote,
  demoteOneLevel,
  getMultiplier,
  getNextLevelConfig,
  scaledReq,
  normalizePointKey,
  convertPoints,
  transferPoints
};
