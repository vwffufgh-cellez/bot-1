const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const UserXP = require('./models/UserXP');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ================= MongoDB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

// ================= تحميل الأحداث =================
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(`./events/${file}`);
  console.log('[EVENT LOADED]', file, '=>', event.name);
  client.on(event.name, (...args) => event.execute(...args, client));
}

// ================= Weekly Reset =================
// كل يوم أحد الساعة 00:00
cron.schedule('0 0 * * 0', async () => {
  try {
    await UserXP.updateMany(
      {},
      {
        $set: {
          weeklyTextXp: 0,
          weeklyVoiceXp: 0
        }
      }
    );
    console.log('Weekly XP Reset Done');
  } catch (err) {
    console.error('Weekly Reset Error:', err);
  }
});

// ================= Monthly Reset =================
// أول يوم من كل شهر الساعة 00:00
cron.schedule('0 0 1 * *', async () => {
  try {
    await UserXP.updateMany(
      {},
      {
        $set: {
          monthlyTextXp: 0,
          monthlyVoiceXp: 0
        }
      }
    );
    console.log('Monthly XP Reset Done');
  } catch (err) {
    console.error('Monthly Reset Error:', err);
  }
});

// ================= Ready =================
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
