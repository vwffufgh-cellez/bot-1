const { Schema, model } = require('mongoose');

const adminProgressSchema = new Schema(
  {
    guildId: { type: String, index: true, required: true },
    userId: { type: String, index: true, required: true },

    // المستوى الحالي (0 = قبل أول ترقية)
    level: { type: Number, default: 0 },

    // نقاط قابلة للتحويل/الصرف (الاعتماد عليها في المهام)
    points: {
      tickets: { type: Number, default: 0 },
      warns: { type: Number, default: 0 },
      xp: { type: Number, default: 0 }
    },

    // إحصائيّات كلية (للعرض فقط)
    lifetime: {
      tickets: { type: Number, default: 0 },
      warns: { type: Number, default: 0 },
      xp: { type: Number, default: 0 }
    },

    promotedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

adminProgressSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = model('AdminProgress', adminProgressSchema);
