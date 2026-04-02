# 🔍 Отладка: Почему Бот «Мёртв» на Проде

## Проблема
Бот работает на локальной машине (с `pnpm dev`), но **полностью не отвечает на Vercel**.

---

## Диагностика

### ✅ Что мы исправили

1. **TypeScript конфиг** (`tsconfig.json`)
   - Добавлена явная `lib: ["ES2022"]` (была ошибка с пропущенными глобальными типами)

2. **API функция** (`api/telegram.ts`)
   - Добавлена обработка ошибок при инициализации БД
   - Добавлено логирование входящих webhook-запросов
   - Гарантия, что запрос не обрабатывается, если БД упала

3. **Инициализация бота** (`src/telegram-bot.ts`)
   - Добавлено логирование успешной инициализации
   - Лучшая обработка ошибок при получении токена

4. **Документация**
   - Создан `WEBHOOK_SETUP.md` с полной инструкцией настройки webhook
   - Создан `scripts/check-webhook.mjs` для диагностики webhook
   - Создан `scripts/diagnose-prod.mjs` для проверки env-переменных

---

## Главная Причина: Неправильный Webhook

На **локальной машине** бот работает в режиме **long polling** (бот сам спрашивает у Telegram новые сообщения).

На **Vercel** (serverless) используется **webhook** — Telegram отправляет сообщения напрямую на функцию `/api/telegram`.

### Если webhook не установлен или неправильно настроен:
- ❌ Бот не получит никакие сообщения
- ❌ Может выглядеть как «бот мёртв»
- ✅ Локально работает только потому, что `src/index.ts` использует long polling

---

## Что Нужно Сделать на Vercel

### 1. Проверить Environment Variables

**Settings → Environment Variables** должны содержать:

```
BOT_TOKEN=8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y
```

**НЕ должны содержать:**
```
USE_DEV_BOT=true
BOT_TOKEN_DEV=...
```

Если `USE_DEV_BOT=true` на проде — бот будет искать `BOT_TOKEN_DEV`, упадёт с ошибкой, так как переменная не задана.

### 2. Установить Webhook

После деплоя выполните одну из команд:

**Curl:**
```bash
curl "https://api.telegram.org/bot8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y/setWebhook?url=https%3A%2F%2F<ваш-проект>.vercel.app%2Fapi%2Ftelegram"
```

**Node скрипт:**
```bash
node scripts/check-webhook.mjs 8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y https://<ваш-проект>.vercel.app/api/telegram
```

### 3. Проверить Webhook Info

```bash
curl "https://api.telegram.org/bot8723883725:AAGFfzLpFHsmjbi7P7Obh8JJNhyUMFnqd6Y/getWebhookInfo"
```

Должно вернуть:
```json
{
  "url": "https://<ваш-проект>.vercel.app/api/telegram",
  "has_custom_certificate": false,
  "pending_update_count": 0,
  "last_error_message": null
}
```

---

## Отладка на Vercel

### Смотрите логи:

```bash
vercel logs <проект> --follow
```

Ищите:
- ✅ `📨 Webhook request:` — webhook принимается
- ✅ `📦 Update #...` — обновления обрабатываются
- ❌ `Cannot find module...` — ошибка импорта
- ❌ `BOT_TOKEN is not defined` — переменная окружения не задана
- ❌ `Error while initializing database` — проблема с БД

---

## Типичный Сценарий Отладки

| Признак | Причина | Решение |
|---------|---------|---------|
| Бот молчит, логов нет | Webhook не установлен | `setWebhook?url=...` |
| Ошибка в логах `Cannot find 'grammy'` | Модули не установлены | `vercel rebuild --prod` |
| Ошибка `BOT_TOKEN is undefined` | Переменная окружения не задана | Добавить в Settings → Env |
| Ошибка `USE_DEV_BOT` на проде | Dev-переменные случайно скопированы | Удалить `USE_DEV_BOT`, `BOT_TOKEN_DEV` |
| Ошибка БД, but webhook работает | SQLite не подходит для serverless | Подключить POSTGRES_URL (Neon) |

---

## Файлы, Которые Мы Создали/Изменили

✅ **`tsconfig.json`** — добавлена `lib: ["ES2022"]`  
✅ **`api/telegram.ts`** — улучшена обработка ошибок и логирование  
✅ **`src/telegram-bot.ts`** — добавлено логирование инициализации  
✅ **`WEBHOOK_SETUP.md`** — полная инструкция webhook  
✅ **`scripts/check-webhook.mjs`** — диагностика webhook  
✅ **`scripts/diagnose-prod.mjs`** — проверка env-переменных  
✅ **`PROD_DEBUG.md`** — этот файл  

---

## Финальный Чек-лист

- [ ] Деплой на Vercel завершён успешно
- [ ] BOT_TOKEN установлен в Vercel Settings
- [ ] USE_DEV_BOT НЕ установлен
- [ ] Webhook установлен на правильный URL
- [ ] `getWebhookInfo` показывает верный URL и нет ошибок
- [ ] `vercel logs` показывает входящие webhook-запросы
- [ ] Отправляю тестовое сообщение боту — бот отвечает ✅

Если всё ещё не работает — кидайте скриншот ошибки из логов!
