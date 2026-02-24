const { REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const commands = [];
const slashPath = path.join(__dirname, 'commands', 'slash');
const slashFiles = fs.readdirSync(slashPath).filter(file => file.endsWith('.js'));

for (const file of slashFiles) {
  const command = require(`./commands/slash/${file}`);
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🔄 جاري تسجيل أوامر السلاش...');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log('✅ تم تسجيل الأوامر بنجاح!');
  } catch (error) {
    console.error(error);
  }
})();
