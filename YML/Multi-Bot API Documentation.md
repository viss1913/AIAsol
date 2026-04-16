# Multi-Bot API Documentation

## Purpose
This document describes the current backend contract for the multi-admin, multi-project, multi-bot architecture.

It replaces the old draft that described:
- direct bot CRUD by `/api/admin/bots`
- env-only admin auth
- per-bot contexts already implemented
- Telegram bot runtime auto-management

Those parts are not the current backend contract.

## Deployment

### Admin backend
- Local example: `http://localhost:3000`
- Production on Railway: `https://<your-admin-service>.up.railway.app`

### Bot runtime API
- Local example: `http://localhost:3001`
- Production on Railway: `https://<your-bot-api-service>.up.railway.app`

If both services are deployed behind one Railway service with a custom proxy, use the public URL configured in Railway for each route group. If they are deployed separately, frontend and external clients must call the correct service directly.

## Authentication

### Admin API authentication
All `/api/admin/*` routes require HTTP Basic Auth.

Header:
```http
Authorization: Basic <base64(username:password)>
```

Important:
- credentials are checked against the `admins` table in MySQL
- `ADMIN_USER` and `ADMIN_PASS` are only used for bootstrap of the first `super_admin`
- after startup, auth is no longer just env-based

### Bot runtime authentication
The bot runtime uses per-bot API keys.

