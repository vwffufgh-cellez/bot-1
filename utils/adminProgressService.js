const { EmbedBuilder } = require('discord.js');
const AdminProgress = require('../models/AdminProgress');
const { LEVEL_CONFIGS, POINT_TYPE_ALIASES } = require('../config/adminProgressConfig');

const SUPPORT_ROLE_ID = '1445473101629493383';
const PROMOTION_CHANNEL_ID = '1463932101496799252';
const SERVER_IMAGE_URL = 'https://cdn.discordapp.com/attachments/1390932617645260872/1391661420558422156/Picsart_25-07-07_09-05-01-827.png?ex=69a528b2&is=69a3d732&hm=1afa0cca211ad776f4f300106b39daa4f94427cc3c093f352a14f725d26c35bf';

async function getOrCreate(guildId, adminId) {
  let doc = await AdminProgress.findOne({ guildId, adminId });
  if (!doc) {
    doc = new AdminProgress({ guildId, adminId });
    await doc.save();
  }
  return doc;
}

async function addPoints({ guildId, userId, xp = 0, tickets = 0, warns = 0 }) {
  const doc = await getOrCreate(guildId, userId);

  if (xp > 0) {
    doc.points.xp += xp;
    doc.lifetime.xp += xp;
  }
  if (tickets > 0) {
    doc.points.tickets += tickets;
    doc.lifetime.tickets += tickets;
  }
  if (warns > 0) {
    doc.points.warns += warns;
    doc.lifetime.warns += warns;
  }

  await doc.save();
  return doc;
}

async function setPoints({ guildId, userId, pointType, amount }) {
  const doc = await getOrCreate(guildId, userId);
  
  const oldValue = doc.points[pointType] || 0;
  const difference = amount - oldValue;
  
  doc.points[pointType] = amount;
  
  if (difference > 0) {
    doc.lifetime[pointType] = (doc.lifetime[pointType] || 0) + difference;
  }
  
  if (doc.points[pointType] < 0) doc.points[pointType] = 0;
  
  await doc.save();
  return { doc, oldValue, newValue: amount, difference };
}

function getMultiplier(member) {
  return 1.0;
}

function getLevelConfig(level) {
  return LEVEL_CONFIGS.find(cfg => cfg.level === level) || null;
}

function getNextLevelConfig(currentLevel) {
  return LEVEL_CONFIGS.find(cfg => cfg.level === currentLevel + 1) || null;
}

function scaledReq(req, multiplier) {
  return {
    tickets: Math.ceil(req.tickets * multiplier),
    warns: Math.ceil(req.warns * multiplier),
    xp: Math.ceil(req.xp * multiplier)
  };
}

function normalizePointKey(key) {
  if (!key) return null;
  const lower = key.toLowerCase();
  for (const [type, aliases] of Object.entries(POINT_TYPE_ALIASES)) {
    if (aliases.includes(lower)) return type;
  }
  return null;
}

async function convertPoints(doc, fromType, amount, toType) {
  const fromKey = normalizePointKey(fromType);
  const toKey = normalizePointKey(toType);
  
  if (!fromKey || !toKey) throw new Error('**نوع النقاط غير معروف.**');
  if (fromKey === toKey) throw new Error('**لا يمكن التبديل لنفس النوع.**');
  if (doc.points[fromKey] < amount) throw new Error('**لا تملك نقاط كافية للتبديل.**');

  doc.points[fromKey] -= amount;
  doc.points[toKey] += amount;
  await doc.save();

  return { fromKey, toKey, amountIn: amount, amountOut: amount };
}

async function transferPoints(fromDoc, toDoc, typeArg, amount) {
  const key = normalizePointKey(typeArg);
  if (!key) throw new Error('**نوع النقاط غير معروف.**');
  if (fromDoc.points[key] < amount) throw new Error('**لا تملك نقاط كافية للتحويل.**');

  fromDoc.points[key] -= amount;
  toDoc.points[key] += amount;
  toDoc.lifetime[key] += amount;
  
  await fromDoc.save();
  await toDoc.save();

  return { docKey: key, amount };
}

