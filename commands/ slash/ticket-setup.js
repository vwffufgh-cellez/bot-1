const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const TicketSetup = require('../../models/TicketSetup'); // بنسويه بعد شوي

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('إعداد نظام التذاكر')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addStringOption(option =>
      option.setName('ticket')
        .setDescription('اختر رقم التكت')
        .setRequired(true)
        .addChoices(
          { name: 'Ticket 1', value: '1' },
          { name: 'Ticket 2', value: '2' },
          { name: 'Ticket 3', value: '3' },
          { name: 'Ticket 4', value: '4' },
          { name: 'Ticket 5', value: '5' },
          { name: 'Ticket 6', value: '6' },
          { name: 'Ticket 7', value: '7' },
          { name: 'Ticket 8', value: '8' },
          { name: 'Ticket 9', value: '9' },
          { name: 'Ticket 10', value: '10' },
        )
    )

    .addStringOption(option =>
      option.setName('name')
        .setDescription('اسم التكت')
    )

    .addChannelOption(option =>
      option.setName('category')
        .setDescription('قسم فتح التكت')
    )

    .addRoleOption(option =>
      option.setName('role')
        .setDescription('رتبة الدعم')
    ),

  async execute(interaction) {

    const ticketNumber = interaction.options.getString('ticket');
    const name = interaction.options.getString('name');
    const category = interaction.options.getChannel('category');
    const role = interaction.options.getRole('role');

    let data = await TicketSetup.findOne({
      guildId: interaction.guild.id,
      ticketNumber
    });

    if (!data) {
      data = new TicketSetup({
        guildId: interaction.guild.id,
        ticketNumber
      });
    }

    if (name) data.name = name;
    if (category) data.category = category.id;
    if (role) data.role = role.id;

    await data.save();

    await interaction.reply({
      content: `✅ تم تحديث إعدادات Ticket ${ticketNumber}`,
      ephemeral: true
    });
  }
};
