const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const TICKET_PREFIX = 'ticket-';

module.exports = {
  name: 'channelCreate',
  async execute(channel) {

    if (!channel.guild) return;
    if (!channel.name.startsWith(TICKET_PREFIX)) return;

    const button = new ButtonBuilder()
      .setCustomId('confirm_claim')
      .setLabel('✅ تأكيد استلام التذكرة')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    channel.send({
      content: '🛠️ **للإدارة:** اضغط الزر لتأكيد استلام هذه التذكرة',
      components: [row]
    });
  }
};
