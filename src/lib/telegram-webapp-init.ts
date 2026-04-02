import crypto from "node:crypto";

/**
 * Проверка подписи `initData` из Telegram Web App (Mini App).
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export const validateWebAppInitData = (initData: string, botToken: string): boolean => {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return false;
  }
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return calculatedHash === hash;
};

export const parseUserIdFromWebAppInitData = (initData: string, botToken: string): number | null => {
  if (!validateWebAppInitData(initData, botToken)) {
    return null;
  }
  const params = new URLSearchParams(initData);
  const userJson = params.get("user");
  if (!userJson) {
    return null;
  }
  try {
    const user = JSON.parse(userJson) as { id?: number };
    return typeof user.id === "number" ? user.id : null;
  } catch {
    return null;
  }
};
