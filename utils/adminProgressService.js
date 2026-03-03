// utils/adminProgressService.js
const { EmbedBuilder } = require('discord.js');
const AdminProgress = require('../models/AdminProgress');
const {
  LEVEL_CONFIGS,
  POINT_TYPE_ALIASES,
  SUPPORT_ROLE_ID,
  PROMOTION_ANNOUNCE_CHANNEL_ID,
  WARNING_ROLE_IDS: CFG_WARNING_ROLE_IDS,
  PROMOTION_LOG_CHANNEL_ID
} = require('../config/adminProgressConfig');

const WARNING_ROLE_IDS = Array.isArray(CFG_WARNING_ROLE_IDS)
  ? CFG_WARNING_ROLE_IDS
  : String(process.env.WARNING_ROLE_IDS || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

const ADMIN_RANK_ROLE_ID = '1445473082180501655';
const WARN_RANK_ROLE_ID = '1478329249550041140';
const KASAR_CHANNEL_ID = '1463932101496799252';

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

function getMultiplier() {
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

function roleMentions(roleIds = []) {
  if (!Array.isArray(roleIds) || !roleIds.length) return 'لا يوجد';
  return roleIds.map(id => `<@&${id}>`).join('، ');
}

function getMemberHighestAdminLevel(member) {
  const adminRoles = LEVEL_CONFIGS
    .filter(cfg => cfg.roles && cfg.roles.some(roleId => member.roles.cache.has(roleId)))
    .sort((a, b) => b.level - a.level);
  return adminRoles.length > 0 ? adminRoles[0] : null;
}

async function syncMemberRolesForLevel(member, targetLevel) {
  // الحصول على أعلى رتبة إدارية للعضو
  const highestAdminLevelConfig = getMemberHighestAdminLevel(member);
  const startLevel = highestAdminLevelConfig ? highestAdminLevelConfig.level : 0;
  
  const targetCfg = LEVEL_CONFIGS.find(cfg => cfg.level === targetLevel) || { roles: [] };
  
  // حساب المستوى الفعلي (يبدأ من أعلى رتبة موجودة)
  const actualTargetLevel = Math.max(targetLevel, startLevel);
  const actualTargetCfg = LEVEL_CONFIGS.find(cfg => cfg.level === actualTargetLevel) || targetCfg;

  const allAdminRoles = LEVEL_CONFIGS.flatMap(cfg => cfg.roles || []);
  const removeSet = [...new Set([...allAdminRoles, ...WARNING_ROLE_IDS])];
  const removedRoles = [];
  const addedRoles = [];

  // إزالة رتب التحذير فقط + رتب المستويات الأقل من الهدف
  for (const roleId of removeSet) {
    if (WARNING_ROLE_IDS.includes(roleId)) {
      try {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
          removedRoles.push(roleId);
        }
      } catch (err) {
        console.error('Error removing warning role:', err);
      }
    }
  }

  // إضافة رتب المستوى المستهدف
  for (const roleId of actualTargetCfg.roles || []) {
    try {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
        addedRoles.push(roleId);
      }
    } catch (err) {
      console.error('Error adding role:', err);
    }
  }

  return { 
    removedRoles, 
    addedRoles, 
    fromLevel: startLevel, 
    toLevel: actualTargetLevel,
    fromCfg: highestAdminLevelConfig || { roles: [] },
    toCfg: actualTargetCfg 
  };
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
    })
    .setImage('https://cdn.discordapp.com/attachments/1390932617645260872/1391661420558422156/Picsart_25-07-07_09-05-01-827.png?ex=69a7cbb2&is=69a67a32&hm=67f646fb38d7285be13cfecf4e122ca1a68310158c0de7168228fc7710575c68');

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

  doc.level = Math.max(toLevel, 0);
  doc.promotedAt = new Date();
  await doc.save();

  const { removedRoles, addedRoles, fromCfg, toCfg } = await syncMemberRolesForLevel(
    member,
    doc.level
  );

  // إرسال بنل في قناة الكسر
  const kasarChannel = guild.channels.cache.get(KASAR_CHANNEL_ID);
  if (kasarChannel) {
    try {
      const kasarEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('⬇️ كسر رتبة إداري')
        .setDescription(
          [
            `<@&${ADMIN_RANK_ROLE_ID}>`,
            '',
            `**الإداري:** <@${member.id}>`,
            `**من مستوى:** ${fromLevel}`,
            `**إلى مستوى:** ${doc.level}`,
            `**الرتبة السابقة:** ${fromCfg?.name || `Level ${fromLevel}`}`,
            `**الرتبة الجديدة:** ${toCfg?.name || `Level ${doc.level}`}`,
            `**السبب:** ${reason}`,
            '',
            `**الرتب المحذوفة:** ${roleMentions(removedRoles)}`,
            `**الرتب المضافة:** ${roleMentions(addedRoles)}`
          ].join('\n')
        )
        .setFooter({
          text: `${member.user.tag} • ${new Date().toLocaleString('ar-SA')}`,
          iconURL: member.displayAvatarURL({ size: 128 })
        });

      await kasarChannel.send({ embeds: [kasarEmbed] });
    } catch (err) {
      console.error('Error sending demotion announcement:', err);
    }
  }

  return {
    fromLevel,
    toLevel: doc.level,
    fromName: fromCfg?.name || `Level ${fromLevel}`,
    toName: toCfg?.name || `Level ${doc.level}`,
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
