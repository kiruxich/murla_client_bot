# murla_client_bot

Telegram-бот Мурлы: заявки, точки забора WB/Ozon, статусы склада, уведомления, отчёты менеджеру и управляющему.

## Быстрый старт (локально)

1. Скопируйте `.env.example` → `.env`, укажите **`BOT_TOKEN`** от [@BotFather](https://t.me/BotFather). Файл подхватывается автоматически (`dotenv`) из **корня проекта** при `pnpm dev`.
2. Для мока ролей без whitelist: **`WHITELIST_BYPASS=true`**.
3. Установка и запуск (long polling):

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

1. Задеплойте проект; URL функции: `https://<project>.vercel.app/api/telegram`.
2. Установите переменные **`BOT_TOKEN`**, при необходимости **`WHITELIST_BYPASS`**.
3. Установите webhook:

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https%3A%2F%2F<project>.vercel.app%2Fapi%2Ftelegram
```

На serverless **сессии и заявки не разделяются между инстансами** — для прод лучше VPS с long polling или общее хранилище (Redis/Postgres). Для мока и тестов Vercel допустим с ограничениями.

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
