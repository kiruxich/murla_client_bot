import { Bot } from "grammy";
import { getBotToken } from "./env.js";
import { registerHandlers, type MyContext } from "./bot/register.js";

let botInstance: Bot<MyContext> | null = null;

export const getBot = (): Bot<MyContext> => {
  if (!botInstance) {
    botInstance = new Bot<MyContext>(getBotToken());
    registerHandlers(botInstance);
  }
  return botInstance;
};
