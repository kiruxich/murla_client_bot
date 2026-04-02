import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { canShowSwitchRoleInMiniApp } from "../src/lib/miniapp-role.js";
import { getLockedRole } from "../src/store/user-role-store.js";

let dbReady = false;

/**
 * GET /api/miniapp-config?initData=...
 * Возвращает { canSwitchRole } для профиля Mini App (подпись initData проверяется).
 */
export default async (req: { method?: string; query?: { initData?: string } }, res: any): Promise<void> => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!dbReady) {
    try {
      await initDb();
      dbReady = true;
    } catch (err) {
      console.error("miniapp-config initDb", err);
      res.status(503).json({ canSwitchRole: false, error: "db_unavailable" });
      return;
    }
  }

  let token: string;
  try {
    token = getBotToken();
  } catch {
    res.status(500).json({ canSwitchRole: false, error: "no_bot_token" });
    return;
  }

  const initData = typeof req.query?.initData === "string" ? req.query.initData : "";
  if (!initData) {
    res.status(400).json({ canSwitchRole: false, error: "initData_required" });
    return;
  }

  const uid = parseUserIdFromWebAppInitData(initData, token);
  if (uid === null) {
    res.status(401).json({ canSwitchRole: false, error: "invalid_init_data" });
    return;
  }

  try {
    const canSwitchRole = await canShowSwitchRoleInMiniApp(uid);
    const lockedRole = await getLockedRole(uid);
    const currentRole = lockedRole || "client";
    res.status(200).json({ canSwitchRole, currentRole });
  } catch (err) {
    console.error("miniapp-config", err);
    res.status(500).json({ canSwitchRole: false, currentRole: "client", error: "internal" });
  }
};
