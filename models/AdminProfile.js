const { Schema, model } = require('mongoose');

const AdminProfileSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },

    username: { type: String, default: '' },
    tag: { type: String, default: '' },
    globalName: { type: String, default: '' },
    displayName: { type: String, default: '' },

    avatarURL: { type: String, default: '' },
    isAdmin: { type: Boolean, default: false },

    aliases: { type: [String], default: [] },

    lastSeenAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

AdminProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });
AdminProfileSchema.index({ guildId: 1, aliases: 1 });

module.exports = model('AdminProfile', AdminProfileSchema);
