const AdminStats = require('../models/AdminStats');

async function getAdmin(guildId, adminId) {

  let data = await AdminStats.findOne({ guildId, adminId });

  if (!data) {
    data = await AdminStats.create({
      guildId,
      adminId
    });
  }

  return data;
}

module.exports = getAdmin;
