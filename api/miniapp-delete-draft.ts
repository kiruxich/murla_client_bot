import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { orderStore } from "../src/store/order-store.js";
import { getLockedRole } from "../src/store/user-role-store.js";
import { getLastSelectedBotRole } from "../src/store/last-bot-role-store.js";
import { canUseRole } from "../src/lib/access.js";

let dbReady = false;

export default async (req: any, res: any): Promise<void> => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!dbReady) {
    try {
      await initDb();
      dbReady = true;
    } catch (err) {
      console.error("miniapp-delete-draft initDb", err);
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

  const body = req.body || {};
  const initData = typeof body?.initData === "string" ? body.initData : "";
  const draftId = typeof body?.draftId === "string" ? body.draftId : "";

  if (!initData || !draftId) {
    res.status(400).json({ ok: false, error: "missing_params" });
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

  if (effectiveRole !== "client") {
    res.status(403).json({ ok: false, error: "access_denied" });
    return;
  }

  try {
    const draft = await orderStore.get(draftId);
    if (!draft) {
      res.status(404).json({ ok: false, error: "draft_not_found" });
      return;
    }

    // Проверяем что это черновик и он принадлежит пользователю
    if (draft.status !== "draft" || draft.clientTelegramId !== uid) {
      res.status(403).json({ ok: false, error: "access_denied" });
      return;
    }

    // Удаляем черновик (устанавливаем статус cancelled)
    const updated = await orderStore.update(draftId, {
      status: "cancelled",
    });

    if (!updated) {
      res.status(500).json({ ok: false, error: "delete_failed" });
      return;
    }

    res.status(200).json({
      ok: true,
      message: "Черновик удалён",
    });
  } catch (err) {
    console.error("miniapp-delete-draft error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
};
