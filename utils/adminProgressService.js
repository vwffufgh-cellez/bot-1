// utils/adminProgressService.js
const { EmbedBuilder } = require('discord.js');
const AdminProgress = require('../models/AdminProgress');
const {
  LEVEL_CONFIGS,
  POINT_TYPE_ALIASES,
  WARNING_ROLE_IDS = []
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

function getLevelConfig(level) {
  if (!Array.isArray(LEVEL_CONFIGS)) return null;
  return LEVEL_CONFIGS.find(cfg => cfg.level === level) || null;
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

function roleMentions(roleIds = []) {
  if (!Array.isArray(roleIds) || !roleIds.length) return 'لا يوجد';
  return roleIds.map(id => `<@&${id}>`).join('، ');
}

async function syncRolesByLevel(guild, member, fromRoles = [], toRoles = [], removeExtra = []) {
  const toRemove = [...new Set([...(fromRoles || []), ...(removeExtra || [])])];
  const toAdd = [...new Set(toRoles || [])];

  const removed = [];
  const added = [];

  for (const roleId of toRemove) {
    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        removed.push(roleId);
      }
    } catch (err) {
      console.error('Error removing role:', err);
    }
  }

  for (const roleId of toAdd) {
    try {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
        added.push(roleId);
      }
    } catch (err) {
      console.error('Error adding role:', err);
    }
  }

  return { removed, added };
}

// ترقية: DM فقط افتراضيًا + منشن داخل البنل + حذف "المتبقي بعد الترحيل"
async function tryPromote(interactionOrMessage, member, options = {}) {
  if (!member?.guild) return { promoted: false };

  const announceInChannel = options.announceInChannel ?? false;
  const dmOnPromote = options.dmOnPromote ?? true;

  const guild = member.guild;
  const doc = await getOrCreate(guild.id, member.id);
  const multiplier = getMultiplier(member);

  const startingLevel = doc.level || 0;
  let promotedCount = 0;
  const consumed = { tickets: 0, warns: 0, xp: 0 };

  const startingCfg = getLevelConfig(startingLevel) || { level: startingLevel, name: `Level ${startingLevel}`, roles: [] };

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

  const finalCfg = getLevelConfig(doc.level) || { level: doc.level, name: `Level ${doc.level}`, roles: [] };
  const oldRoles = Array.isArray(startingCfg.roles) ? startingCfg.roles : [];
  const newRoles = Array.isArray(finalCfg.roles) ? finalCfg.roles : [];

  const warningRoles = Array.isArray(WARNING_ROLE_IDS) ? WARNING_ROLE_IDS : [];
  const syncResult = await syncRolesByLevel(guild, member, oldRoles, newRoles, warningRoles);

  const removedWarningRoles = (syncResult.removed || []).filter(id => warningRoles.includes(id));

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('🚀 ترقية إداري')
    .setDescription(
      [
        `**تهانينا <@${member.id}>!**`,
        `تمت ترقيتك بنجاح.`,
        '',
        `**من مستوى:** ${startingCfg.name || `Level ${startingLevel}`}`,
        `**إلى مستوى:** ${finalCfg.name || `Level ${doc.level}`}`,
        '',
        `**الرتب السابقة:** ${roleMentions(oldRoles)}`,
        `**الرتب الجديدة:** ${roleMentions(newRoles)}`,
        `**رتب التحذيرات المحذوفة:** ${roleMentions(removedWarningRoles)}`,
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

  if (dmOnPromote) {
    try {
      await member.send({ embeds: [embed] });
    } catch {}
  }

  if (announceInChannel) {
    try {
      const channel = interactionOrMessage?.channel;
      if (channel) {
        await channel.send({
          allowedMentions: { parse: [] },
          embeds: [embed]
        });
      }
    } catch {}
  }

  return {
    promoted: true,
    fromLevel: startingLevel,
    toLevel: doc.level,
    fromName: startingCfg.name || `Level ${startingLevel}`,
    toName: finalCfg.name || `Level ${doc.level}`,
    removedWarningRoles
  };
}

// كسر رتبة واحدة
async function demoteOneLevel(guild, member) {
  const doc = await getOrCreate(guild.id, member.id);
  if (!doc || (doc.level ?? 0) <= 0) {
    throw new Error('هذا العضو في أقل مستوى بالفعل.');
  }

  const fromLevel = doc.level;
  const toLevel = fromLevel - 1;

  const fromCfg = getLevelConfig(fromLevel) || { level: fromLevel, name: `Level ${fromLevel}`, roles: [] };
  const toCfg = getLevelConfig(toLevel) || { level: toLevel, name: `Level ${toLevel}`, roles: [] };

  doc.level = toLevel;
  await doc.save();

  const oldRoles = Array.isArray(fromCfg.roles) ? fromCfg.roles : [];
  const newRoles = Array.isArray(toCfg.roles) ? toCfg.roles : [];
  await syncRolesByLevel(guild, member, oldRoles, newRoles, []);

  return {
    fromLevel,
    toLevel,
    fromName: fromCfg.name || `Level ${fromLevel}`,
    toName: toCfg.name || `Level ${toLevel}`
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