Header:
```http
x-api-key: bk_xxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

Important:
- API keys are stored hashed in `bot_api_keys`
- full key is only returned once when created
- revoked keys stop working immediately

## Access Model

### Roles
- `super_admin`: sees and manages all projects, bots, keys, users, and messages
- `admin`: sees only projects assigned through `admin_projects`, plus bots and data inside those projects

### Hierarchy
- one project can contain many bots
- one admin can be assigned to many projects
- one bot can have many API keys

## Admin API

Base URL:
```text
<ADMIN_BACKEND_URL>/api/admin
```

### 1. Get current admin
**GET** `/me`

Response:
```json
{
  "admin": {
    "id": 1,
    "username": "owner",
    "role": "super_admin"
  }
}
```

### 2. List admins
**GET** `/admins`

Access:
- `super_admin` only

Response:
```json
[
  {
    "id": 1,
    "username": "owner",
    "role": "super_admin",
    "is_active": 1,
    "created_at": "2026-04-16T10:00:00.000Z",
    "updated_at": "2026-04-16T10:00:00.000Z"
  }
]
```

### 3. Create admin
**POST** `/admins`

Access:
- `super_admin` only

Request body:
```json
{
  "username": "manager1",
  "password": "strong-password",
  "role": "admin"
}
```

Response:
```json
{
  "id": 2,
  "username": "manager1",
  "role": "admin"
}
```

### 4. List projects
**GET** `/projects`

Response:
```json
[
  {
    "id": 1,
    "name": "System Project",
    "slug": "system-project",
    "description": "Bootstrap project for legacy flows",
    "created_by_admin_id": null,
    "created_at": "2026-04-16T10:00:00.000Z",
    "updated_at": "2026-04-16T10:00:00.000Z"
  }
]
```

Notes:
- `super_admin` gets all projects
- regular `admin` gets only assigned projects

### 5. Create project
**POST** `/projects`

Access:
- `super_admin` only

Request body:
```json
{
  "name": "Client A",
  "description": "Main project for client A"
}
```

Response:
```json
{
  "id": 2,
  "name": "Client A",
  "slug": "client-a",
  "description": "Main project for client A",
  "created_by_admin_id": 1,
  "created_at": "2026-04-16T10:00:00.000Z",
  "updated_at": "2026-04-16T10:00:00.000Z"
}
```

### 6. Assign admin to project
**POST** `/projects/:id/admins`

Access:
- `super_admin` only

Request body:
```json
{
  "adminId": 2
}
```

Response:
```json
{
  "success": true
}
```

### 7. List bots in project
**GET** `/projects/:id/bots`

Access:
- allowed for project owner/admins of that project

Response:
```json
[
  {
    "id": 1,
    "project_id": 1,
    "name": "System Bot",
    "slug": "system-bot",
    "status": "active",
    "telegram_enabled": 1,
    "telegram_bot_token_ref": null,
    "is_default": 1,
    "created_by_admin_id": null,
    "created_at": "2026-04-16T10:00:00.000Z",
    "updated_at": "2026-04-16T10:00:00.000Z"
  }
]
```

### 8. Create bot in project
**POST** `/projects/:id/bots`

Access:
- allowed for project owner/admins of that project

Request body:
```json
{
  "name": "Support Bot",
  "status": "active",
  "telegramEnabled": false,
  "telegramBotTokenRef": null
}
```

**Notes:**
- если `telegramEnabled=true` и `telegramBotTokenRef` непустой, Telegram polling для этого `botId` стартует автоматически сразу после создания (без перезапуска сервиса)
- если `telegramEnabled=true`, но `telegramBotTokenRef` пустой/null, Telegram останется выключенным
- stop/restart Telegram бота через админский API пока не реализованы

Response:
```json
{
  "id": 3,
  "project_id": 2,
  "name": "Support Bot",
  "slug": "support-bot",
  "status": "active",
  "telegram_enabled": 0,
  "telegram_bot_token_ref": null,
  "is_default": 0,
  "created_by_admin_id": 1,
  "created_at": "2026-04-16T10:00:00.000Z",
  "updated_at": "2026-04-16T10:00:00.000Z"
}
```

### 9. List API keys for bot
**GET** `/bots/:id/api-keys`

Access:
- allowed for admins who can access this bot

Response:
```json
[
  {
    "id": 10,
    "bot_id": 3,
    "key_name": "Frontend integration",
    "key_prefix": "bk_ab12cd34",
    "created_by_admin_id": 1,
    "created_at": "2026-04-16T10:00:00.000Z",
    "last_used_at": "2026-04-16T10:10:00.000Z",
    "revoked_at": null
  }
]
```

### 10. Create API key for bot
**POST** `/bots/:id/api-keys`

Access:
- allowed for admins who can access this bot

Request body:
```json
{
  "name": "Frontend integration"
}
```

Response:
```json
{
  "id": 11,
  "key": "bk_ab12cd34.1234567890abcdef1234567890abcdef1234567890abcd",
  "prefix": "bk_ab12cd34"
}
```

Important:
- save the `key` immediately
- the full key is not returned later by list endpoints

### 11. Revoke API key
**DELETE** `/api-keys/:id`

Response:
```json
{
  "success": true
}
```

### 12. Get users visible to current admin
**GET** `/users`

Response:
```json
[
  {
    "user_id": "3:123456789",
    "external_user_id": "123456789",
    "nickname": "API User",
    "project_id": 2,
    "bot_id": 3,
    "registration_date": "2026-04-16T10:00:00.000Z",
    "last_message_date": "2026-04-16T10:10:00.000Z"
  }
]
```

Notes:
- users are now scoped by project and bot
- `user_id` is an internal scoped identifier in format `<botId>:<externalUserId>`
- `external_user_id` is the original Telegram or external user identifier

### 13. Get user messages visible to current admin
**GET** `/users/:id/messages`

Response:
```json
[
  {
    "role": "user",
    "content": "Hello",
    "created_at": "2026-04-16T10:00:00.000Z",
    "project_id": 2,
    "bot_id": 3,
    "external_user_id": "123456789"
  },
  {
    "role": "assistant",
    "content": "Hi! How can I help?",
    "created_at": "2026-04-16T10:00:01.000Z",
    "project_id": 2,
    "bot_id": 3,
    "external_user_id": "123456789"
  }
]
```

## Context Endpoints

Current state (per-bot with fallback to global defaults):
- `GET /api/admin/context?botId=<botId>`
  - `botId` is optional (default `0`)
  - returns `bots.base_brain_context` if set, otherwise global `ai_globals.baseBrainContext`
  - returns command contexts as an overlay: first global (`bot_id=0`), then bot overrides (`bot_id=<botId>`)
- `POST /api/admin/context`
  - body: `{ key, value, type, section, botId? }`
  - if `botId` is omitted, defaults to `0` (global)
- `POST /api/admin/context/delete`
  - body: `{ key, botId? }`
  - if `botId` is omitted, defaults to `0` (global)

Example response from `GET /api/admin/context`:
```json
{
  "baseBrainContext": "global system prompt (or bot-specific override)",
  "contexts": {
    "/start": {
      "classifier": "classifier text",
      "response": "response text",
      "section": "general"
    }
  }
}
```

## Bot Runtime API

Base URL:
```text
<BOT_RUNTIME_URL>
```

### 1. Get runtime spec
**GET** `/spec`

Authentication:
- requires `x-api-key`

Response:
- returns parsed contents of `YML/Правокард.yaml`

### 2. Send chat message
**POST** `/chat`

Authentication:
- requires `x-api-key`

Request body:
```json
{
  "userId": "123456789",
  "message": "Hello"
}
```

Response:
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

Runtime behavior:
- the API key determines the bot
- the bot determines the project
- session, messages, and user records are stored with `project_id` and `bot_id`
- `last_used_at` is updated for the API key on every successful authenticated call

## Database Overview

Current core tables:
- `admins`
- `projects`
- `admin_projects`
- `bots`
- `bot_api_keys`
- `users`
- `sessions`
- `messages`
- `ai_globals`
- `ai_commands`

Important notes:
- passwords are stored as hashes
- API keys are stored as hashes
- one default bootstrap project and bot are created for legacy flows:
  - `system-project`
  - `system-bot`

## Frontend Integration Notes

### Admin frontend
Use:
```javascript
const ADMIN_API_BASE = 'https://<your-admin-service>.up.railway.app/api/admin';
const authHeader = 'Basic ' + btoa(`${username}:${password}`);
```

Example:
```javascript
const response = await fetch(`${ADMIN_API_BASE}/projects`, {
  headers: {
    Authorization: authHeader
  }
});

