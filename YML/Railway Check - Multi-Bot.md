# Railway Check - Multi-Bot

Короткий hand-check, чтобы убедиться, что “как в Правокард.yaml” действительно работает:
- супер-админ создает логического бота
- бот получает `bot_api_key`
- внешний фронт/клиент отвечает через runtime `POST /chat` по `x-api-key`
- Telegram работает как отдельный фронт (polling) для каждого включенного бота

## 0) Что должно быть в Railway env

Для админ бэка (с сервисом `index.js`, порт 3000 обычно):
- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `ADMIN_USER` (bootstrap первого `super_admin`)
- `ADMIN_PASS` (bootstrap первого `super_admin`)
- `OPENROUTER_API_KEY`
- (если используете legacy Telegram) `TELEGRAM_TOKEN`, `CONTROL_BOT_TOKEN`, `CONTROL_CHAT_ID`

Для bot runtime API (сервис `api.js`, порт 3001 обычно):
- те же `DB_*` (и они должны указывать на ту же БД, что у admin сервиса)
- `OPENROUTER_API_KEY`

## 1) Проверка admin auth

1. Открой в браузере или curl:
   - `GET <ADMIN_API_BASE>/me`
   - где `ADMIN_API_BASE = https://<admin-service>.up.railway.app/api/admin`

2. Заголовок:
   - `Authorization: Basic <base64(username:password)>`

Ожидаемо:
```json
{ "admin": { "id": 1, "username": "owner", "role": "super_admin" } }
```

## 2) Создать “админ для проекта” (опционально, но лучше проверить)

1. `POST <ADMIN_API_BASE>/admins`

Body:
```json
{
  "username": "manager1",
  "password": "strong-password",
  "role": "admin"
}
```

2. `POST <ADMIN_API_BASE>/projects`
```json
{ "name": "Client A", "description": "Main project for client A" }
```

3. `POST <ADMIN_API_BASE>/projects/<PROJECT_ID>/admins`
```json
{ "adminId": 2 }
```

Ожидаемо:
```json
{ "success": true }
```

## 3) Создать бота и получить bot_api_key

1. `POST <ADMIN_API_BASE>/projects/<PROJECT_ID>/bots`
```json
{
  "name": "Support Bot",
  "status": "active",
  "telegramEnabled": false,
  "telegramBotTokenRef": null
}
```

2. `POST <ADMIN_API_BASE>/bots/<BOT_ID>/api-keys`
```json
{ "name": "Frontend integration" }
```

Ожидаемо ответ:
```json
{
  "id": 11,
  "key": "bk_xxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
  "prefix": "bk_xxx"
}
```

Важно:
- ключ `key` сохранить сразу (потом он полностью может больше не отдаваться).

## 4) Проверить runtime через API-ключ (это must)

Base:
- `BOT_RUNTIME_BASE = https://<bot-runtime-service>.up.railway.app`

1. `GET /spec` (через runtime)
Заголовок:
- `x-api-key: <BOT_API_KEY>`

2. `POST /chat`
Body:
```json
{
  "userId": "123456789",
  "message": "привет"
}
```

Ожидаемо:
```json
{
  "reply": "...",
  "botId": <BOT_ID>,
  "session": {
    "lastCommand": "/start",
    "history": [
      { "role": "user", "content": "привет" },
      { "role": "assistant", "content": "..." }
    ]
  }
}
```

Если `reply` есть и `botId` совпадает с тем ботом, которого ты создал — это значит:
- первый запрос классификатора работает
- контекст берется по команде
- второй запрос отвечает с учетом истории
- scoping по bot_id включился

## 5) Проверка Telegram для нового бота

1. `POST <ADMIN_API_BASE>/projects/<PROJECT_ID>/bots` с включенным Telegram:
```json
{
  "name": "My Telegram Bot",
  "status": "active",
  "telegramEnabled": true,
  "telegramBotTokenRef": "<TELEGRAM_BOT_TOKEN_нового_бота>"
}
```

2. Сразу после успешного ответа (или в течение 1-2 минут) отправь сообщение боту в Telegram:
- ожидаем, что polling поднялся
- ожидаем тот же алгоритм ИИ: classify -> context -> askAI -> reply

Ожидаемо:
- бот отвечает на сообщения
- `/reset` сбрасывает историю именно для этого `botId` и этого chatId

## 6) Частые причины “не работает”

- на runtime нет подключения к той же БД (admin и runtime смотрят на разные базы)
- не создан ключ на нужного бота
- отправляется неправильный `x-api-key`
- Telegram бот создан, но `telegramBotTokenRef` не передан (или передан пустой)
