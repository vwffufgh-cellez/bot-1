// models/AdminProgress.js
const mongoose = require('mongoose');

const AdminProgressSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    adminId: { type: String, required: true },

    level: { type: Number, default: 0 },

    points: {
      tickets: { type: Number, default: 0 },
      warns: { type: Number, default: 0 },
      xp: { type: Number, default: 0 }
    },

    lifetime: {
      tickets: { type: Number, default: 0 },
      warns: { type: Number, default: 0 },
      xp: { type: Number, default: 0 }
    },

    promotedAt: { type: Date }
  },
  { timestamps: true }
);

AdminProgressSchema.index({ guildId: 1, adminId: 1 }, { unique: true });

module.exports = mongoose.model('AdminProgress', AdminProgressSchema);
