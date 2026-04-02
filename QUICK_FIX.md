# ⚡ Быстрое Исправление Мёртвого Бота на Проде

Если бот не отвечает на Vercel — выполните эти шаги в порядке.

---

## Шаг 1: Проверить Переменные Окружения (2 минуты)

```bash
# На вашей локальной машине, где есть доступ к Vercel:
node scripts/diagnose-prod.mjs
```

**Проверьте на Vercel в Settings → Environment Variables:**

✅ Должны быть:
- `BOT_TOKEN=8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y`

❌ НЕ должны быть:
- `USE_DEV_BOT`
- `BOT_TOKEN_DEV`

Если что-то неправильно — **исправьте в Settings и перезагрузите проект**.

---

## Шаг 2: Установить/Проверить Webhook (2 минуты)

```bash
# Автоматическая проверка и установка:
node scripts/check-webhook.mjs 8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y https://murla-bot.vercel.app/api/telegram
```

Замените `8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y` на ваш `BOT_TOKEN`.  
Замените `murla-bot` на имя вашего проекта.

**Результат должен показать:**
```
✅ Webhook установлен:
{
  "url": "https://murla-bot.vercel.app/api/telegram",
  ...
  "last_error_message": null
}
```

Если `last_error_message` содержит ошибку — **проверьте, что функция /api/telegram доступна и не падает**.

---

## Шаг 3: Проверить Логи (1 минута)

```bash
# Смотрите логи в реальном времени:
vercel logs murla-bot --follow
```

**Отправьте боту сообщение в Telegram и смотрите логи.**

✅ Должны увидеть:
```
📨 Webhook request: POST /api/telegram
📦 Update #123456: message=true, callback=false
✅ Webhook обработан успешно
```

❌ Если ничего не появилось:
- Webhook не установлен (повторите Шаг 2)
- Проект не задеплоен (redeploy через `vercel deploy`)

❌ Если ошибки в логах:
- `Cannot find module...` → `vercel rebuild --prod`
- `BOT_TOKEN is undefined` → добавьте в Settings
- Другая ошибка → читайте `PROD_DEBUG.md`

---

## Шаг 4: Финальная Проверка

1. Откройте чат с ботом в Telegram
2. Отправьте `/start`
3. Бот должен ответить — если нет, что-то ещё не так

---

## Если Всё Ещё Не Работает

1. Прочитайте [`PROD_DEBUG.md`](./PROD_DEBUG.md) — там полная диагностика
2. Прочитайте [`WEBHOOK_SETUP.md`](./WEBHOOK_SETUP.md) — там подробные инструкции
3. Проверьте `vercel logs` — там должна быть ошибка, которая объяснит проблему

---

## Команды для Копирования

```bash
# Диагностика env:
node scripts/diagnose-prod.mjs

# Проверка и установка webhook:
node scripts/check-webhook.mjs 8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y https://murla-bot.vercel.app/api/telegram

# Просмотр логов:
vercel logs murla-bot --follow

# Перестроить проект:
vercel rebuild --prod

# Переразвернуть проект:
vercel deploy --prod
```

---

## Что Мы Исправили в Коде

- ✅ Добавлена обработка ошибок БД в webhook
- ✅ Добавлено логирование входящих запросов
- ✅ Исправлена конфиг TypeScript
- ✅ Созданы скрипты диагностики

**Теперь ошибки будут видны в логах Vercel**, а не просто "бот не отвечает".
