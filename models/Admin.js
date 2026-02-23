const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  rank: { type: String, default: "مشرف" },

  ticketsHandled: { type: Number, default: 0 },
  adminXP: { type: Number, default: 0 },
  warningsGiven: { type: Number, default: 0 },

  penaltyLevel: { type: Number, default: 0 }, // مستوى التحذير عليه
  completedMissions: { type: Number, default: 0 }
});

module.exports = mongoose.model("Admin", adminSchema);
