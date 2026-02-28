// utils/adminProgressService.js
const AdminProgress = require('../models/AdminProgress');
const {
  ADMIN_LEVELS,
  ADMIN_WARN_TIERS,
  POINT_VALUE,
  PROMOTION_LOG_CHANNEL_ID,
  TRANSFER_ALIASES
} = require('../config/adminProgressConfig');
const { redPanel } = require('./panel');

const DOC_KEY_MAP = {
  tickets: 'tickets',
  ticket: 'tickets',
  تكت: 'tickets',
  تداكر: 'tickets',
  تذاكر: 'tickets',
  تكتات: 'tickets',
  ت: 'tickets',
  warns: 'warns',
  warn: 'warns',
  تحذير: 'warns',
  تحذيرات: 'warns',
  تحدير: 'warns',
  تحديرات: 'warns',
  و: 'warns',
  xp: 'xp',
  خبرة: 'xp',
  اكسبي: 'xp',
  اكس: 'xp',
  x: 'xp'
};

const DOC_TO_BASE = {
  tickets: 'ticket',
  warns: 'warn',
  xp: 'xp'
};

function normalizePointKey(input) {
  const key = (input ?? '').toString().toLowerCase();
  return DOC_KEY_MAP[key] || null;
}

// دالة للتحقق من اختصارات النوع
function getTypeFromAlias(alias) {
  if (!alias) return null;
  const lowerAlias = alias.toLowerCase();
  
  for (const [type, aliases] of Object.entries(TRANSFER_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === lowerAlias)) {
      return type;
    }
  }
  return null;
}

function toBaseFromDocKey(docKey, amount) {
  const baseKey = DOC_TO_BASE[docKey];
  if (!baseKey || POINT_VALUE[baseKey] == null) {
    throw new Error('نوع النقاط غير مدعوم.');
  }
  return amount * POINT_VALUE[baseKey];
}

function fromBaseToDocKey(docKey, baseAmount) {
  const baseKey = DOC_TO_BASE[docKey];
  if (!baseKey || POINT_VALUE[baseKey] == null) {
    throw new Error('نوع النقاط غير مدعوم.');
  }
  return Math.floor(baseAmount / POINT_VALUE[baseKey]);
}

function ensurePointBuckets(doc) {
  let dirty = false;

  if (!doc.points) {
    doc.points = { tickets: 0, warns: 0, xp: 0 };
    dirty = true;
  } else {
    for (const key of ['tickets', 'warns', 'xp']) {
      if (typeof doc.points[key] !== 'number') {
        doc.points[key] = 0;
        dirty = true;
      }
    }
  }

  if (!doc.lifetime) {
    doc.lifetime = { tickets: 0, warns: 0, xp: 0 };
    dirty = true;
  } else {
    for (const key of ['tickets', 'warns', 'xp']) {
      if (typeof doc.lifetime[key] !== 'number') {
        doc.lifetime[key] = 0;
        dirty = true;
      }
    }
  }

  return dirty;
}

async function getOrCreate(guildId, userId) {
  let doc = await AdminProgress.findOne({ guildId, userId });
  if (!doc) doc = await AdminProgress.create({ guildId, userId });
  if (ensurePointBuckets(doc)) await doc.save();
  return doc;
}

function getMultiplier(member) {
  let m = 1;
  for (const tier of ADMIN_WARN_TIERS) {
    if (member.roles.cache.has(tier.roleId)) {
      m = Math.max(m, tier.multiplier);
    }
  }
  return m;
}

function getNextLevelConfig(level) {
  return ADMIN_LEVELS.find(l => l.level === level + 1) || null;
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

async function convertPoints(doc, fromTypeRaw, amount, toTypeRaw) {
  ensurePointBuckets(doc);

  const fromKey = normalizePointKey(fromTypeRaw);
  const toKey = normalizePointKey(toTypeRaw);

  if (!fromKey || !toKey) throw new Error('نوع النقاط غير معروف.');
  if (fromKey === toKey) throw new Error('لا يمكن التحويل لنفس النوع.');
  if (amount <= 0) throw new Error('الكمية لازم تكون أكبر من 0.');
  if (doc.points[fromKey] < amount) throw new Error('نقاطك غير كافية.');

  const base = toBaseFromDocKey(fromKey, amount);
  const out = fromBaseToDocKey(toKey, base);

  if (out <= 0) throw new Error('ناتج التحويل أقل من 1.');

  doc.points[fromKey] -= amount;
  doc.points[toKey] += out;
  await doc.save();

  return {
    amountOut: out,
    amountIn: amount,
    fromKey,
    toKey
  };
}

async function transferPoints(fromDoc, toDoc, typeRaw, amount) {
  ensurePointBuckets(fromDoc);
  ensurePointBuckets(toDoc);

  const docKey = normalizePointKey(typeRaw);
  if (!docKey) throw new Error('نوع النقاط غير معروف.');
  if (amount <= 0) throw new Error('الكمية لازم تكون أكبر من 0.');
  if (fromDoc.points[docKey] < amount) throw new Error('نقاطك غير كافية.');

  fromDoc.points[docKey] -= amount;
  toDoc.points[docKey] += amount;

  await Promise.all([fromDoc.save(), toDoc.save()]);
}

async function tryPromote(message, member) {
  const doc = await getOrCreate(message.guild.id, member.id);

  let promoted = false;
  const oldLevel = doc.level;

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

    // خصم المتطلبات فقط والاحتفاظ بالفائض
    doc.points.tickets -= req.tickets;
    doc.points.warns -= req.warns;
    doc.points.xp -= req.xp;

    doc.level = nextCfg.level;
    doc.promotedAt = new Date();
    promoted = true;
  }

  if (!promoted) return null;
  await doc.save();

  const warnTierRoleIds = ADMIN_WARN_TIERS.map(t => t.roleId).filter(Boolean);
  const toRemove = warnTierRoleIds.filter(id => member.roles.cache.has(id));
  if (toRemove.length) {
    await member.roles.remove(toRemove).catch(() => {});
  }

  const newCfg = ADMIN_LEVELS.find(x => x.level === doc.level);
  if (newCfg?.roleId && !member.roles.cache.has(newCfg.roleId)) {
    await member.roles.add(newCfg.roleId).catch(() => {});
  }

  const logChannel = message.guild.channels.cache.get(PROMOTION_LOG_CHANNEL_ID);
  if (logChannel) {
    await logChannel
      .send({
        embeds: [
          redPanel(
            `الاداري : <@${member.id}>\n` +
              `الترقية : **${newCfg?.name || `Level ${doc.level}`}**\n` +
              `الرتبة يلي قبل : **${oldLevel === 0 ? 'لا يوجد' : `Level ${oldLevel}`}**`
          )
        ],
        allowedMentions: { parse: [] }
      })
      .catch(() => {});
  }

  return { oldLevel, newLevel: doc.level };
}

module.exports = {
  getOrCreate,
  addPoints,
  tryPromote,
  convertPoints,
  transferPoints,
  getMultiplier,
  getNextLevelConfig,
  scaledReq,
  normalizePointKey,
  getTypeFromAlias
};
