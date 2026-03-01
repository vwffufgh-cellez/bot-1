const { EmbedBuilder } = require('discord.js');
const TicketClaim = require('../models/TicketClaim');
const AdminStats = require('../models/AdminStats');

const SUPPORT_ROLE_ID = '1445473101629493383';

function redPanel(text) {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setDescription(`**${text}**`);
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // نتأكد أن التفاعل زر وبالـ customId الصحيح
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'confirm_claim') return;

    // التحقق من رتبة الدعم
    if (!interaction.member.roles.cache.has(SUPPORT_ROLE_ID)) {
      return interaction.reply({
        embeds: [redPanel('This button is restricted to support staff only')],
        ephemeral: true
      });
    }

    try {
      // التحقق إذا التكت مأخوذ مسبقاً
      const existing = await TicketClaim.findOne({
        guildId: interaction.guild.id,
        channelId: interaction.channel.id
      });

      if (existing) {
        return interaction.reply({
          embeds: [redPanel('This ticket has already been claimed')],
          ephemeral: true
        });
      }

      // هنا التعديل المهم 👇
      // تغيير adminId إلى claimedById ليتطابق مع الموديل الجديد
      await TicketClaim.create({
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        claimedById: interaction.user.id
        // إذا في عندك حقل claimedAt في الموديل يمديك تضيف:
        // claimedAt: new Date()
      });

      // إحصائيات الأدمن
      let stats = await AdminStats.findOne({
        guildId: interaction.guild.id,
        adminId: interaction.user.id   // هذا ابقه كما هو إذا الموديل ما تغيّر
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

      // رد مخفي لصاحب الزر
      await interaction.reply({
        embeds: [redPanel('Ticket successfully registered to you')],
        ephemeral: true
      });

      // رسالة في التكت نفسه
      await interaction.channel.send({
        embeds: [redPanel(`Ticket claimed by ${interaction.user.username}`)]
      });

    } catch (error) {
      console.error('Error in confirm_claim button:', error);

      // لو صار أي خطأ نرسل رد بدال ما يظهر "This interaction failed"
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [redPanel('An error occurred while claiming this ticket')],
          ephemeral: true
        });
      } else {
        await interaction.followUp({
          embeds: [redPanel('An error occurred while claiming this ticket')],
          ephemeral: true
        });
      }
    }
  }
};
