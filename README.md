# murla_client_bot

Telegram-бот Мурлы: заявки, точки забора WB/Ozon, статусы склада, уведомления, отчёты менеджеру и управляющему.

## Быстрый старт (локально)

1. Скопируйте **`cp .env.example .env`**, заполните токены. Файл подхватывается при `pnpm dev`.
2. **Прод и dev — два бота:** в [@BotFather](https://t.me/BotFather) создайте отдельного бота для разработки. В **`.env`**: **`BOT_TOKEN`** = прод (как на Vercel), **`BOT_TOKEN_DEV`** = второй бот, **`USE_DEV_BOT=true`** — тогда `pnpm dev` использует dev-бота и локальную БД, продовый webhook не мешает.
3. **На Vercel** в переменных окружения укажите только **`BOT_TOKEN`** (прод). **`USE_DEV_BOT` и `BOT_TOKEN_DEV` не задавайте** (или `USE_DEV_BOT=false`).
4. **Локально с SQLite:** **`DEV_USE_SQLITE=true`** — файл **`data/bot.db`**, даже если в `.env` есть `POSTGRES_URL`.
5. Для мока ролей без whitelist: **`WHITELIST_BYPASS=true`**.
6. Установка и запуск (long polling):

```bash
pnpm install
pnpm dev
```

Остановка: `Ctrl+C`.

## Роли и whitelist

- Роли: клиент, упаковщик, водитель, менеджер, управляющий.
- Доступ по **`src/config/role-whitelist.ts`** (массивы Telegram user id). При **`WHITELIST_BYPASS=true`** роли доступны всем для разработки.

## Сценарии (мок)

- **Клиент:** новая заявка (текст → тип товара → количество → WB/Ozon → склады; можно несколько точек) → черновик → «Отправить в работу».
- **Упаковщик:** список заявок → этапы до «Подготовка к выгрузке» → «Запросить выгрузку у водителя» (пуш водителю + кнопка).
- **Водитель:** подтверждение готовности к выгрузке → «В пути» → «Завершено».
- **Менеджер / управляющий:** все заявки, текстовый отчёт.

Данные заявок хранятся **в памяти процесса** (после перезапуска обнуляются). Позже можно подключить БД.

## Vercel (webhook)

**📖 Полная инструкция:** см. [`WEBHOOK_SETUP.md`](./WEBHOOK_SETUP.md)

1. Задеплойте проект; URL функции: `https://<project>.vercel.app/api/telegram`.
2. Установите **`BOT_TOKEN`** (прод) в Vercel Settings. **Не включайте `USE_DEV_BOT`** на проде!
3. Установите webhook:

```bash
node scripts/check-webhook.mjs <BOT_TOKEN> https://<project>.vercel.app/api/telegram
```

Или вручную:
```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https%3A%2F%2F<project>.vercel.app%2Fapi%2Ftelegram
```

**Если бот не отвечает на проде:**
- Проверьте webhook: `node scripts/diagnose-prod.mjs`
- Смотрите логи: `vercel logs <project> --follow`
- Читайте [`PROD_DEBUG.md`](./PROD_DEBUG.md) для отладки

На serverless **сессии и заявки не разделяются между инстансами** — для прод рекомендуется подключить **POSTGRES_URL** (Neon) для хранения данных.

### Telegram Mini App (полнофункциональное приложение)
    
1. **Структура:**
   - **`public/miniapp/`** — статические файлы (HTML, CSS, JS) для Vercel
   - **`miniapp/`** — те же файлы для локальной разработки (синхронизируются вручную)

2. **Что входит:**
   - **Главное меню** — новая заявка, список, профиль
   - **Форма заявки** — выбор маркетплейса и склада (как в боте), адреса забора, валидация
   - **Итоговый экран** — полный просмотр заявки перед созданием (товар, кол-во, ТЗ, забор, склад, дата, комментарий)
   - **Подтверждение** — кнопки "Создать заявку" и "Редактировать"
   - **Профиль** — показ текущей роли, смена роли выпадающим списком с подтверждением, календарь рейсов
   - **Календарь** — группировка рейсов по датам (`approvedDeliveryDate`), подробные карточки при клике
   - Автоматическое подстраивание под тему (свет/тёмный режим)
   - Отправка данных боту через `tg.sendData()` → закрытие приложения

3. **Настройка в @BotFather:**
   - Откройте **@BotFather** → выберите бота → **Bot Settings** → **Menu Button** → **Web App**
   - URL: `https://<ваш-проект>.vercel.app/miniapp/` (на проде) или локальный URL
   - Сохраните

4. **Обработка данных в боте:**
   - Mini App отправляет JSON через `sendData()`, который попадает как `web_app_data` в обновление от Telegram
   - Обработка в `src/bot/register.ts` (обработчик `message:web_app_data`: заявка и `action: switch_role`)
   - Кнопка «Сменить роль» в профиле: `GET /api/miniapp-config?initData=...` → `{ canSwitchRole }` (подпись `initData` проверяется на сервере)
   - Календарь рейсов: `GET /api/miniapp-orders?initData=...` → список заявок с одобренными датами
   - Водитель утверждает дату рейса: кнопка в карточке заявки → вводит дату → отправляются уведомления клиенту, менеджеру, управляющему

5. **Локальная разработка:**
   - Откройте бота в Telegram, нажмите **Menu Button** → **Приложение**
   - Форма работает через Telegram WebApp SDK
   - Данные отправляются на webhook бота

6. **Развертывание:**
   - После `vercel deploy` Mini App доступна по URL выше
   - Не забудьте обновить URL в @BotFather после первого деплоя

### Аналитика на Vercel (Web Analytics + Speed Insights)

1. В [дашборде Vercel](https://vercel.com/dashboard) откройте проект → **Analytics** → включите **Web Analytics** и при необходимости **Speed Insights** (после следующего деплоя появятся маршруты `/_vercel/insights/*` и т.п.).
2. В **`public/index.html`** и **`public/miniapp/index.html`** уже подключены официальные сниппеты (просмотры страниц и метрики скорости). Локально скрипты с `/_vercel/...` могут отдавать 404 — это нормально.
3. Статистика по **вызовам** `POST /api/telegram` смотрится в проекте → **Observability** / **Functions** (это не Web Analytics, а логи serverless).

## Конфиги в коде

| Файл | Назначение |
|------|------------|
| `src/config/role-whitelist.ts` | id по ролям |
| `src/config/warehouses.ts` | WB / Ozon, точки |
| `src/config/order-statuses.ts` | статусы |
| `src/config/notifications.ts` | кому слать пуши, отчёты |

## Скрипты

```bash
pnpm dev          # разработка (tsx watch)
pnpm start        # один запуск без watch
pnpm typecheck    # проверка типов
```
