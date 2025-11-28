require('dotenv').config();
const axios = require('axios');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = 'google/gemini-2.5-flash'; // Актуальная модель


// Функция 1: Классификация намерения (1-й AI с контекстом классификатора)
async function classifyIntent(userMessage, classifierContext) {
  const classifierPrompt = `
${classifierContext}

Проанализируй сообщение пользователя и верни ТОЛЬКО команду (например: /start, /goLife, /plan) без пояснений.

Сообщение пользователя: "${userMessage}"
`;

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'Ты классификатор намерений пользователя.' },
          { role: 'user', content: classifierPrompt }
        ],
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://bankfuture.com', // Optional: for OpenRouter rankings
          'X-Title': 'BankFuture', // Optional: for OpenRouter rankings
        },
      }
    );

    const command = response.data.choices[0].message.content.trim();
    return command;

  } catch (error) {
    console.error('Classify error:', error.response?.data || error.message);
    return '/start'; // Дефолтная команда при ошибке
  }
}

// Функция 2: Основной запрос с контекстом ответа (2-й AI)
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

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: AI_MODEL,
        messages: messages,
      },
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

  } catch (error) {
    console.error('AI error:', error.response?.data || error.message);
    return 'Ошибка при обращении к AI';
  }
}

module.exports = { classifyIntent, askAI };
