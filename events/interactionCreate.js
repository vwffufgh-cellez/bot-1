const { 
    ChannelType,
    PermissionsBitField,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const claimedTickets = new Set(); // يخزن التكت المستلمة مؤقتاً

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {

        if (!interaction.isButton()) return;

        // 🎫 إنشاء التكت
        if (interaction.customId === 'create_ticket') {

            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages
                        ],
                    },
                    {
                        id: 'ID_SUPPORT_ROLE', // حط ايدي رتبة الدعم
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages
                        ],
                    },
                ],
            });

            const claimBtn = new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('📌 استلام التذكرة')
                .setStyle(ButtonStyle.Success);

            const closeBtn = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('🔒 إغلاق التذكرة')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(claimBtn, closeBtn);

            await channel.send({
                content: `مرحبًا ${interaction.user} 👋`,
                components: [row]
            });

            await interaction.reply({
                content: `✅ تم إنشاء التذكرة: ${channel}`,
                ephemeral: true
            });
        }

        // 📌 استلام التذكرة
        if (interaction.customId === 'claim_ticket') {

            if (!interaction.member.roles.cache.has('ID_SUPPORT_ROLE'))
                return interaction.reply({ content: '❌ ليس لديك صلاحية.', ephemeral: true });

            if (claimedTickets.has(interaction.channel.id))
                return interaction.reply({ content: '⚠️ التذكرة مستلمة بالفعل.', ephemeral: true });

            claimedTickets.add(interaction.channel.id);

            await interaction.channel.send(
                `📌 تم استلام التذكرة بواسطة ${interaction.user}`
            );

            await interaction.reply({
                content: '✅ استلمت التذكرة بنجاح.',
                ephemeral: true
            });
        }

        // 🔒 إغلاق
        if (interaction.customId === 'close_ticket') {

            await interaction.reply({
                content: 'سيتم حذف التذكرة بعد 5 ثواني...',
                ephemeral: true
            });

            setTimeout(() => {
                interaction.channel.delete();
            }, 5000);
        }
    }
};
