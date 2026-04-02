import type { BotRole } from "../lib/roles.js";

/**
 * Белый список Telegram user id по ролям — правьте массивы вручную в коде.
 * Узнать id: @userinfobot, лог `ctx.from.id` в dev.
 * Пустой массив = никто не может переключиться на эту роль (кроме пользователей из
 * `ROLE_ALWAYS_SWITCH_IDS` / `ROLE_LOCK_FIRST_IDS` в `.env` — им все роли, см. `canUseRole`).
 * Роль `client` в коде доступна всем; массив `client` ниже для явного учёта не используется.
 *
 * `manager` и `supervisor` дают **одинаковый** доступ в боте; если нужны обе «должности»,
 * продублируйте один и тот же id в обоих массивах (или оставьте только одну роль пользователю).
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
