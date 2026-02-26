const { EmbedBuilder } = require('discord.js');
const UserXP = require('../models/UserXP');
const { resetIfNeeded } = require('./resetHelpers');

const TEXT_EMOJI = '💬';
const VOICE_EMOJI = '🔊';

const ranges = {
  total: { text: 'textXP', voice: 'voiceXP', label: 'لائحة متصدري نقاط السيرفر' },
  day: { text: 'dailyTextXP', voice: 'dailyVoiceXP', label: 'لائحة متصدري نقاط اليوم' },
  week: { text: 'weeklyTextXP', voice: 'weeklyVoiceXP', label: 'لائحة متصدري نقاط الأسبوع' },
  month: { text: 'monthlyTextXP', voice: 'monthlyVoiceXP', label: 'لائحة متصدري نقاط الشهر' }
};

module.exports = async function sendTopPanel(message, rangeKey) {
  const range = ranges[rangeKey] ?? ranges.total;

  const users = await UserXP.find({ guildId: message.guild.id });
  await Promise.all(users.map(user => resetIfNeeded(user)));

  const top = users
    .map(u => {
      const text = u[range.text] ?? 0;
      const voice = u[range.voice] ?? 0;
      return { userId: u.userId, text, voice, total: text + voice };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const description = top.length
    ? top.map((u, i) => `#${i + 1} | <@${u.userId}>  ${TEXT_EMOJI} ${u.text}  ${VOICE_EMOJI} ${u.voice}`).join('\n')
    : 'لا يوجد بيانات كافية حالياً.';

  const embed = new EmbedBuilder()
    .setColor(0xE01B1B)
    .setAuthor({
      name: range.label,
      iconURL: message.guild.iconURL({ size: 128 }) ?? undefined
    })
    .setDescription(description)
    .setFooter({
      text: `${message.author.tag} • ${new Date().toLocaleString('ar-SA')}`,
      iconURL: message.author.displayAvatarURL({ size: 128 })
    });

  await message.channel.send({ embeds: [embed] });
};
