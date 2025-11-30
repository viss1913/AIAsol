require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { classifyIntent, askAI } = require('./ai');
const { getClassifierContext, getResponseContext } = require('./context');
const { pool } = require('./db');
const { ensureUser, touchUser, addMessage, deleteUserMessages, listUsers } = require('./user');

// Global Control Bot (Optional, for monitoring)
const controlToken = process.env.CONTROL_BOT_TOKEN;
const controlChatId = process.env.CONTROL_CHAT_ID;
const controlBot = controlToken ? new TelegramBot(controlToken) : null;

// Active Bots Map: botId -> TelegramBot instance
const activeBots = new Map();

// Helper: Get Session from MySQL
async function getSession(chatId, botId) {
  const [rows] = await pool.query(
    'SELECT * FROM sessions WHERE user_id = ? AND bot_id = ?',
    [String(chatId), botId]
  );
  if (rows.length > 0) {
    return rows[0];
  }
  return { last_command: '/start', history: [] };
}

// Helper: Save Session to MySQL
async function saveSession(chatId, botId, lastCommand, history) {
  await pool.query(
    `INSERT INTO sessions (user_id, bot_id, last_command, history)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_command = VALUES(last_command), history = VALUES(history)`,
    [String(chatId), botId, lastCommand, JSON.stringify(history)]
  );
}

// Start a single bot instance
function startBot(botRow) {
  const botId = botRow.id;
  const token = botRow.token;
  const botName = botRow.name;

  console.log(`🤖 Starting bot #${botId} (${botName})...`);

  try {
    const bot = new TelegramBot(token, { polling: true });

    // Handle polling errors to prevent crash
    bot.on('polling_error', (error) => {
      console.error(`[Bot #${botId}] Polling Error:`, error.code || error.message);
    });

    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const userMessage = msg.text;
      const userName = msg.from.first_name || 'Пользователь';
      const userHandle = msg.from.username ? `@${msg.from.username}` : null;

      console.log(`[Bot #${botId}] [${chatId}] ${userName} (${userHandle}): ${userMessage}`);

      try {
        // Register / update user info
        await ensureUser(chatId, userName, userHandle);
        await touchUser(chatId);
        await addMessage(chatId, 'user', userMessage, botId);

        if (userMessage === '/reset') {
          // Reset session for THIS bot
          await pool.query('DELETE FROM sessions WHERE user_id = ? AND bot_id = ?', [String(chatId), botId]);
          // We do NOT delete messages history globally, maybe just for this context? 
          // Prompt says "Вся история переписки удалена". 
          // Let's keep it safe and delete messages for this bot only? 
          // Or global? Let's delete for this bot to be safe in multi-bot env.
          await pool.query('DELETE FROM messages WHERE user_id = ? AND bot_id = ?', [String(chatId), botId]);

          console.log(`[Bot #${botId}] [${chatId}] ✅ Reset completed.`);
          bot.sendMessage(chatId, '🔄 История диалога с этим ботом очищена. Чем могу помочь?');
          if (controlBot && controlChatId) {
            controlBot.sendMessage(controlChatId, `🔄 Сброс (Bot #${botId}): ${userName} (${chatId})`);
          }
          return;
        }

        const session = await getSession(chatId, botId);
        const currentCommand = session.last_command || '/start';
        let history = session.history || [];
        if (!Array.isArray(history)) history = [];

        const classifierContext = await getClassifierContext(botId, currentCommand);
        const newCommand = await classifyIntent(userMessage, classifierContext);
        console.log(`[Bot #${botId}] [${chatId}] Current: ${currentCommand} → New: ${newCommand}`);

        if (controlBot && controlChatId) {
          controlBot.sendMessage(controlChatId, `\n📩 (Bot #${botId}) Новое сообщение:\n👤 ${userName} (${chatId})\n💬 "${userMessage}"\n🔄 ${currentCommand} → ${newCommand}\n`);
        }

        const responseContext = await getResponseContext(botId, newCommand);
        const reply = await askAI(userMessage, responseContext, history);
        console.log(`[Bot #${botId}] [${chatId}] Reply: ${reply}`);

        // Save assistant reply
        await addMessage(chatId, 'assistant', reply, botId);
        await touchUser(chatId);

        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: reply });
        await saveSession(chatId, botId, newCommand, history);

        // Format for Telegram
        const formattedReply = reply
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

        bot.sendMessage(chatId, formattedReply, { parse_mode: 'HTML' });
      } catch (error) {
        console.error(`[Bot #${botId}] [${chatId}] Error:`, error);
        bot.sendMessage(chatId, 'Произошла ошибка, попробуйте позже.');
        if (controlBot && controlChatId) {
          controlBot.sendMessage(controlChatId, `❌ Ошибка (Bot #${botId}): ${userName} (${chatId}): ${error.message}`);
        }
      }
    });

    activeBots.set(botId, bot);
    return true;
  } catch (err) {
    console.error(`❌ Failed to start bot #${botId}:`, err);
    return false;
  }
}

async function stopBot(botId) {
  const bot = activeBots.get(botId);
  if (bot) {
    console.log(`🛑 Stopping bot #${botId}...`);
    await bot.stopPolling();
    activeBots.delete(botId);
    return true;
  }
  return false;
}

async function initBots() {
  console.log('🔄 Initializing bots from DB...');
  const [rows] = await pool.query('SELECT * FROM bots WHERE is_active = TRUE');
  for (const botRow of rows) {
    startBot(botRow);
  }
  console.log(`✅ Started ${activeBots.size} bots.`);
}

// --- API Functions ---

async function sendMessageToUser(chatId, text, botId) {
  const bot = activeBots.get(parseInt(botId));
  if (!bot) {
    return { success: false, error: `Bot #${botId} not active or not found` };
  }
  try {
    await bot.sendMessage(chatId, text);
    return { success: true };
  } catch (error) {
    console.error(`Failed to send message to ${chatId} via bot #${botId}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function broadcastMessage(text, botId) {
  const bot = activeBots.get(parseInt(botId));
  if (!bot) {
    return { success: false, error: `Bot #${botId} not active or not found` };
  }

  const users = await listUsers(); // This lists ALL users. Ideally we should filter users who interacted with THIS bot.
  // But for now, let's try to send to all. If the user blocked the bot or never started it, it will fail.

  let successCount = 0;
  let failCount = 0;

  for (const user of users) {
    try {
      await bot.sendMessage(user.user_id, text);
      successCount++;
    } catch (error) {
      // console.error(`Failed to send broadcast to ${user.user_id}:`, error.message);
      failCount++;
    }
  }
  return { success: true, total: users.length, sent: successCount, failed: failCount };
}

module.exports = {
  initBots,
  startBot,
  stopBot,
  sendMessageToUser,
  broadcastMessage
};
