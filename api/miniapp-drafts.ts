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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!dbReady) {
    try {
      await initDb();
      dbReady = true;
    } catch (err) {
      console.error("miniapp-drafts initDb", err);
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
  const initData = typeof query.initData === "string" ? query.initData : "";
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

  try {
    // Только клиенты видят черновики
    if (effectiveRole !== "client") {
      res.status(200).json({ ok: true, drafts: [] });
      return;
    }

    const allOrders = await orderStore.listByClient(uid);
    const drafts = allOrders.filter((o) => o.status === "draft");

    const result = {
      ok: true,
      drafts: drafts.map((d) => ({
        id: d.id,
        product: d.product,
        quantityText: d.quantityText,
        tz: d.tz,
        marketplace: d.delivery.marketplace,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    };

    res.status(200).json(result);
  } catch (err) {
    console.error("miniapp-drafts error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
};
