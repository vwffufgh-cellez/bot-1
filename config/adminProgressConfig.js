// config/adminProgressConfig.js

const SUPPORT_ROLE_ID = '1445473101629493383';

const ADMIN_LEVELS = [
  { level: 1, roleId: '1445473101629493383', name: 'إداري مبتدئ', req: { tickets: 15, warns: 10, xp: 3000 } },
  { level: 2, roleId: 1453212249375244410, name: 'إداري 2', req: { tickets: 20, warns: 15, xp: 5000 } },
  { level: 3, roleId: 1445473097888170105, name: 'إداري 3', req: { tickets: 25, warns: 20, xp: 6000 } },
  { level: 4, roleId: 1445473095811989524, name: 'إداري 4', req: { tickets: 30, warns: 25, xp: 7000 } },
  { level: 5, roleId: SUPPORT_ROLE_ID, name: 'إداري 5', req: { tickets: 35, warns: 30, xp: 8000 } },
  { level: 6, roleId: SUPPORT_ROLE_ID, name: 'إداري 6', req: { tickets: 40, warns: 35, xp: 9000 } },
  { level: 7, roleId: SUPPORT_ROLE_ID, name: 'إداري 7', req: { tickets: 45, warns: 40, xp: 10000 } },
  { level: 8, roleId: SUPPORT_ROLE_ID, name: 'إداري 8', req: { tickets: 50, warns: 50, xp: 11000 } }
];

// نسخة متوافقة مع الأكواد التي تعتمد LEVEL_CONFIGS (roles[])
const LEVEL_CONFIGS = ADMIN_LEVELS.map(lvl => ({
  level: lvl.level,
  name: lvl.name,
  req: lvl.req,
  roles: lvl.roleId ? [lvl.roleId] : []
}));

module.exports = {
  // قنوات الترقية
  PROMOTION_LOG_CHANNEL_ID: '1463932026595053641',
  PROMOTION_ANNOUNCE_CHANNEL_ID: '1463932101496799252',

  SUPPORT_ROLE_ID,

  // إعدادات المستويات الأصلية
  ADMIN_LEVELS,

  // إعدادات متوافقة مع الخدمات الجديدة
  LEVEL_CONFIGS,

  ADMIN_WARN_TIERS: [
    { roleId: '1445473102359167187', multiplier: 1.6, label: 'تحذير إداري أول' },
    { roleId: '1445473103319924797', multiplier: 1.8, label: 'تحذير إداري ثاني' },
    { roleId: '1445473104301265036', multiplier: 2.1, label: 'تحذير إداري ثالث' }
  ],

  POINT_VALUE: {
    ticket: 300,
    warn: 150,
    xp: 1
  },

  ALIASES: {
    TASKS: ['المهام', 'مهام', 'tasks', 'task', 'مهمة'],
    STATS: ['ستات', 'stats', 'stat', 'استات', 'إحصائيات', 'احصائيات', 'بطاقة'],
    CONVERT: ['تبديل', 'بدل', 'exchange', 'swap', 'switch', 'convert', 'تحويل_نوع'],
    TRANSFER: ['تحويل', 'حول', 'transfer', 'send', 'تحويل_نقاط'],
    EDIT: ['تعديل', 'edit', 'mod', 'set', 'اضبط', 'عدل']
  },

  POINT_TYPE_ALIASES: {
    tickets: ['تكت', 'تذاكر', 'تكتات', 'تذكرة', 'ticket', 'tickets', 'tkt'],
    warns: ['تحذير', 'تحذيرات', 'تحدير', 'تحديرات', 'تحذيراتك', 'warn', 'warns', 'warning', 'warnings'],
    xp: ['اكسبي', 'xp', 'خبرة', 'خبره', 'اكس_بي', 'exp', 'experience']
  }
};
