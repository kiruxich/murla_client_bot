import { Bot } from "grammy";
import { getBotToken } from "./env.js";
import { registerHandlers, type MyContext } from "./bot/register.js";

let botInstance: Bot<MyContext> | null = null;

export const getBot = (): Bot<MyContext> => {
  if (!botInstance) {
    try {
      const token = getBotToken();
      botInstance = new Bot<MyContext>(token);
      registerHandlers(botInstance);
      console.log("✅ Бот инициализирован");
    } catch (err) {
      console.error("❌ Критическая ошибка инициализации бота:", err);
      throw err;
    }
  }
  return botInstance;
};
