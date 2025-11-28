require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { classifyIntent, askAI } = require('./ai');
const { getClassifierContext, getResponseContext } = require('./context');
const { pool } = require('./db');
const { ensureUser, touchUser, addMessage } = require('./user'); // user helpers

// Основной бот
const mainToken = process.env.TELEGRAM_TOKEN;
const mainBot = new TelegramBot(mainToken, { polling: true });

// Контрольный бот
const controlToken = process.env.CONTROL_BOT_TOKEN;
const controlBot = new TelegramBot(controlToken);
const controlChatId = process.env.CONTROL_CHAT_ID;

// Helper: Get Session from MySQL
async function getSession(chatId) {
  const [rows] = await pool.query('SELECT * FROM sessions WHERE user_id = ?', [String(chatId)]);
  if (rows.length > 0) {
    return rows[0];
  }
  return { last_command: '/start', history: [] };
}

// Helper: Save Session to MySQL
async function saveSession(chatId, lastCommand, history) {
  await pool.query(
    `INSERT INTO sessions (user_id, last_command, history)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE last_command = VALUES(last_command), history = VALUES(history)`,
    [String(chatId), lastCommand, JSON.stringify(history)]
  );
}

mainBot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;
  const userName = msg.from.first_name || 'Пользователь';

  console.log(`[${chatId}] ${userName}: ${userMessage}`);

  try {
    // Register / update user info
    await ensureUser(chatId, userName);
    await touchUser(chatId);
    await addMessage(chatId, 'user', userMessage);

    if (userMessage === '/reset') {
      await pool.query('DELETE FROM sessions WHERE user_id = ?', [String(chatId)]);
      mainBot.sendMessage(chatId, '🔄 Сессия сброшена! Начнём сначала. Чем могу помочь?');
      if (controlChatId) await controlBot.sendMessage(controlChatId, `🔄 Сессия сброшена: ${userName} (${chatId})`);
      return;
    }

    const session = await getSession(chatId);
    const currentCommand = session.last_command || '/start';
    let history = session.history || [];
    if (!Array.isArray(history)) history = [];

    const classifierContext = await getClassifierContext(currentCommand);
    const newCommand = await classifyIntent(userMessage, classifierContext);
    console.log(`[${chatId}] Current: ${currentCommand} → New: ${newCommand}`);

    if (controlChatId) {
      await controlBot.sendMessage(controlChatId, `\n📩 Новое сообщение:\n👤 ${userName} (${chatId})\n💬 "${userMessage}"\n🔄 ${currentCommand} → ${newCommand}\n`);
    }

    const responseContext = await getResponseContext(newCommand);
    const reply = await askAI(userMessage, responseContext, history);
    console.log(`[${chatId}] Reply: ${reply}`);

    // Save assistant reply and update timestamps
    await addMessage(chatId, 'assistant', reply);
    await touchUser(chatId);

    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: reply });
    await saveSession(chatId, newCommand, history);

    // Format for Telegram (Convert **bold** to <b>bold</b> and escape HTML)
    const formattedReply = reply
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    mainBot.sendMessage(chatId, formattedReply, { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`[${chatId}] Error:`, error);
    mainBot.sendMessage(chatId, 'Произошла ошибка, попробуйте позже.');
    if (controlChatId) {
      controlBot.sendMessage(controlChatId, `❌ Ошибка: ${userName} (${chatId}): ${error.message}`);
    }
  }
});

console.log('✅ Telegram Bot started with MySQL storage!');
