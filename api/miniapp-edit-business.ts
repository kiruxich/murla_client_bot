import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { setClientBusinessName, getBusinessNamesForTelegramIds } from "../src/store/client-store.js";
import { getLockedRole } from "../src/store/user-role-store.js";
import { getLastSelectedBotRole } from "../src/store/last-bot-role-store.js";
import { canUseRole } from "../src/lib/access.js";

let dbReady = false;

export default async (req: any, res: any): Promise<void> => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!dbReady) {
    try {
      await initDb();
      dbReady = true;
    } catch (err) {
      console.error("miniapp-edit-business initDb", err);
      res.status(503).json({ ok: false, error: "db_unavailable" });
      return;
    }
  }

  let token: string;
  try {
    token = getBotToken();
  } catch {
    res.status(500).json({ ok: false, error: "no_bot_token" });
    return;
  }

  const query = req.query || {};
  const body = req.body || {};
  const initData = req.method === "GET" 
    ? (typeof query.initData === "string" ? query.initData : "")
    : (typeof body?.initData === "string" ? body.initData : "");

  if (!initData) {
    res.status(400).json({ ok: false, error: "initData_required" });
    return;
  }

  const uid = parseUserIdFromWebAppInitData(initData, token);
  if (uid === null) {
    res.status(401).json({ ok: false, error: "invalid_init_data" });
    return;
  }

  // Определяем роль пользователя
  let effectiveRole = await getLockedRole(uid);
  if (!effectiveRole) {
    const last = await getLastSelectedBotRole(uid);
    if (last && canUseRole(uid, last)) {
      effectiveRole = last;
    }
  }
  if (!effectiveRole) effectiveRole = "client";

  // Только клиенты могут редактировать свой профиль
  if (effectiveRole !== "client") {
    res.status(403).json({ ok: false, error: "access_denied" });
    return;
  }

  try {
    if (req.method === "GET") {
      // Загружаем текущее название
      const names = await getBusinessNamesForTelegramIds([uid]);
      const currentName = names.get(uid) || "";

      res.status(200).json({
        ok: true,
        businessName: currentName,
      });
    } else if (req.method === "POST") {
      // Сохраняем новое название
      const businessName = typeof body?.businessName === "string" ? body.businessName.trim() : "";

      if (!businessName || businessName.length < 2 || businessName.length > 200) {
        res.status(400).json({ 
          ok: false, 
          error: "invalid_business_name",
          message: "Название должно быть от 2 до 200 символов"
        });
        return;
      }

      await setClientBusinessName(uid, businessName);

      res.status(200).json({
        ok: true,
        message: "Название сохранено",
        businessName,
      });
    }
  } catch (err) {
    console.error("miniapp-edit-business error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
};
