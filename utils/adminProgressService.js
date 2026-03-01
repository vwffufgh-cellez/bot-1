// utils/adminProgressService.js
const AdminProgress = require('../models/AdminProgress');
const {
  ADMIN_LEVELS,
  ADMIN_WARN_TIERS,
  POINT_VALUE,
  PROMOTION_LOG_CHANNEL_ID,
  POINT_TYPE_ALIASES
} = require('../config/adminProgressConfig');
const { redPanel } = require('./panel');

// بناء خريطة الاختصارات ديناميكياً
const DOC_KEY_MAP = {};
for (const [docKey, aliases] of Object.entries(POINT_TYPE_ALIASES)) {
  for (const alias of aliases) {
    DOC_KEY_MAP[alias.toLowerCase()] = docKey;
  }
}

const DOC_TO_BASE = {
  tickets: 'ticket',
  warns: 'warn',
  xp: 'xp'
};

function normalizePointKey(input) {
  const key = (input ?? '').toString().toLowerCase().trim();
  return DOC_KEY_MAP[key] || null;
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

// تبديل النقاط بين الأنواع (للمستخدم نفسه)
async function convertPoints(doc, fromTypeRaw, amount, toTypeRaw) {
  ensurePointBuckets(doc);

  const fromKey = normalizePointKey(fromTypeRaw);
  const toKey = normalizePointKey(toTypeRaw);

  if (!fromKey || !toKey) throw new Error('نوع النقاط غير معروف.');
  if (fromKey === toKey) throw new Error('لا يمكن التبديل لنفس النوع.');
  if (amount <= 0) throw new Error('الكمية لازم تكون أكبر من 0.');
  if (doc.points[fromKey] < amount) throw new Error('نقاطك غير كافية.');

  const base = toBaseFromDocKey(fromKey, amount);
  const out = fromBaseToDocKey(toKey, base);

  if (out <= 0) throw new Error('ناتج التبديل أقل من 1.');

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

// تحويل النقاط لشخص آخر
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

  return { docKey, amount };
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

    // خصم النقاط المطلوبة فقط (الزائد يبقى للمرحلة التالية)
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
  ensurePointBuckets
};
