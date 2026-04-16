# Frontend Handoff - Multi-Bot Admin API

## Что Это За Документ
Этот файл нужен фронтенду как прикладная шпаргалка по текущему состоянию backend API.

Подробный основной контракт смотри в [Multi-Bot API Documentation](./Multi-Bot%20API%20Documentation.md).

Этот handoff-документ дополняет основной файл и отвечает на практический вопрос: что фронт уже может делать прямо сейчас, какими методами это делать и чего пока не надо ожидать от backend.

## Коротко По Состоянию Системы
Сейчас backend уже умеет:
- работать с ролями `super_admin` и `admin`
- создавать админов
- создавать проекты
- назначать админов на проекты
- создавать ботов внутри проектов
- выпускать и отзывать API-ключи для ботов
- ограничивать доступ обычного админа только его проектами
- принимать внешние запросы к боту через отдельный runtime API по `x-api-key`

Сейчас backend еще не умеет полноценно:
- давать старый CRUD по `/api/admin/bots`
- разделять контексты по `botId`
- давать user context endpoints
- отправлять сообщения пользователям из админки
- делать broadcast
- управлять Telegram-ботами через админский UI как отдельными runtime-процессами

## Как Фронту На Это Смотреть

### Админский фронт
Если это интерфейс для супер-админа или обычного админа, он должен работать с admin backend:
- base URL: `https://<your-admin-service>.up.railway.app/api/admin`
- auth: `Basic Auth`

### Внешний клиент или отдельный чат-фронт
Если это клиент, который должен общаться с ботом через API-ключ:
- base URL: `https://<your-bot-api-service>.up.railway.app`
- auth: `x-api-key`

## Railway
Если backend разнесен на Railway по двум сервисам, фронт должен понимать, что это два разных base URL:

- `ADMIN_API_BASE = https://<admin-service>.up.railway.app/api/admin`
- `BOT_RUNTIME_BASE = https://<bot-runtime-service>.up.railway.app`

Если у вас один публичный Railway URL с проксированием, тогда нужно использовать тот URL, который настроен в деплое. Но логически это все равно две группы API:
- admin API
- bot runtime API

## Аутентификация

### 1. Admin API
Все `/api/admin/*` запросы требуют `Basic Auth`.

Пример:
```js
const authHeader = 'Basic ' + btoa(`${username}:${password}`);
```

Важно:
- проверка идет по таблице `admins`
- `ADMIN_USER` и `ADMIN_PASS` нужны в основном для bootstrap первого `super_admin`
- обычный `admin` не сможет вызвать super-admin-only методы

### 2. Bot Runtime API
Все вызовы runtime API идут по ключу бота:

