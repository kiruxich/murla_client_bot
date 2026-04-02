import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import {
  saveClientConsent,
  setClientPhone,
  setClientBusinessName,
  isClientRegistered,
  needsPhoneVerification,
  needsBusinessName,
} from "../src/store/client-store.js";

let dbReady = false;

/**
 * POST /api/miniapp-register
 * body: { initData, step: "consent" | "phone" | "business_name", phone?, businessName? }
 */
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
      console.error("miniapp-register initDb", err);
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

  const body = req.body;
  const initData = typeof body?.initData === "string" ? body.initData : "";
  if (!initData) {
    res.status(400).json({ ok: false, error: "initData_required" });
    return;
  }

  const uid = parseUserIdFromWebAppInitData(initData, token);
  if (uid === null) {
    res.status(401).json({ ok: false, error: "invalid_init_data" });
    return;
  }

  const step = typeof body?.step === "string" ? body.step : "";

  try {
    if (step === "consent") {
      const params = new URLSearchParams(initData);
      const userJson = params.get("user");
      let username: string | undefined;
      if (userJson) {
        try {
          const u = JSON.parse(userJson) as { username?: string };
          username = u.username;
        } catch { /* ignore */ }
      }
      await saveClientConsent(uid, username);

      const nextStep = await needsPhoneVerification(uid) ? "phone" : "business_name";
      res.status(200).json({ ok: true, nextStep });
      return;
    }

    if (step === "phone") {
      const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
      if (!phone || phone.length < 6) {
        res.status(400).json({ ok: false, error: "invalid_phone" });
        return;
      }
      await setClientPhone(uid, phone);

      const nextStep = await needsBusinessName(uid) ? "business_name" : "done";
      res.status(200).json({ ok: true, nextStep });
      return;
    }

    if (step === "business_name") {
      const businessName = typeof body?.businessName === "string" ? body.businessName.trim() : "";
      if (businessName.length < 2) {
        res.status(400).json({ ok: false, error: "name_too_short" });
        return;
      }
      if (businessName.length > 200) {
        res.status(400).json({ ok: false, error: "name_too_long" });
        return;
      }
      await setClientBusinessName(uid, businessName);

      const registered = await isClientRegistered(uid);
      res.status(200).json({ ok: true, nextStep: registered ? "done" : "phone" });
      return;
    }

    res.status(400).json({ ok: false, error: "invalid_step" });
  } catch (err) {
    console.error("miniapp-register", err);
    res.status(500).json({ ok: false, error: "internal" });
  }
};
