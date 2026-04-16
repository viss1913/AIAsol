# OpenRouter API - Документация для разработчиков

## Базовая информация

**Endpoint:** `https://openrouter.ai/api/v1/chat/completions`  
**Метод:** `POST`  
**Content-Type:** `application/json`

## Обязательные заголовки

```javascript
{
  'Authorization': 'Bearer YOUR_API_KEY',
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://your-domain.com',  // Опционально, для рейтингов OpenRouter
  'X-Title': 'YourAppName'                     // Опционально, для рейтингов OpenRouter
}
```

## Структура запроса

### Минимальный запрос

```javascript
{
  "model": "google/gemini-2.5-flash",
  "messages": [
    {
      "role": "user",
      "content": "Привет, как дела?"
    }
  ]
}
```

### Запрос с системным промптом

```javascript
{
  "model": "google/gemini-2.5-flash",
  "messages": [
    {
      "role": "system",
      "content": "Ты помощник-психолог. Отвечай дружелюбно и профессионально."
    },
    {
      "role": "user",
      "content": "У меня стресс на работе"
    }
  ]
}
```

### Запрос с историей диалога

```javascript
{
  "model": "google/gemini-2.5-flash",
  "messages": [
    {
      "role": "system",
      "content": "Ты помощник-психолог."
    },
    {
      "role": "user",
      "content": "Привет"
    },
    {
      "role": "assistant",
      "content": "Привет! Чем могу помочь?"
    },
    {
      "role": "user",
      "content": "У меня стресс"
    }
  ]
}
```

## Примеры кода

### JavaScript (Node.js с axios)

```javascript
const axios = require('axios');

const OPENROUTER_API_KEY = 'your-api-key-here';
const MODEL = 'google/gemini-2.5-flash';

async function sendRequest(userMessage) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: MODEL,
        messages: [
          { role: 'system', content: 'Ты помощник.' },
          { role: 'user', content: userMessage }
        ],
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://your-domain.com',
          'X-Title': 'YourApp',
        },
      }
    );

    const aiResponse = response.data.choices[0].message.content;
    return aiResponse;
  } catch (error) {
    console.error('Ошибка:', error.response?.data || error.message);
    throw error;
  }
}

// Использование
sendRequest('Привет!').then(console.log);
```

### JavaScript (fetch)

```javascript
async function sendRequest(userMessage) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://your-domain.com',
      'X-Title': 'YourApp',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'Ты помощник.' },
        { role: 'user', content: userMessage }
      ],
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content;
}
```

### Python (requests)

```python
import requests

OPENROUTER_API_KEY = 'your-api-key-here'
MODEL = 'google/gemini-2.5-flash'

def send_request(user_message):
    url = 'https://openrouter.ai/api/v1/chat/completions'
    
    headers = {
        'Authorization': f'Bearer {OPENROUTER_API_KEY}',
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://your-domain.com',
        'X-Title': 'YourApp',
    }
    
    data = {
        'model': MODEL,
        'messages': [
            {'role': 'system', 'content': 'Ты помощник.'},
            {'role': 'user', 'content': user_message}
        ],
    }
    
    response = requests.post(url, json=data, headers=headers)
    response.raise_for_status()
    
    return response.json()['choices'][0]['message']['content']

# Использование
print(send_request('Привет!'))
```

### cURL

```bash
curl -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "HTTP-Referer: https://your-domain.com" \
  -H "X-Title: YourApp" \
  -d '{
    "model": "google/gemini-2.5-flash",
    "messages": [
      {"role": "system", "content": "Ты помощник."},
      {"role": "user", "content": "Привет!"}
    ]
  }'
```

## Структура ответа

```json
{
  "id": "gen-xxx",
  "model": "google/gemini-2.5-flash",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Привет! Чем могу помочь?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 8,
    "total_tokens": 18
  }
}
```

**Как получить ответ:**
```javascript
const aiResponse = response.data.choices[0].message.content;
```

## Обработка ошибок

```javascript
try {
  const response = await axios.post(/* ... */);
  // Успех
} catch (error) {
  if (error.response) {
    // Ошибка от API
    console.error('Status:', error.response.status);
    console.error('Data:', error.response.data);
    // Обычные ошибки:
    // 401 - Неверный API ключ
    // 429 - Превышен лимит запросов
    // 500 - Ошибка сервера
  } else {
    // Ошибка сети
    console.error('Network error:', error.message);
  }
}
```

## Доступные модели

- `google/gemini-2.5-flash` (быстрая, используется в проекте)
- `google/gemini-pro-1.5` (более мощная)
- `openai/gpt-4o`
- `anthropic/claude-3.5-sonnet`
- И другие - см. https://openrouter.ai/models

## Важные моменты

1. **API ключ** должен быть в переменной окружения или в безопасном хранилище
2. **HTTP-Referer** и **X-Title** опциональны, но помогают OpenRouter отслеживать использование
3. **Роли сообщений:**
   - `system` - системный промпт (контекст для AI)
   - `user` - сообщение пользователя
   - `assistant` - ответ AI (для истории диалога)
4. **История диалога** передается через массив `messages` в хронологическом порядке

## Полный пример из проекта

```javascript
// Файл: ai.js
const axios = require('axios');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = 'google/gemini-2.5-flash';

async function askAI(userMessage, responseContext, history = []) {
  const messages = [
    { role: 'system', content: responseContext },
    ...history,
    { role: 'user', content: userMessage }
  ];

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    { model: AI_MODEL, messages: messages },
    {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://bankfuture.com',
        'X-Title': 'BankFuture',
      },
    }
  );

  return response.data.choices[0].message.content;
}
```

## Генерация изображений

**⚠️ Важно:** OpenRouter **НЕ поддерживает** генерацию изображений. Сервис специализируется только на текстовых LLM моделях (чат-боты, анализ текста и т.д.).

### Альтернативы для генерации изображений

Если вам нужна генерация изображений, используйте специализированные API:

#### 1. OpenAI DALL-E API
- **Endpoint:** `https://api.openai.com/v1/images/generations`
- **Модели:** `dall-e-2`, `dall-e-3`
- **Документация:** https://platform.openai.com/docs/guides/images

**Пример запроса:**
```javascript
const axios = require('axios');

async function generateImage(prompt) {
  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    {
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: '1024x1024'
    },
    {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  return response.data.data[0].url; // URL сгенерированного изображения
}
```

#### 2. Stability AI (Stable Diffusion)
- **Endpoint:** `https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image`
- **Документация:** https://platform.stability.ai/docs

#### 3. Replicate API
- Поддерживает множество моделей генерации изображений
- **Документация:** https://replicate.com/docs

**Примечание:** Для генерации изображений нужны отдельные API ключи от соответствующих сервисов. Ключ OpenRouter не подойдет.

## Полезные ссылки

- Документация OpenRouter: https://openrouter.ai/docs
- Список моделей: https://openrouter.ai/models
- Получение API ключа: https://openrouter.ai/keys

