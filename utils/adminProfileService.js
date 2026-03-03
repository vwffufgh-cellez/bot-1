const AdminProfile = require('../models/AdminProfile');
const {
  SUPPORT_ROLE_ID,
  LEVEL_CONFIGS
} = require('../config/adminProgressConfig');

function getAdminRoleIds() {
  const set = new Set([String(SUPPORT_ROLE_ID)]);
  for (const cfg of LEVEL_CONFIGS || []) {
    for (const r of cfg.roles || []) set.add(String(r));
  }
  return set;
}

function hasAdminRole(member) {
  if (!member?.roles?.cache) return false;
  const adminRoles = getAdminRoleIds();
  for (const roleId of adminRoles) {
    if (member.roles.cache.has(roleId)) return true;
  }
  return false;
}

function normalize(v = '') {
  return String(v).toLowerCase().trim();
}

async function upsertAdminProfile(member) {
  if (!member?.guild?.id || !member?.user?.id) return;

  const guildId = member.guild.id;
  const user = member.user;
  const isAdmin = hasAdminRole(member);

  const names = [
    user.username,
    user.tag,
    user.globalName,
    member.displayName
  ].filter(Boolean).map(normalize);

  let doc = await AdminProfile.findOne({ guildId, userId: user.id });

  if (!doc) {
    await AdminProfile.create({
      guildId,
      userId: user.id,
      username: user.username || '',
      tag: user.tag || '',
      globalName: user.globalName || '',
      displayName: member.displayName || '',
      avatarURL: user.displayAvatarURL?.({ size: 256 }) || '',
      isAdmin,
      aliases: [...new Set(names)],
      lastSeenAt: new Date()
    });
    return;
  }

  const mergedAliases = [...new Set([...(doc.aliases || []), ...names])];

  doc.username = user.username || doc.username;
  doc.tag = user.tag || doc.tag;
  doc.globalName = user.globalName || doc.globalName;
  doc.displayName = member.displayName || doc.displayName;
  doc.avatarURL = user.displayAvatarURL?.({ size: 256 }) || doc.avatarURL;
  doc.isAdmin = isAdmin;
  doc.aliases = mergedAliases.slice(0, 50);
  doc.lastSeenAt = new Date();

  await doc.save();
}

async function findAdminProfileByText(guildId, text) {
  const q = normalize(text);
  if (!q) return null;

  if (/^\d{15,21}$/.test(q)) {
    return AdminProfile.findOne({ guildId, userId: q });
  }

  return AdminProfile.findOne({
    guildId,
    $or: [
      { username: new RegExp(`^${q}$`, 'i') },
      { tag: new RegExp(`^${q}$`, 'i') },
      { globalName: new RegExp(`^${q}$`, 'i') },
      { displayName: new RegExp(`^${q}$`, 'i') },
      { aliases: q }
    ]
  });
}

module.exports = {
  hasAdminRole,
  upsertAdminProfile,
  findAdminProfileByText
};
