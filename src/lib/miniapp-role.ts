import { canAccessRole } from "../config/role-whitelist.js";
import type { BotRole } from "./roles.js";
import { getRoleEntryPolicy } from "./access.js";
import { getLockedRole } from "../store/user-role-store.js";

const STAFF_ROLES: BotRole[] = ["packer", "driver", "manager", "supervisor"];

/**
 * Показывать ли в Mini App кнопку «Сменить роль» (согласовано с логикой whitelist / .env).
 */
export const canShowSwitchRoleInMiniApp = async (telegramUserId: number): Promise<boolean> => {
  const policy = getRoleEntryPolicy(telegramUserId);
  if (policy === "full_bypass" || policy === "always_switch") {
    return true;
  }
  if (policy === "lock_first") {
    const locked = await getLockedRole(telegramUserId);
    return locked === undefined;
  }
  return STAFF_ROLES.some((r) => canAccessRole(telegramUserId, r));
};
