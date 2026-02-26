const { Schema, model } = require('mongoose');

const userXPSchema = new Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },

  textXP: { type: Number, default: 0 },
  voiceXP: { type: Number, default: 0 },

  dailyTextXP: { type: Number, default: 0 },
  dailyVoiceXP: { type: Number, default: 0 },

  weeklyTextXP: { type: Number, default: 0 },
  weeklyVoiceXP: { type: Number, default: 0 },

  monthlyTextXP: { type: Number, default: 0 },
  monthlyVoiceXP: { type: Number, default: 0 },

  lastDailyReset: { type: Date, default: null },
  lastWeeklyReset: { type: Date, default: null },
  lastMonthlyReset: { type: Date, default: null }
});

userXPSchema.statics.getOrCreate = async function (guildId, userId) {
  let doc = await this.findOne({ guildId, userId });
  if (!doc) {
    doc = await this.create({ guildId, userId });
  }
  return doc;
};

module.exports = model('UserXP', userXPSchema);
