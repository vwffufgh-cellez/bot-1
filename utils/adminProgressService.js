const AdminProgress = require('../models/AdminProgress');
const { ADMIN_LEVELS, ADMIN_WARN_TIERS, POINT_VALUE, PROMOTION_LOG_CHANNEL_ID } = require('../config/adminProgressConfig');
const { redPanel } = require('./panel');

async function getOrCreate(guildId, userId) {
  let doc = await AdminProgress.findOne({ guildId, userId });
  if (!doc) doc = await AdminProgress.create({ guildId, userId });
  return doc;
}

function getMultiplier(member) {
  let m = 1;
  for (const tier of ADMIN_WARN_TIERS) {
    if (member.roles.cache.has(tier.roleId)) m = Math.max(m, tier.multiplier);
  }
  return m;
}

function getNextLevelConfig(level) {
  return ADMIN_LEVELS.find(x => x.level === level + 1) || null;
}

function scaledReq(req, multiplier) {
  return {
    tickets: Math.ceil(req.tickets * multiplier),
    warns: Math.ceil(req.warns * multiplier),
    xp: Math.ceil(req.xp * multiplier)
  };
}

async function addPoints({ guildId, userId, tickets = 0, warns = 0, xp = 0 }) {
  const doc = await getOrCreate(guildId, userId);
  doc.points.tickets += tickets;
  doc.points.warns += warns;
  doc.points.xp += xp;

  doc.lifetime.tickets += tickets;
  doc.lifetime.warns += warns;
  doc.lifetime.xp += xp;

  await doc.save();
  return doc;
}

function toBase(type, amount) {
  const key = type === 'تكت' ? 'ticket' : type === 'تحذير' ? 'warn' : type === 'اكسبي' ? 'xp' : type;
  return amount * POINT_VALUE[key];
}
function fromBase(type, base) {
  const key = type === 'تكت' ? 'ticket' : type === 'تحذير' ? 'warn' : type === 'اكسبي' ? 'xp' : type;
  return Math.floor(base / POINT_VALUE[key]);
}

async function convertPoints(doc, fromType, amount, toType) {
  if (amount <= 0) throw new Error('الكمية لازم تكون أكبر من 0');
  if (doc.points[fromType] < amount) throw new Error('نقاطك غير كافية');

  const base = toBase(fromType, amount);
  const out = fromBase(toType, base);
  if (out <= 0) throw new Error('ناتج التحويل أقل من 1');

  doc.points[fromType] -= amount;
  doc.points[toType] += out;
  await doc.save();
  return out;
}

async function transferPoints(fromDoc, toDoc, type, amount) {
  if (amount <= 0) throw new Error('الكمية لازم تكون أكبر من 0');
  if (fromDoc.points[type] < amount) throw new Error('نقاطك غير كافية');

  fromDoc.points[type] -= amount;
  toDoc.points[type] += amount;
  await Promise.all([fromDoc.save(), toDoc.save()]);
}

async function tryPromote(message, member) {
  const doc = await getOrCreate(message.guild.id, member.id);

  let promoted = false;
  let oldLevel = doc.level;

  while (true) {
    const nextCfg = getNextLevelConfig(doc.level);
    if (!nextCfg) break;

    const mult = getMultiplier(member);
    const req = scaledReq(nextCfg.req, mult);

    const ok =
      doc.points.tickets >= req.tickets &&
      doc.points.warns >= req.warns &&
      doc.points.xp >= req.xp;

    if (!ok) break;

    // خصم متطلبات المرحلة
    doc.points.tickets -= req.tickets;
    doc.points.warns -= req.warns;
    doc.points.xp -= req.xp;

    doc.level = nextCfg.level;
    doc.promotedAt = new Date();
    promoted = true;
  }

  if (!promoted) return null;
  await doc.save();

  // إزالة رتب التحذير الإداري بعد الترقية
  const warnTierRoleIds = ADMIN_WARN_TIERS.map(x => x.roleId).filter(Boolean);
  const toRemove = warnTierRoleIds.filter(id => member.roles.cache.has(id));
  if (toRemove.length) await member.roles.remove(toRemove).catch(() => {});

  // إضافة رتبة المستوى الجديد (مع الحفاظ على السابقة)
  const newCfg = ADMIN_LEVELS.find(x => x.level === doc.level);
  if (newCfg?.roleId && !member.roles.cache.has(newCfg.roleId)) {
    await member.roles.add(newCfg.roleId).catch(() => {});
  }

  const logChannel = message.guild.channels.cache.get(PROMOTION_LOG_CHANNEL_ID);
  if (logChannel) {
    await logChannel.send({
      embeds: [
        redPanel(
          `الاداري : <@${member.id}>\n` +
          `الترقية : **${newCfg?.name || `Level ${doc.level}`}**\n` +
          `الرتبة يلي قبل : **${oldLevel === 0 ? 'لا يوجد' : `Level ${oldLevel}`}**`
        )
      ],
      allowedMentions: { parse: [] }
    }).catch(() => {});
  }

  return { oldLevel, newLevel: doc.level };
}

module.exports = {
  getOrCreate, addPoints, tryPromote, convertPoints, transferPoints,
  getMultiplier, getNextLevelConfig, scaledReq
};
