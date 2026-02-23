const { Schema, model } = require("mongoose");

const guildSchema = new Schema({
  guildId: { type: String, required: true, unique: true },

  promotionChannel: { type: String },
  leaveChannel: { type: String },

  roles: {
    level1: { type: String },
    level2: { type: String },
    level3: { type: String }
  },

  settings: {
    baseTickets: { type: Number, default: 10 },
    baseXP: { type: Number, default: 3000 },
    baseWarnings: { type: Number, default: 3 }
  }
});

module.exports = model("Guild", guildSchema);
