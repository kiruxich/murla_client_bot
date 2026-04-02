# Настройка Webhook для Бота на Vercel

## Проблема: Бот не отвечает на проде

Если бот работает локально но **мёртв на Vercel**, причина почти всегда в webhook. Вот чек-лист.

---

## 1️⃣ Проверка переменных окружения на Vercel

Откройте **Settings → Environment Variables** вашего проекта:

### ✅ Обязательно установите:
- **`BOT_TOKEN`** = токен продакшена от @BotFather (формат: `123456789:ABCdefGHIjklmnoPQRstuvWXyz123...`)

### ❌ НЕ устанавливайте на проде:
- **`USE_DEV_BOT`** — если установлена, бот будет искать `BOT_TOKEN_DEV` и упадёт!
- **`BOT_TOKEN_DEV`** — это только для локальной разработки

### 📋 Опционально:
- **`POSTGRES_URL`** или **`DATABASE_URL`** — если используется Neon или другая Postgres (без этого используется SQLite в `/data/bot.db`, что неэффективно на serverless)
- **`MINI_APP_URL`** — HTTPS URL вашего Mini App приложения

Пример корректных env для Vercel:
```
BOT_TOKEN=8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y
POSTGRES_URL=postgresql://user:pass@host:5432/db
MINI_APP_URL=https://your-app.vercel.app/miniapp/
```

---

## 2️⃣ Установка Webhook

После деплоя функция API находится по адресу: **`https://<ваш-проект>.vercel.app/api/telegram`**

### Способ A: Curl (быстро)

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https%3A%2F%2F<ваш-проект>.vercel.app%2Fapi%2Ftelegram"
```

Замените:
- `<BOT_TOKEN>` на ваш токен
- `<ваш-проект>` на имя проекта в Vercel

Пример:
```bash
curl "https://api.telegram.org/bot8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y/setWebhook?url=https%3A%2F%2Fmurla-bot.vercel.app%2Fapi%2Ftelegram"
```

### Способ B: Скрипт NodeJS (рекомендуется)

```bash
node scripts/check-webhook.mjs <BOT_TOKEN> https://<ваш-проект>.vercel.app/api/telegram
```

Пример:
```bash
node scripts/check-webhook.mjs 8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y https://murla-bot.vercel.app/api/telegram
```

---

## 3️⃣ Проверка Webhook Info

Любой из способов выше должен вернуть что-то вроде:

```json
{
  "ok": true,
  "result": {
    "url": "https://murla-bot.vercel.app/api/telegram",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "last_error_date": null,
    "last_error_message": null,
    "last_synchronization_update_count": 0
  }
}
```

### ✅ Хорошие признаки:
- `"url"` совпадает с вашим Vercel URL
- `"pending_update_count": 0`
- `"last_error_message"` — нет или `null`

### ❌ Плохие признаки:
- `"last_error_message": "Failed to connect to..."` — URL недоступен
- `"url"` не совпадает с вашим Vercel URL — webhook указывает на старый URL
- `"pending_update_count"` > 0 — есть необработанные сообщения

---

## 4️⃣ Отладка

Если webhook установлен, но бот не отвечает:

### Проверьте логи Vercel:

```bash
vercel logs <ваш-проект> --follow
```

Ищите в логах:
- ❌ `Cannot find module...` — ошибка импорта
- ❌ `Cannot read property 'BOT_TOKEN'...` — переменная окружения не задана
- ❌ `Error while initializing database...` — ошибка БД
- ✅ `Incoming update from Telegram...` — всё работает

### Тестируйте вручную:

Отправьте боту сообщение в Telegram. Если ничего не происходит, проверьте функцию:

```bash
curl -X POST "https://<ваш-проект>.vercel.app/api/telegram" \
  -H "Content-Type: application/json" \
  -d '{"update_id":123,"message":{"message_id":1,"date":123,"from":{"id":1,"is_bot":false,"first_name":"Test"},"chat":{"id":1,"type":"private"},"text":"/start"}}'
```

Должна вернуться статус 200 (OK) или 202 (Accepted).

---

## 5️⃣ Типовые ошибки

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `"Failed to connect to..."` | Webhook URL неправильный | Проверьте имя проекта в `setWebhook` |
| `"Failed to deserialize..."` | Неверный JSON в update | Это обычно внутренняя ошибка Telegram, игнорируйте |
| Бот не отвечает | `USE_DEV_BOT=true` на проде | Удалите `USE_DEV_BOT` из env |
| Бот не отвечает | БД недоступна | Подключите POSTGRES_URL или используйте Neon |
| 500 ошибки в логах | Необработанное исключение в коде | Проверьте логи функции `/api/telegram` |

---

## Чек-лист перед деплоем:

- [ ] BOT_TOKEN установлен в Vercel env
- [ ] USE_DEV_BOT НЕ установлен (или = false)
- [ ] Webhook установлен на правильный URL
- [ ] `vercel logs` показывает входящие обновления
- [ ] Бот отвечает на `/start` в Telegram

---

## Дополнительно

### Удаление webhook (вернуться на long polling):

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
```

### Перезагрузка всех pending updates:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook?drop_pending_updates=true"
```