const projects = await response.json();
```

### External client or another frontend for bot access
Use:
```javascript
const BOT_API_BASE = 'https://<your-bot-api-service>.up.railway.app';
```

Example:
```javascript
const response = await fetch(`${BOT_API_BASE}/chat`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  },
  body: JSON.stringify({
    userId: '123456789',
    message: 'Hello'
  })
});
```

## What Is Not Implemented Yet

The following things were present in the old draft but are not implemented in the current backend:
- `GET /api/admin/bots`
- `POST /api/admin/bots`
- `PUT /api/admin/bots/:id`
- `DELETE /api/admin/bots/:id`
- per-bot context CRUD is supported via `GET/POST /api/admin/context` with optional `botId`, but admin UI wiring may still be missing in your frontend
- user context endpoints
- admin send message endpoint
- broadcast endpoint
- automatic Telegram restart/stop by admin API (start for newly created enabled bots is supported)
- bot token storage and masking in admin responses

## Common Errors

### 400
```json
{
  "error": "Project name is required"
}
```

### 401
```json
{
  "error": "Invalid API key"
}
```

or plain text for admin auth:
```text
Invalid credentials.
```

### 403
```json
{
  "error": "Access denied for this project"
}
```

### 404
```json
{
  "error": "Bot not found"
}
```

## Railway Deployment Notes

- Set MySQL variables in Railway for the admin backend and bot runtime if they run as separate services:
  - `DB_HOST`
  - `DB_USER`
  - `DB_PASSWORD`
  - `DB_NAME`
- Set bootstrap admin credentials:
  - `ADMIN_USER`
  - `ADMIN_PASS`
- Set AI credentials:
  - `OPENROUTER_API_KEY`
- If Telegram legacy flow is still used:
  - `TELEGRAM_TOKEN`
  - `CONTROL_BOT_TOKEN`
  - `CONTROL_CHAT_ID`

Important:
- `ADMIN_USER` and `ADMIN_PASS` are mainly for initial bootstrap of the first super admin
- regular admin auth after bootstrap is database-based
- if admin backend and bot runtime are deployed as separate Railway services, both must point to the same database if they are expected to share projects, bots, sessions, and keys
