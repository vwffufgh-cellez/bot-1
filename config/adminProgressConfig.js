// config/adminProgressConfig.js
module.exports = {
  PROMOTION_LOG_CHANNEL_ID: '1463932026595053641',
  
  // رتبة الإدارة الأساسية
  SUPPORT_ROLE_ID: '1445473101629493383',

  ADMIN_LEVELS: [
    { level: 1, roleId: '1445473101629493383', name: 'إداري مبتدئ', req: { tickets: 15, warns: 10, xp: 3000 } },
    { level: 2, roleId: '1445473101629493383', name: 'إداري 2', req: { tickets: 20, warns: 15, xp: 5000 } },
    { level: 3, roleId: '1445473101629493383', name: 'إداري 3', req: { tickets: 25, warns: 20, xp: 6000 } },
    { level: 4, roleId: '1445473101629493383', name: 'إداري 4', req: { tickets: 30, warns: 25, xp: 7000 } },
    { level: 5, roleId: '1445473101629493383', name: 'إداري 5', req: { tickets: 35, warns: 30, xp: 8000 } },
    { level: 6, roleId: '1445473101629493383', name: 'إداري 6', req: { tickets: 40, warns: 35, xp: 9000 } },
    { level: 7, roleId: '1445473101629493383', name: 'إداري 7', req: { tickets: 45, warns: 40, xp: 10000 } },
    { level: 8, roleId: '1445473101629493383', name: 'إداري 8', req: { tickets: 50, warns: 50, xp: 11000 } }
  ],

 TRANSFER_ALIASES: {
  tickets: ['تكت', 'تداكر', 'تذاكر', 'تكتات', 'ticket', 'tickets', 'ت'],
  warns: ['تحذير', 'تحذيرات', 'تحدير', 'تحديرات', 'warn', 'warns', 'و'],
  xp: ['اكسبي', 'XP', 'xp', 'خبرة', 'اكس', 'x']
}

  POINT_VALUE: {
    ticket: 300,
    warn: 150,
    xp: 1
  },

  // إضافة اختصارات الأوامر
  ALIASES: {
    TASKS: ['المهام', 'مهام'],
    STATS: ['ستات', 'stats'],
    CONVERT: ['تحويل', 'convert']
  },

  // اختصارات أنواع النقاط للتحويل والتحويلات
  TRANSFER_ALIASES: {
    tickets: ['تكت', 'تداكر', 'تذاكر', 'تكتات', 'ticket', 'tickets', 'ت'},
    warns: ['تحذير', 'تحذيرات', 'تحدير', 'تحديرات', 'warn', 'warns', 'و'],
    xp: ['اكسبي', 'XP', 'xp', 'خبرة', 'اكس', 'x']
  }
};
