# Генерация и правка изображений

Три команды в админке (`ai_commands`): `/create_image`, `/correct_image_my`, `/correct_image_your`.

## classifier vs response

| Поле | Назначение |
|------|------------|
| **classifier** | Куда роутить следующий шаг (фаза A). Дублируй правила на всех трёх image-командах **и** на `/start`, `/lesson0` и т.д. |
| **response** | Не classifier. Для image: мета-шаблон (correct) или стиль сцены (create). Пустой response у image-команд → встроенный дефолт в коде, **без** подмешивания `/start`. |

### Пример classifier (на `/create_image` обязательно после генерации)

```
/create_image — только НОВАЯ картинка с нуля, другой сюжет, без связи с только что выданной.

/correct_image_your — правка ПОСЛЕДНЕЙ картинки БОТА: «сделай днём», «замени на телепузиков»,
  «та же сцена, но …» — даже если есть слово «сгенерируй».

/correct_image_my — в ЭТОМ сообщении есть загруженное фото + что менять.
```

Кейс «телепузики» после офисной сцены → **`/correct_image_your`**, не `/create_image`.  
Код дополнительно: `IMAGE_EDIT_REROUTE=1` (по умолчанию) перекидывает похожие запросы с `/create_image` на `/correct_image_your`, если есть свежая bot-картинка.

### Пример response

- **`/correct_image_your`**: «Сохрани композицию (офис, монитор), измени только то, что просит пользователь. Промпт на английском.»
- **`/correct_image_my`**: то же + «сохрани ключевые элементы исходного фото».
- **`/create_image`**: стиль (реализм, 16:9). Без мета-LLM, если нет референса.

---

## Какие картинки откуда (код)

| Источник | Session | Команды |
|----------|---------|---------|
| Фото в **текущем** сообщении | — | upload |
| **`last_user_image`** | 30 мин (`LAST_USER_IMAGE_TTL_MINUTES`) | `/correct_image_my`, `/create_image` + «этот график» |
| **`last_generated_image`** | 10 мин (`LAST_GENERATED_IMAGE_TTL_MINUTES`) | `/correct_image_your` |

Приоритет референса: upload → session_user → session_bot (по команде).

Сценарий «фото графика → текст вставь на экран»: фото сохраняется в `last_user_image`, второе сообщение с «этот график» → `/create_image` или `/correct_image_my` с референсом.

---

## Поток

1. `classifyIntent` (или `after_reset` → `/start`).
2. Опционально reroute `create_image` → `correct_image_your`.
3. Image-команда → `runImagePipeline` (без `askAI`, без food-vision).
4. Иначе текст + vision **только** если есть `{command}:image_vision` в админке (или команда в `VISION_COMMANDS`).

Food-vision на `/start` **не** запускается, пока не добавишь `/start:image_vision`.

---

## Env

```env
OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image
OPENROUTER_IMAGE_MODALITIES=image
IMAGE_PROMPT_CONTEXT_MESSAGES=10
MAX_STORED_IMAGE_BYTES=14680064
LAST_GENERATED_IMAGE_TTL_MINUTES=10
LAST_USER_IMAGE_TTL_MINUTES=30
IMAGE_EDIT_REROUTE=1
IMAGE_REFERENCE_KEYWORDS=этот,график,вставь,на экран
IMAGE_EDIT_KEYWORDS=измени,замени,телепуз,сделай,днём
VISION_COMMANDS=/ccal
DEBUG_IMAGE_GEN=1
```

---

## Ошибки

| Сообщение | Причина |
|-----------|---------|
| Сначала сгенерируй… | Нет / протух `last_generated_image` |
| Пришли фото… | Нет / протух `last_user_image` для correct_my |
| Модель не вернула картинку | OpenRouter `no_image` |
| Запрос отклонён политикой | 400/403 (напр. IP-персонажи) |

Логи Railway: `[imageGen] cmd=... ref=session_bot|upload|session_user|none refBytes=...`

---

## Partner API

Успех: `imageUrl`, `imageAction`. Отладка: `DEBUG_IMAGE_GEN=1` → `imageGenDebug` в JSON.

## Telegram

`sendPhoto` + caption. `/reset` чистит сессию и фото.
