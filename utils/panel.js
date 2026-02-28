const { EmbedBuilder } = require('discord.js');

const redPanel = (text, title = null) => {
  const e = new EmbedBuilder().setColor(0xff0000).setDescription(`**${text}**`);
  if (title) e.setTitle(title);
  return e;
};

module.exports = { redPanel };