async function tryPromote(interactionOrMessage, member) {
  if (!member || !member.guild) return;

  const guild = member.guild;
  const guildId = guild.id;
  const adminId = member.id;

  const doc = await getOrCreate(guildId, adminId);
  const multiplier = getMultiplier(member);
  const nextCfg = getNextLevelConfig(doc.level);
  
  if (!nextCfg) return;

  const req = scaledReq(nextCfg.req, multiplier);
  
  const canPromote = 
    doc.points.tickets >= req.tickets &&
    doc.points.warns >= req.warns &&
    doc.points.xp >= req.xp;

  if (!canPromote) return;

  const currentCfg = getLevelConfig(doc.level);
  const oldRoles = currentCfg?.roles || [];
  const newRoles = nextCfg.roles || [];

  const previousLevel = doc.level;
  doc.level += 1;
  doc.promotedAt = new Date();
  await doc.save();

  const rolesToRemove = oldRoles.filter(r => !newRoles.includes(r));
  const rolesToAdd = newRoles.filter(r => !oldRoles.includes(r));

  for (const roleId of rolesToRemove) {
    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
      }
    } catch (err) {
      console.error('Error removing role:', roleId, err.message);
    }
  }

  for (const roleId of rolesToAdd) {
    try {
      const role = guild.roles.cache.get(roleId);
      if (role && !member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
      }
    } catch (err) {
      console.error('Error adding role:', roleId, err.message);
    }
  }

  const promotionChannel = guild.channels.cache.get(PROMOTION_CHANNEL_ID);
  
  if (promotionChannel) {
    const oldRolesText = oldRoles.length > 0 
      ? oldRoles.map(id => `<@&${id}>`).join(' , ') 
      : '**لا يوجد**';
    
    const newRolesText = newRoles.length > 0 
      ? newRoles.map(id => `<@&${id}>`).join(' , ') 
      : '**لا يوجد**';
    
    const removedRolesText = rolesToRemove.length > 0 
      ? rolesToRemove.map(id => `<@&${id}>`).join(' , ') 
      : '**لا يوجد**';

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('🎉 **ترقية إداري جديدة**')
      .setDescription(`<@&${SUPPORT_ROLE_ID}>`)
      .addFields(
        {
          name: '**👤 الإداري**',
          value: `**تمت ترقية الإداري <@${adminId}> بنجاح!**`,
          inline: false
        },
        {
          name: '**📈 المستوى**',
          value: `**من Level ${previousLevel} إلى Level ${doc.level}**`,
          inline: false
        },
        {
          name: '**🏆 الرتب الجديدة**',
          value: `**${newRolesText}**`,
          inline: false
        },
        {
          name: '**📋 الرتب السابقة**',
          value: `**${oldRolesText}**`,
          inline: false
        },
        {
          name: '**🗑️ الرتب المُزالة**',
          value: `**${removedRolesText}**`,
          inline: false
        }
      )
      .setImage(SERVER_IMAGE_URL)
      .setFooter({
        text: `ترقية ${member.user.tag} إلى ${nextCfg.name}`,
        iconURL: member.displayAvatarURL({ size: 128 })
      })
      .setTimestamp();

    try {
      await promotionChannel.send({ 
        content: `<@&${SUPPORT_ROLE_ID}>`,
        embeds: [embed],
        allowedMentions: { roles: [SUPPORT_ROLE_ID] }
      });
    } catch (err) {
      console.error('Error sending promotion message:', err.message);
    }
  }

  try {
    if (interactionOrMessage.channel) {
      const replyEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setDescription(`**🎉 مبروك <@${adminId}>! تمت ترقيتك إلى ${nextCfg.name}!**`);
      
      await interactionOrMessage.channel.send({ 
        embeds: [replyEmbed],
        allowedMentions: { parse: [] }
      });
    }
  } catch (err) {
    console.error('Error sending promotion reply:', err.message);
  }
}

module.exports = {
  getOrCreate,
  addPoints,
  setPoints,
  tryPromote,
  getMultiplier,
  getLevelConfig,
  getNextLevelConfig,
  scaledReq,
  normalizePointKey,
  convertPoints,
  transferPoints
};
