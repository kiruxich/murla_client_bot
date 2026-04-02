import { initDb } from "../src/lib/db.js";
import { getBotToken } from "../src/env.js";
import { parseUserIdFromWebAppInitData } from "../src/lib/telegram-webapp-init.js";
import { canShowSwitchRoleInMiniApp } from "../src/lib/miniapp-role.js";
import { canUseRole, getRoleEntryPolicy } from "../src/lib/access.js";
import { getLockedRole, setLockedRole } from "../src/store/user-role-store.js";
import { setLastSelectedBotRole } from "../src/store/last-bot-role-store.js";
import { isBotRole, type BotRole } from "../src/lib/roles.js";

let dbReady = false;

const ROLE_LABEL: Record<BotRole, string> = {
  client: "Клиент",
  packer: "Работник склада",
  driver: "Водитель",
  manager: "Менеджер",
  supervisor: "Управляющий",
};

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

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
      console.error("miniapp-switch-role initDb", err);
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
  const selectedRole = typeof body?.selectedRole === "string" ? body.selectedRole : "";

  if (!initData) {
    res.status(400).json({ ok: false, error: "initData_required" });
    return;
  }

  const uid = parseUserIdFromWebAppInitData(initData, token);
  if (uid === null) {
    res.status(401).json({ ok: false, error: "invalid_init_data" });
    return;
  }

  if (!isBotRole(selectedRole)) {
    res.status(400).json({ ok: false, error: "invalid_role" });
    return;
  }

  try {
    const canSwitch = await canShowSwitchRoleInMiniApp(uid);
    if (!canSwitch) {
      res.status(403).json({ ok: false, error: "switch_not_allowed" });
      return;
    }

    if (!canUseRole(uid, selectedRole)) {
      res.status(403).json({ ok: false, error: "role_not_allowed" });
      return;
    }

    const policy = getRoleEntryPolicy(uid);
    if (policy === "lock_first") {
      const locked = await getLockedRole(uid);
      if (locked !== undefined && locked !== selectedRole) {
        res.status(403).json({ ok: false, error: "role_locked", lockedRole: locked });
        return;
      }
      if (locked === undefined) {
        await setLockedRole(uid, selectedRole);
      }
    }

    await setLastSelectedBotRole(uid, selectedRole);

    await sendTelegramMessage(
      token,
      uid,
      `✅ Роль изменена: <b>${ROLE_LABEL[selectedRole]}</b>`,
    );

    res.status(200).json({ ok: true, newRole: selectedRole });
  } catch (err) {
    console.error("miniapp-switch-role", err);
    res.status(500).json({ ok: false, error: "internal" });
  }
};
