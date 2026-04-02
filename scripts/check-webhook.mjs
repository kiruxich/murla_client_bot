#!/usr/bin/env node

/**
 * Диагностика webhook бота на проде
 * Использование: node scripts/check-webhook.mjs <BOT_TOKEN> [WEBHOOK_URL]
 */

const botToken = process.argv[2];
const webhookUrl = process.argv[3];

if (!botToken) {
  console.error("❌ Укажите BOT_TOKEN как первый аргумент");
  console.error("Использование: node scripts/check-webhook.mjs <BOT_TOKEN> [WEBHOOK_URL]");
  process.exit(1);
}

const apiUrl = `https://api.telegram.org/bot${botToken}`;

console.log("🔍 Диагностика webhook...\n");

try {
  // Проверить текущий webhook
  console.log("1️⃣  Проверяю текущий webhook...");
  const infoResponse = await fetch(`${apiUrl}/getWebhookInfo`);
  const info = await infoResponse.json();

  if (!infoResponse.ok) {
    console.error("❌ Ошибка Telegram API:", info);
    process.exit(1);
  }

  console.log("✅ Текущий webhook info:");
  console.log(JSON.stringify(info.result, null, 2));
  console.log();

  if (webhookUrl) {
    console.log(`2️⃣  Устанавливаю новый webhook: ${webhookUrl}`);
    const setResponse = await fetch(`${apiUrl}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const setResult = await setResponse.json();

    if (!setResponse.ok || !setResult.ok) {
      console.error("❌ Ошибка установки webhook:", setResult);
      process.exit(1);
    }

    console.log("✅ Webhook установлен:");
    console.log(JSON.stringify(setResult.result, null, 2));

    // Проверить снова
    await new Promise((r) => setTimeout(r, 1000));
    const checkResponse = await fetch(`${apiUrl}/getWebhookInfo`);
    const checkResult = await checkResponse.json();
    console.log("\n✅ Проверка после установки:");
    console.log(JSON.stringify(checkResult.result, null, 2));
  }

  console.log("\n✅ Диагностика завершена!");
} catch (err) {
  console.error("❌ Ошибка:", err.message);
  process.exit(1);
}
