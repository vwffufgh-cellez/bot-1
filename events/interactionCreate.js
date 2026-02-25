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

    if (!interaction.isButton()) return;
    if (interaction.customId !== 'confirm_claim') return;

    if (!interaction.member.roles.cache.has(SUPPORT_ROLE_ID)) {
      return interaction.reply({
        embeds: [redPanel('This button is restricted to support staff only')],
        ephemeral: true
      });
    }

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

    await TicketClaim.create({
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      adminId: interaction.user.id
    });

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
      embeds: [redPanel('Ticket successfully registered to you')],
      ephemeral: true
    });

    interaction.channel.send({
      embeds: [redPanel(`Ticket claimed by ${interaction.user.username}`)]
    });
  }
};
