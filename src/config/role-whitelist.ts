import type { BotRole } from "../lib/roles.js";

/**
 * Белый список Telegram user id по ролям — правьте массивы вручную в коде.
 * Узнать id: @userinfobot, лог `ctx.from.id` в dev.
 * Пустой массив = никто не может переключиться на эту роль.
 * Роль `client` в коде доступна всем (см. `canUseRole`); массив ниже для явного учёта не используется.
 */
export const ROLE_WHITELIST: Record<BotRole, readonly number[]> = {
  client: [],
  packer: [],
  driver: [],
  manager: [],
  supervisor: [],
} as const;

export const canAccessRole = (telegramUserId: number, role: BotRole): boolean =>
  ROLE_WHITELIST[role].includes(telegramUserId);
