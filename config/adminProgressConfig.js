module.exports = {
  PROMOTION_LOG_CHANNEL_ID: 'PUT_LOG_CHANNEL_ID_HERE',

  // رتب الإدارة الأساسية (بالترتيب من 1 إلى 8)
  ADMIN_LEVELS: [
    { level: 1, roleId: '1445473101629493383', name: 'إداري مبتدئ', req: { tickets: 15, warns: 10, xp: 3000 } },
    { level: 2, roleId: 'ROLE_L2', name: 'إداري 2', req: { tickets: 20, warns: 15, xp: 5000 } },
    { level: 3, roleId: 'ROLE_L3', name: 'إداري 3', req: { tickets: 25, warns: 20, xp: 6000 } },
    { level: 4, roleId: 'ROLE_L4', name: 'إداري 4', req: { tickets: 30, warns: 25, xp: 7000 } },
    { level: 5, roleId: 'ROLE_L5', name: 'إداري 5', req: { tickets: 35, warns: 30, xp: 8000 } },
    { level: 6, roleId: 'ROLE_L6', name: 'إداري 6', req: { tickets: 40, warns: 35, xp: 9000 } },
    { level: 7, roleId: 'ROLE_L7', name: 'إداري 7', req: { tickets: 45, warns: 40, xp: 10000 } },
    { level: 8, roleId: 'ROLE_L8', name: 'إداري 8', req: { tickets: 50, warns: 50, xp: 11000 } }
  ],

  // 3 رتب تحذير الإدارة + نسبة زيادة الصعوبة
  ADMIN_WARN_TIERS: [
    { roleId: '1445473102359167187', multiplier: 1.4, label: 'تحذير إداري أول' },
    { roleId: 'WARN_ROLE_2', multiplier: 1.6, label: 'تحذير إداري ثاني' },
    { roleId: 'WARN_ROLE_3', multiplier: 1.9, label: 'تحذير إداري ثالث' }
  ],

  // التحويلات (قيم مرجعية)
  // 1 تكت = 2 تحذير = 300 XP
  POINT_VALUE: {
    ticket: 300,
    warn: 150,
    xp: 1
  },

  // أوامر
  ALIASES: {
    TASKS: ['المهام', 'مهام'],
    STATS: ['ستات', 'stats'],
    CONVERT: ['تحويل', 'convert']
  }
};
