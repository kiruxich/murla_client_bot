/**
 * Роли бота. Редактируйте подписи в UI отдельно; здесь — только идентификаторы.
 *
 * **Менеджер и управляющий** (`manager` / `supervisor`) в боте имеют **одинаковые** возможности
 * (все заявки, отчёт, заявка за клиента и т.д.). Различаются только подписью в интерфейсе и
 * отдельными массивами в `ROLE_WHITELIST` — при выдаче доступа при необходимости укажите id в обоих.
 */
export const BOT_ROLES = [
  "client",
  "packer",
  "driver",
  "manager",
  "supervisor",
] as const;

export type BotRole = (typeof BOT_ROLES)[number];

export const isBotRole = (value: string): value is BotRole =>
  (BOT_ROLES as readonly string[]).includes(value);

/** Менеджер или управляющий — одна группа прав в коде бота. */
export const isManagerLikeRole = (role: BotRole): boolean =>
  role === "manager" || role === "supervisor";
