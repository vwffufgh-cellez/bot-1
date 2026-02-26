// models/Warning.js
const { Schema, model } = require('mongoose');

const infractionSchema = new Schema({
  caseId: { type: String, required: true },
  moderatorId: { type: String, required: true },
  reason: { type: String, default: 'غير مُحدد' },
  createdAt: { type: Date, default: Date.now }
});

const warningSchema = new Schema({
  guildId: { type: String, index: true },
  userId: { type: String, index: true },
  total: { type: Number, default: 0 },
  infractions: { type: [infractionSchema], default: [] }
});

module.exports = model('Warning', warningSchema);
