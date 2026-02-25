const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const TICKET_PREFIX = 'ticket-';

function redPanel(text) {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setDescription(`**${text}**`);
}

module.exports = {
  name: 'channelCreate',
  async execute(channel) {

    if (!channel.guild) return;
    if (!channel.name.startsWith(TICKET_PREFIX)) return;

    const button = new ButtonBuilder()
      .setCustomId('confirm_claim')
      .setLabel('✅تأكيد استلام التذكرة')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(button);

    channel.send({
      embeds: [
        redPanel('للإدارة فقط\nاضغط الزر بالأسفل لتأكيد استلام هذه التذكرة')
      ],
      components: [row]
    });
  }
};
