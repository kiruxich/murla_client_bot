#!/usr/bin/env node

/**
 * Диагностика окружения и конфигурации для продакшена
 */

console.log("🔍 Диагностика окружения продакшена:\n");

const requiredEnvVars = ["BOT_TOKEN"];
const optionalEnvVars = ["POSTGRES_URL", "DATABASE_URL", "MINI_APP_URL"];

console.log("✅ Обязательные переменные:");
requiredEnvVars.forEach((key) => {
  const value = process.env[key];
  if (!value) {
    console.log(`  ❌ ${key}: НЕ УСТАНОВЛЕНА`);
  } else {
    const masked = value.length > 10 ? value.slice(0, 10) + "..." : value;
    console.log(`  ✅ ${key}: ${masked}`);
  }
});

console.log("\n📋 Опциональные переменные:");
optionalEnvVars.forEach((key) => {
  const value = process.env[key];
  if (!value) {
    console.log(`  ℹ️  ${key}: не задана`);
  } else {
    const masked = value.length > 20 ? value.slice(0, 20) + "..." : value;
    console.log(`  ✅ ${key}: ${masked}`);
  }
});

console.log("\n📊 Режимы:");
console.log(`  USE_DEV_BOT: ${process.env.USE_DEV_BOT || "не задана"}`);
console.log(`  WHITELIST_BYPASS: ${process.env.WHITELIST_BYPASS || "не задана"}`);
console.log(`  DEV_USE_SQLITE: ${process.env.DEV_USE_SQLITE || "не задана"}`);

console.log("\n💡 На Vercel убедитесь, что:");
console.log("  1. BOT_TOKEN задан (токен от @BotFather)");
console.log("  2. USE_DEV_BOT НЕ задан (или =false)");
console.log("  3. BOT_TOKEN_DEV НЕ задан");
console.log("  4. POSTGRES_URL (если используется)");
console.log("  5. Webhook установлен: setWebhook?url=https://your-project.vercel.app/api/telegram");
