/**
 * Роли бота. Редактируйте подписи в UI отдельно; здесь — только идентификаторы.
 * `manager` — менеджер; `supervisor` — управляющий (отдельная роль, тоже отчёты).
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
