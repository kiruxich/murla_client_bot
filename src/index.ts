import "dotenv/config";
import { initDb } from "./lib/db.js";
import { getBot } from "./telegram-bot.js";

await initDb();

const bot = getBot();

await bot.start({
  onStart: (info) => {
    console.log(`Бот @${info.username} запущен (long polling).`);
  },
});
