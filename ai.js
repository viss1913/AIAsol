require('dotenv').config();
const axios = require('axios');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL =
  process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const OPENROUTER_VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL ||
  process.env.AI_VISION_MODEL ||
  'google/gemini-2.5-flash';

function getOpenRouterHeaders() {
  return {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://bankfuture.com',
    'X-Title': 'BankFuture',
  };
}

async function createChatCompletion(model, messages) {
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages,
    },
    {
      headers: getOpenRouterHeaders(),
    }
  );

  const content = response.data.choices?.[0]?.message?.content;
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


// Функция 1: Классификация намерения (1-й AI с контекстом классификатора)
async function classifyIntent(userMessage, classifierContext) {
  const classifierPrompt = `
${classifierContext}

Проанализируй сообщение пользователя и верни ТОЛЬКО команду (например: /start, /goLife, /plan) без пояснений.

Сообщение пользователя: "${userMessage}"
`;

  try {
    const command = await createChatCompletion(AI_MODEL, [
      { role: 'system', content: 'Ты классификатор намерений пользователя.' },
      { role: 'user', content: classifierPrompt }
    ]);

    return String(command).trim();

  } catch (error) {
    console.error('Classify error:', error.response?.data || error.message);
    return '/start'; // Дефолтная команда при ошибке
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

    const result = await createChatCompletion(OPENROUTER_VISION_MODEL, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ]);

    return String(result).trim();
  } catch (error) {
    console.error('Vision error:', error.response?.data || error.message);
    return 'Не удалось выполнить анализ изображения, продолжай диалог только по тексту пользователя.';
  }
}

// Функция 2: Основной запрос с контекстом ответа (2-й AI)
async function askAI(userMessage, responseContext, history = []) {
  try {
    const messages = [
      { role: 'system', content: responseContext },
      ...history,
      { role: 'user', content: userMessage }
    ];

    console.log('--- DEBUG: Full Context Sent to AI ---');
    console.log('System Prompt:', responseContext);
    console.log('History Length:', history.length);
    console.log('Last User Message:', userMessage);
    console.log('---------------------------------------');

    return await createChatCompletion(AI_MODEL, messages);

  } catch (error) {
    console.error('AI error:', error.response?.data || error.message);
    return 'Ошибка при обращении к AI';
  }
}

module.exports = { classifyIntent, askAI, analyzeImageWithVision };
