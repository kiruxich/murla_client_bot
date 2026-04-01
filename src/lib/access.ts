import { canAccessRole } from "../config/role-whitelist.js";
import type { BotRole } from "./roles.js";

/** Полный мок: любой может выбрать любую роль. В прод выключить (`false` или не `true`). */
export const isFullWhitelistBypass = (): boolean =>
  process.env.WHITELIST_BYPASS === "true" || process.env.WHITELIST_BYPASS === "1";

const parseTelegramIdList = (raw: string | undefined): Set<number> => {
  const set = new Set<number>();
  if (!raw?.trim()) {
    return set;
  }
  for (const part of raw.split(",")) {
    const n = Number(part.trim());
    if (!Number.isNaN(n)) {
      set.add(n);
    }
  }
  return set;
};

/**
 * ID из `ROLE_ALWAYS_SWITCH_IDS` + необязательный shorthand: в `WHITELIST_BYPASS` перечислить
 * только цифры через запятую (не `true`) — те же пользователи могут **каждый раз** заново выбирать роль.
 */
export const getAlwaysSwitchUserIds = (): Set<number> => {
  const set = parseTelegramIdList(process.env.ROLE_ALWAYS_SWITCH_IDS);
  const wb = process.env.WHITELIST_BYPASS?.trim() ?? "";
  if (!wb || wb === "true" || wb === "1" || wb === "false" || wb === "0") {
    return set;
  }
  if (/^[\d,\s]+$/.test(wb)) {
    for (const id of parseTelegramIdList(wb)) {
      set.add(id);
    }
  }
  return set;
};

/** Один раз выбрал роль в боте — сохраняется в SQLite (см. `user_role_lock`). */
export const getLockFirstPickUserIds = (): Set<number> =>
  parseTelegramIdList(process.env.ROLE_LOCK_FIRST_IDS);

export type RoleEntryPolicy = "full_bypass" | "always_switch" | "lock_first" | "client_only";

export const getRoleEntryPolicy = (telegramUserId: number): RoleEntryPolicy => {
  if (isFullWhitelistBypass()) {
    return "full_bypass";
  }
  if (getAlwaysSwitchUserIds().has(telegramUserId)) {
    return "always_switch";
  }
  if (getLockFirstPickUserIds().has(telegramUserId)) {
    return "lock_first";
  }
  return "client_only";
};

/**
 * Доступ к роли: в моке — всё; иначе роль «клиент» доступна всем (остальные — по `ROLE_WHITELIST`).
 */
export const canUseRole = (telegramUserId: number, role: BotRole): boolean => {
  if (isFullWhitelistBypass()) {
    return true;
  }
  if (role === "client") {
    return true;
  }
  return canAccessRole(telegramUserId, role);
};
