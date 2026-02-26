const mongoose = require('mongoose');

const WarningSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true }, // العضو الذي تم تحذيره
    moderatorId: { type: String, required: true }, // الموديريتور الذي أعطى التحذير
    reason: { type: String, required: true },
    timestamp: { type: Date, default: Date.now() },
    warningId: { type: Number, required: true } // رقم تسلسلي للتحدير (للعرض)
});

module.exports = mongoose.model('Warning', WarningSchema);
