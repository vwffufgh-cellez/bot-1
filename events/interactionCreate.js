const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');

const SUPPORT_ROLE_ID = '1445473101629493383';

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {

    if (!interaction.isButton()) return;
    if (interaction.customId !== 'confirm_claim') return;

    // تحقق من الرتبة
    if (!interaction.member.roles.cache.has(SUPPORT_ROLE_ID)) {
      return interaction.reply({
        content: '❌ هذا الزر مخصص للإدارة فقط',
        ephemeral: true
      });
    }

    // تحقق هل التكت مستلم
    const existing = await TicketClaim.findOne({
      guildId: interaction.guild.id,
      channelId: interaction.channel.id
    });

    if (existing) {
      return interaction.reply({
        content: '⚠️ هذه التذكرة مستلمة بالفعل',
        ephemeral: true
      });
    }

    // تسجيل الاستلام
    await TicketClaim.create({
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      adminId: interaction.user.id
    });

    // تحديث الإحصائيات
    let stats = await AdminStats.findOne({
      guildId: interaction.guild.id,
      adminId: interaction.user.id
    });

    if (!stats) {
      stats = new AdminStats({
        guildId: interaction.guild.id,
        adminId: interaction.user.id
      });
    }

    stats.ticketsClaimed += 1;
    stats.xp += 5;
    await stats.save();

    await interaction.reply({
      content: `✅ تم تسجيل التذكرة لك ${interaction.user}`,
      ephemeral: true
    });

    interaction.channel.send(
      `📌 **تم استلام التذكرة بواسطة:** ${interaction.user}`
    );
  }
};