```http
x-api-key: bk_xxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

Важно:
- ключ создается через admin API
- полный ключ приходит только один раз при выпуске
- потом можно получить только метаданные ключа, а не его секретную часть

## Роли И Доступ

### super_admin
Может:
- создавать админов
- видеть всех админов
- создавать проекты
- назначать админов на проекты
- видеть все проекты, ботов, ключи, пользователей и сообщения

### admin
Может:
- видеть только проекты, в которые он назначен
- видеть ботов только этих проектов
- выпускать ключи только для доступных ему ботов
- видеть пользователей и сообщения только в рамках доступных проектов

Не может:
- создавать новых админов
- создавать проекты
- назначать других админов на проекты

## Что Уже Можно Делать Во Фронте
На текущем API уже можно собрать следующие экраны:
- экран логина в админку через `Basic Auth`
- экран текущего профиля админа
- экран списка проектов
- экран создания проекта
- экран создания админа
- экран назначения админа на проект
- экран списка ботов в проекте
- экран создания бота в проекте
- экран списка API-ключей бота
- экран выпуска API-ключа
- экран отзыва API-ключа
- экран списка пользователей
- экран просмотра сообщений пользователя

## Методы, Которые Реально Есть Сейчас

### 1. Текущий админ
**GET** `/me`

Доступ:
- любой авторизованный админ

Пример ответа:
```json
{
  "admin": {
    "id": 1,
    "username": "owner",
    "role": "super_admin"
  }
}
```

### 2. Список админов
**GET** `/admins`

Доступ:
- только `super_admin`

### 3. Создать админа
**POST** `/admins`

Доступ:
- только `super_admin`

Тело:
```json
{
  "username": "manager1",
  "password": "strong-password",
  "role": "admin"
}
```

Ответ:
```json
{
  "id": 2,
  "username": "manager1",
  "role": "admin"
}
```

Ошибки:
- `400`, если не переданы `username` или `password`
- `400`, если `role` не равен `super_admin` или `admin`
- `403`, если метод вызвал не `super_admin`
- `409`, если логин уже занят

### 4. Список проектов
**GET** `/projects`

Доступ:
- любой авторизованный админ

Поведение:
- `super_admin` получает все проекты
- `admin` получает только назначенные проекты

### 5. Создать проект
**POST** `/projects`

Доступ:
- только `super_admin`

Тело:
```json
{
  "name": "Client A",
  "description": "Main project for client A"
}
```

### 6. Назначить админа на проект
**POST** `/projects/:id/admins`

Доступ:
- только `super_admin`

Тело:
```json
{
  "adminId": 2
}
```

Ответ:
```json
{
  "success": true
}
```

### 7. Список ботов проекта
**GET** `/projects/:id/bots`

Доступ:
- `super_admin`
- `admin`, если проект ему доступен

### 8. Создать бота в проекте
**POST** `/projects/:id/bots`

Доступ:
- `super_admin`
- `admin`, если проект ему доступен

Тело:
```json
{
  "name": "Support Bot",
  "status": "active",
  "telegramEnabled": false,
  "telegramBotTokenRef": null
}
```

Важно:
- `status` может быть только `draft`, `active`, `disabled`
- пока это создание записи бота в системе, а не автоматический запуск отдельного Telegram runtime

### 9. Список API-ключей бота
**GET** `/bots/:id/api-keys`

Доступ:
- `super_admin`
- `admin`, если бот доступен через его проект

### 10. Создать API-ключ для бота
**POST** `/bots/:id/api-keys`

Доступ:
- `super_admin`
- `admin`, если бот доступен через его проект

Тело:
```json
{
  "name": "Frontend integration"
}
```

Ответ:
```json
{
  "id": 11,
  "key": "bk_ab12cd34.1234567890abcdef1234567890abcdef1234567890abcd",
  "prefix": "bk_ab12cd34"
}
```

Важно:
- фронт должен сразу показать и сохранить этот ключ пользователю
- позже backend уже не вернет полную строку ключа

### 11. Отозвать API-ключ
**DELETE** `/api-keys/:id`

Ответ:
```json
{
  "success": true
}
```

### 12. Список пользователей
**GET** `/users`

Доступ:
- любой авторизованный админ

Поведение:
- `super_admin` видит всех пользователей
- `admin` видит только пользователей доступных ему проектов

Важно:
- `user_id` теперь внутренний scoped id в формате `<botId>:<externalUserId>`
- `external_user_id` это внешний реальный id пользователя

### 13. Сообщения пользователя
**GET** `/users/:id/messages`

Доступ:
- любой авторизованный админ, но только в пределах доступных проектов

## Runtime Методы Для Бота

### 1. Получить runtime spec
**GET** `/spec`

Base:
- `BOT_RUNTIME_BASE`

Auth:
- `x-api-key`

Что возвращает:
- содержимое спецификации runtime API

### 2. Отправить сообщение в бота
**POST** `/chat`

Base:
- `BOT_RUNTIME_BASE`

Auth:
- `x-api-key`

Тело:
```json
{
  "userId": "123456789",
  "message": "Hello"
}
```

Ответ:
```json
{
  "reply": "Hi! How can I help?",
  "botId": 3,
  "session": {
    "lastCommand": "/start",
    "history": [
      {
        "role": "user",
        "content": "Hello"
      },
      {
        "role": "assistant",
        "content": "Hi! How can I help?"
      }
    ]
  }
}
```

Что важно для фронта:
- бот определяется по `x-api-key`
- проект определяется через бота
- пользователи и сообщения логируются уже в связке с ботом и проектом

## Практические Сценарии Для Фронта

### Сценарий 1. Супер-админ создает нового админа
1. Залогиниться как `super_admin`
2. Вызвать `POST /admins`
3. Получить `id` созданного админа
4. Показать успех

### Сценарий 2. Супер-админ выдает админу проект
1. Создать проект через `POST /projects` или выбрать существующий
2. Вызвать `POST /projects/:id/admins`
3. Передать `adminId`
4. После этого новый админ увидит проект в `GET /projects`

### Сценарий 3. Админ создает бота
1. Открыть список проектов
2. Выбрать доступный проект
3. Вызвать `POST /projects/:id/bots`
4. Сохранить `id` созданного бота

### Сценарий 4. Админ выпускает API-ключ
1. Открыть бота
2. Вызвать `POST /bots/:id/api-keys`
3. Один раз показать полный ключ
4. Предупредить пользователя, что потом целиком ключ backend уже не отдаст

### Сценарий 5. Внешний клиент общается с ботом
1. Взять выданный API-ключ
2. Вызвать `POST /chat` на runtime API
3. Передать `userId` и `message`
4. Получить `reply`, `botId`, `session`

## Что Уже Сделано В Backend
- введены таблицы `admins`, `projects`, `admin_projects`, `bots`, `bot_api_keys`
- введены роли `super_admin` и `admin`
- введено разграничение доступа по проектам
- добавлен выпуск ключей на конкретного бота
- bot runtime переведен на per-bot `x-api-key`
- старый глобальный single-bot сценарий поддержан через системный проект и системного бота

## Что Фронту Пока Нельзя Закладывать
- старые ручки `/api/admin/bots`
- update/delete bot через admin API
- user context editing
- отправка сообщения пользователю из админки
- broadcast по пользователям
- автоматический старт Telegram-ботов (polling) для вновь созданных enabled ботов через админку поддержан; остановка/перезапуск пока не реализованы
- отображение полного API-ключа после первого создания

## Контексты (per-bot)
Контексты команд и base-brain сейчас поддерживаются **per-bot**.

Эндпоинты:
- `GET /api/admin/context?botId=<botId>`
- `POST /api/admin/context` (в body: `key, value, type, section, botId?`)
- `POST /api/admin/context/delete` (в body: `key, botId?`)

Важно:
- `botId` опциональный; если не передать, применяется `botId=0` (глобальные/системные команды)
- для нового бота frontend должен передавать `botId`, чтобы задавать/читать его собственные команды

## Пример Базового API-Клиента Для Админки
```js
const ADMIN_API_BASE = 'https://<your-admin-service>.up.railway.app/api/admin';

function getBasicAuthHeader(username, password) {
  return 'Basic ' + btoa(`${username}:${password}`);
}

async function apiFetch(path, { username, password, ...options } = {}) {
  const headers = {
    Authorization: getBasicAuthHeader(username, password),
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  return fetch(`${ADMIN_API_BASE}${path}`, {
    ...options,
    headers
  });
}
```

## Пример Базового API-Клиента Для Runtime
```js
const BOT_RUNTIME_BASE = 'https://<your-bot-runtime-service>.up.railway.app';

async function chatWithBot(apiKey, payload) {
  return fetch(`${BOT_RUNTIME_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify(payload)
  });
}
```

## Что Передавать Команде Фронта
Передавать лучше два документа вместе:
- [Multi-Bot API Documentation](./Multi-Bot%20API%20Documentation.md) как основной подробный контракт
- этот файл как краткий прикладной handoff по сценариям, интерфейсам и ограничениям
