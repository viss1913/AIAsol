# AI_Asol (BankFuture)

Монорепозиторий: бэкенд + админ-фронт.

| Папка | Описание | Деплой |
|-------|----------|--------|
| [`backend/`](backend/) | Express, MySQL, Telegram, Partner `POST /chat` | [Railway](https://railway.app) — **Root Directory: `backend`** |
| [`front/`](front/) | React/Vite: `/bots`, `/contexts` | [Vercel](https://vercel.com) — **Root Directory: `front`** |

Документация API и AI — `.md` в корне (`MULTI_BOT_API.md`, `IMAGE_GENERATION.md`, …).

## Быстрый старт

```bash
npm run install:all

# бэк (порт 3000)
npm run dev:backend

# фронт (порт 5173, proxy /api → бэк)
npm run dev:front
```

Скопируй `backend/.env` из `.env.example` (в корне репо — шаблон для Railway).

## Деплой после монорепы

### Railway

В настройках сервиса: **Root Directory** = `backend`, Start = `npm start`.

Либо оставь корень репо и `npm start` из корневого `package.json` (проксирует в `backend/`).

### Vercel

- Repository: `viss1913/AIAsol` (ветка `multi_bot` или `main`)
- **Root Directory:** `front`
- Env (опционально): `VITE_API_BASE_URL` — только для прямого URL на бэк без прокси

Старый отдельный репо `BankFutureFront` можно архивировать после переключения Vercel на этот монорепо.

## Cursor-агенты

| Агент | Файл | Зона |
|-------|------|------|
| brain | `.cursor/agents/brain.md` | `backend/` |
| front | `.cursor/agents/front.md` | `front/` |

## Legacy

- `frontend/pravocard-psychology-front-main/` — старый UI, не BankFuture
- `backend/public/` + `/admin` — встроенная HTML-админка; основной UI — `front/`
