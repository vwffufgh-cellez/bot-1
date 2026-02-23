const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.prefixCommands = new Collection();
client.slashCommands = new Collection();

const prefix = "!";

// ================= MongoDB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error(err));

// ================= تحميل أوامر Prefix =================
const prefixFiles = fs.readdirSync('./commands/prefix').filter(file => file.endsWith('.js'));

for (const file of prefixFiles) {
  const command = require(`./commands/prefix/${file}`);
  client.prefixCommands.set(command.name, command);
}

// ================= تحميل أوامر Slash =================
const slashFiles = fs.readdirSync('./commands/slash').filter(file => file.endsWith('.js'));

for (const file of slashFiles) {
  const command = require(`./commands/slash/${file}`);
  client.slashCommands.set(command.data.name, command);
}

// ================= Event الرسائل =================
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.prefixCommands.get(commandName);
  if (!command) return;

  command.execute(message, args);
});

// ================= Event Slash =================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.slashCommands.get(interaction.commandName);
  if (!command) return;

  await command.execute(interaction);
});

client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
