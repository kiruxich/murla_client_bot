import "dotenv/config";
import { getMiniAppUrl } from "./env.js";
import { initDb } from "./lib/db.js";
import { getBot } from "./telegram-bot.js";

await initDb();

const bot = getBot();

const miniAppUrl = getMiniAppUrl();
if (miniAppUrl) {
  try {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Мурла",
        web_app: { url: miniAppUrl },
      },
    });
  } catch (err) {
    console.warn("Не удалось установить кнопку Mini App (проверьте MINI_APP_URL и домен в @BotFather):", err);
  }
}

await bot.start({
  onStart: (info) => {
    console.log(`Бот @${info.username} запущен (long polling).`);
  },
});
