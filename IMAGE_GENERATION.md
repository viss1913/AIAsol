# Генерация и правка изображений

Три команды-маршрута настраиваются **в админке** (`ai_commands`): `/create_image`, `/correct_image_my`, `/correct_image_your`.

## Поток

1. `classifyIntent` выбирает команду (как обычно).
2. Если команда из списка image — запускается `imageGen.runImagePipeline` (**без** `askAI` и без food-`image_vision`).
3. Иначе — обычный текстовый диалог.

## Команды (поведение кода)

| Команда | Условия | Мета-LLM | Референс |
|---------|---------|----------|----------|
| `/create_image` | Текст пользователя | Нет | — |
| `/correct_image_my` | Есть фото в запросе | Да, `response` из админки + JSON последних N сообщений | Фото пользователя |
| `/correct_image_your` | Есть `sessions.last_generated_image` | Да, `response` + последнее сообщение | Последняя картинка бота |

Промпты для мета-LLM и классификатор — только в полях `classifier` / `response` в админке.

## Файлы

| Файл | Роль |
|------|------|
| `imageGen.js` | Пайплайн трёх режимов |
| `chatPipeline.js` | `processUserMessage` — общая точка для Telegram и `POST /chat` |
| `ai.js` | `prepareImageGenPrompt`, `generateImageOpenRouter` |
| `context.js` | `getCommandResponse` — только `response` команды |

## Env

```env
OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image
OPENROUTER_IMAGE_MODALITIES=image
IMAGE_PROMPT_CONTEXT_MESSAGES=10
MAX_STORED_IMAGE_BYTES=1572864
# OPENROUTER_IMAGE_ASPECT_RATIO=1:1
# OPENROUTER_IMAGE_SIZE=1K
```

## Partner API

`POST /chat` при успешной генерации дополнительно возвращает:

```json
{
  "reply": "Готово! Вот изображение.",
  "imageUrl": "data:image/png;base64,...",
  "imageAction": "/create_image",
  "session": { "lastCommand": "/create_image", "history": [] },
  "botId": 1
}
```

## Telegram

- Успех: `sendPhoto` + caption из `reply`.
- В `history` assistant: `[image] {reply}` (без base64).
- `/reset` очищает сессию, в т.ч. `last_generated_image`.

## БД

`sessions.last_generated_image` + `last_generated_image_at` — последняя картинка бота для `/correct_image_your`. TTL: `LAST_GENERATED_IMAGE_TTL_MINUTES` (по умолчанию **10**), после истечения поле очищается.
