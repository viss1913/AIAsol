require('dotenv').config();
const axios = require('axios');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = (process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash').trim();
const OPENROUTER_VISION_MODEL = (
  process.env.OPENROUTER_VISION_MODEL ||
  process.env.AI_VISION_MODEL ||
  'google/gemini-2.5-flash'
).trim();
const OPENROUTER_IMAGE_MODEL = (
  process.env.OPENROUTER_IMAGE_MODEL ||
  'google/gemini-2.5-flash-image'
).trim();

function parseModalitiesEnv() {
  const raw = (process.env.OPENROUTER_IMAGE_MODALITIES || 'image').trim();
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function getImageConfig() {
  const config = {};
  const aspectRatio = (process.env.OPENROUTER_IMAGE_ASPECT_RATIO || '').trim();
  const imageSize = (process.env.OPENROUTER_IMAGE_SIZE || '').trim();
  if (aspectRatio) config.aspect_ratio = aspectRatio;
  if (imageSize) config.image_size = imageSize;
  return Object.keys(config).length > 0 ? config : undefined;
}

function getOpenRouterHeaders() {
  return {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://bankfuture.com',
    'X-Title': 'BankFuture',
  };
}

function extractTextFromMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function extractImageUrlFromMessage(message) {
  if (!message) return null;

  const images = message.images;
  if (Array.isArray(images) && images.length > 0) {
    const url = images[0]?.image_url?.url || images[0]?.url;
    if (url) return String(url);
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type === 'image_url' && part.image_url?.url) {
        return String(part.image_url.url);
      }
    }
  }

  const text = extractTextFromMessageContent(message.content);
  if (text.startsWith('data:image/')) {
    return text;
  }

  return null;
}

async function createChatCompletion(model, messages, options = {}) {
  const body = {
    model,
    messages,
  };

  if (options.modalities) {
    body.modalities = options.modalities;
  }
  if (options.image_config) {
    body.image_config = options.image_config;
  }

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    body,
    {
      headers: getOpenRouterHeaders(),
    }
  );

  const message = response.data.choices?.[0]?.message;
  const text = extractTextFromMessageContent(message?.content);
  const imageUrl = extractImageUrlFromMessage(message);

  return {
    text,
    imageUrl,
    rawMessage: message,
  };
}

// Функция 1: Классификация намерения (1-й AI с контекстом классификатора)
async function classifyIntent(userMessage, classifierContext) {
  const classifierPrompt = `
${classifierContext}

Проанализируй сообщение пользователя и верни ТОЛЬКО команду (например: /start, /goLife, /plan) без пояснений.

Сообщение пользователя: "${userMessage}"
`;

  try {
    const { text: command } = await createChatCompletion(AI_MODEL, [
      { role: 'system', content: 'Ты классификатор намерений пользователя.' },
      { role: 'user', content: classifierPrompt },
    ]);

    return String(command).trim();
  } catch (error) {
    console.error('Classify error:', error.response?.data || error.message);
    return '/start';
  }
}

async function prepareImageGenPrompt(metaTemplate, payload) {
  const {
    userMessage,
    historySlice = [],
    hasUserImage = false,
    mode = 'edit',
  } = payload;

  const dataBlock = `
---
Данные для подготовки промпта генерации изображения:

Режим: ${mode}

Последние сообщения диалога (JSON):
${JSON.stringify(historySlice, null, 2)}

Сообщение пользователя: ${JSON.stringify(userMessage)}
Пользователь приложил своё изображение: ${hasUserImage ? 'да' : 'нет'}

Верни ТОЛЬКО готовый промпт для модели генерации изображений, без пояснений и markdown.
`;

  const userContent = `${metaTemplate || ''}${dataBlock}`;

  try {
    const { text } = await createChatCompletion(AI_MODEL, [
      {
        role: 'system',
        content:
          'Ты помощник, который готовит точные промпты для модели генерации/редактирования изображений.',
      },
      { role: 'user', content: userContent },
    ]);
    const prompt = String(text).trim();
    return prompt || String(userMessage).trim();
  } catch (error) {
    console.error('prepareImageGenPrompt error:', error.response?.data || error.message);
    return String(userMessage).trim();
  }
}

async function generateImageOpenRouter(prompt, referenceImageUrl = null, systemInstruction = '') {
  const modalities = parseModalitiesEnv();
  const imageConfig = getImageConfig();

  const userContent = [];
  if (systemInstruction && systemInstruction.trim()) {
    userContent.push({
      type: 'text',
      text: systemInstruction.trim(),
    });
  }
  userContent.push({
    type: 'text',
    text: String(prompt).trim(),
  });
  if (referenceImageUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: referenceImageUrl },
    });
  }

  const messages = [
    {
      role: 'user',
      content: userContent.length === 1 ? userContent[0].text : userContent,
    },
  ];

  try {
    const result = await createChatCompletion(OPENROUTER_IMAGE_MODEL, messages, {
      modalities,
      image_config: imageConfig,
    });

    if (!result.imageUrl) {
      console.error('generateImageOpenRouter: no image in response', result.rawMessage);
      return {
        ok: false,
        imageUrl: null,
        text: result.text || '',
        errorCode: 'no_image',
      };
    }

    return {
      ok: true,
      imageUrl: result.imageUrl,
      text: result.text || '',
      errorCode: null,
    };
  } catch (error) {
    const errorCode = error.response?.status || error.code || 'unknown';
    const errorBody = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(`generateImageOpenRouter error [${errorCode}]:`, errorBody);
    return {
      ok: false,
      imageUrl: null,
      text: '',
      errorCode: String(errorCode),
    };
  }
}

async function analyzeImageWithVision(userMessage, imageUrl, imageVisionContext = '') {
  try {
    const systemPrompt = imageVisionContext && imageVisionContext.trim()
      ? imageVisionContext
      : 'Проанализируй фото еды и верни краткую оценку калорий и БЖУ.';

    const content = [
      {
        type: 'text',
        text: userMessage && String(userMessage).trim()
          ? `Сообщение пользователя: ${userMessage}`
          : 'Пользователь прислал фото еды. Проанализируй блюдо.',
      },
      {
        type: 'image_url',
        image_url: { url: imageUrl },
      },
    ];

    const { text: result } = await createChatCompletion(OPENROUTER_VISION_MODEL, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ]);

    return {
      ok: true,
      text: String(result).trim(),
      errorCode: null,
      errorBody: null,
    };
  } catch (error) {
    const errorCode = error.response?.status || error.code || 'unknown';
    const errorBody = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(`Vision error [${errorCode}]:`, errorBody);
    return {
      ok: false,
      text: 'Не удалось выполнить анализ изображения, продолжай диалог только по тексту пользователя.',
      errorCode: String(errorCode),
      errorBody: String(errorBody || ''),
    };
  }
}

async function askAI(userMessage, responseContext, history = []) {
  try {
    const messages = [
      { role: 'system', content: responseContext },
      ...history,
      { role: 'user', content: userMessage },
    ];

    console.log('--- DEBUG: Full Context Sent to AI ---');
    console.log('System Prompt:', responseContext);
    console.log('History Length:', history.length);
    console.log('Last User Message:', userMessage);
    console.log('---------------------------------------');

    const { text } = await createChatCompletion(AI_MODEL, messages);
    return text;
  } catch (error) {
    console.error('AI error:', error.response?.data || error.message);
    return 'Ошибка при обращении к AI';
  }
}

module.exports = {
  classifyIntent,
  askAI,
  analyzeImageWithVision,
  prepareImageGenPrompt,
  generateImageOpenRouter,
};
