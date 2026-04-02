import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { orderStore } from "../src/store/order-store.js";
import { getClientBusinessName } from "../src/store/client-store.js";

let dbReady = false;

/**
 * GET /api/miniapp-orders?initData=...
 * Возвращает { orders: [...] } рейсы с одобренными датами (для календаря в Mini App).
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
      console.error("miniapp-orders initDb", err);
      res.status(503).json({ orders: [], error: "db_unavailable" });
      return;
    }
  }

  let token: string;
  try {
    token = getBotToken();
  } catch {
    res.status(500).json({ orders: [], error: "no_bot_token" });
    return;
  }

  const initData = typeof req.query?.initData === "string" ? req.query.initData : "";
  if (!initData) {
    res.status(400).json({ orders: [], error: "initData_required" });
    return;
  }

  const uid = parseUserIdFromWebAppInitData(initData, token);
  if (uid === null) {
    res.status(401).json({ orders: [], error: "invalid_init_data" });
    return;
  }

  try {
    const allOrders = await orderStore.list();
    const clientOrders = allOrders.filter((o) => o.clientTelegramId === uid && o.approvedDeliveryDate);

    const orders = await Promise.all(
      clientOrders.map(async (o) => ({
        id: o.id,
        status: o.status,
        product: o.product,
        quantityText: o.quantityText,
        businessName: await getClientBusinessName(uid),
        desiredDeliveryDate: o.desiredDeliveryDate,
        approvedDeliveryDate: o.approvedDeliveryDate,
      })),
    );

    res.status(200).json({ orders });
  } catch (err) {
    console.error("miniapp-orders", err);
    res.status(500).json({ orders: [], error: "internal" });
  }
};
