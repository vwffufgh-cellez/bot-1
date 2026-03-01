const { EmbedBuilder } = require('discord.js');
const TicketClaim = require('../models/TicketClaim');
const { addPoints, tryPromote } = require('../utils/adminProgressService');

const SUPPORT_ROLE_ID = '1445473101629493383';

function redPanel(text) {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setDescription(`**${text}**`);
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'confirm_claim') return;

    if (!interaction.member.roles.cache.has(SUPPORT_ROLE_ID)) {
      return interaction.reply({
        embeds: [redPanel('هذا الزر مخصص لفريق الدعم فقط.')],
        ephemeral: true
      });
    }

    try {
      const existing = await TicketClaim.findOne({
        guildId: interaction.guild.id,
        channelId: interaction.channel.id
      });

      if (existing) {
        return interaction.reply({
          embeds: [redPanel('هذه التذكرة مستلمة مسبقاً.')],
          ephemeral: true
        });
      }

      await TicketClaim.create({
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        claimedById: interaction.user.id,
        claimedAt: new Date()
      });

      await addPoints({ guildId: interaction.guild.id, userId: interaction.user.id, tickets: 1 });
      await tryPromote(interaction, interaction.member);

      await interaction.reply({
        embeds: [redPanel('تم تسجيل التذكرة باسمك بنجاح.')],
        ephemeral: true
      });

      await interaction.channel.send({
        embeds: [redPanel(`تم استلام التذكرة بواسطة ${interaction.user.username}`)]
      });

    } catch (error) {
      console.error('Error in confirm_claim button:', error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [redPanel('حدث خطأ أثناء استلام التذكرة.')],
          ephemeral: true
        });
      } else {
        await interaction.followUp({
          embeds: [redPanel('حدث خطأ أثناء استلام التذكرة.')],
          ephemeral: true
        });
      }
    }
  }
};
