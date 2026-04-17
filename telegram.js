require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { classifyIntent, askAI, analyzeImageWithVision } = require('./ai');
const {
  getClassifierContext,
  getResponseContext,
  getImageVisionContext,
  injectVisionIntoContext,
} = require('./context');
const { pool } = require('./db');
const { ensureUser, touchUser, addMessage, deleteUserMessages, listUsersForBot } = require('./user');

// Global Control Bot (Optional, for monitoring)
const controlToken = process.env.CONTROL_BOT_TOKEN;
const controlChatId = process.env.CONTROL_CHAT_ID;
const controlBot = controlToken ? new TelegramBot(controlToken) : null;

if (controlBot) {
  console.log(`✅ Control Bot initialized. Target Chat ID: ${controlChatId || 'MISSING'}`);
} else {
  console.log('⚠️ Control Bot NOT initialized (Token missing).');
}

// Active Bots Map: botId -> TelegramBot instance
const activeBots = new Map();

function buildTelegramConversationUserId(msg) {
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  const chatType = msg.chat?.type;

  if (!fromId) return String(chatId);
  if (chatType === 'private') return String(fromId);
  return `${chatId}:${fromId}`;
}

function extractTelegramImageFileId(msg) {
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const biggest = msg.photo[msg.photo.length - 1];
    if (biggest?.file_id) return biggest.file_id;
  }

  if (
    msg.document &&
    msg.document.file_id &&
    typeof msg.document.mime_type === 'string' &&
    msg.document.mime_type.startsWith('image/')
  ) {
    return msg.document.file_id;
  }

  return null;
}

function resolveTelegramImageMimeType(msg) {
  if (
    msg.document &&
    typeof msg.document.mime_type === 'string' &&
    msg.document.mime_type.startsWith('image/')
  ) {
    return msg.document.mime_type;
  }
  return 'image/jpeg';
}

async function buildTelegramImageDataUrl(bot, msg, fileId) {
  const fileLink = await bot.getFileLink(fileId);
  const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
  const mimeType = resolveTelegramImageMimeType(msg);
  const base64 = Buffer.from(imageResponse.data).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

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

  if (!token) {
    console.log(`ℹ️ Skipping Telegram start for bot #${botId} (${botName}): token is empty (API-only bot).`);
    return false;
  }

  console.log(`🤖 Starting bot #${botId} (${botName})...`);

  try {
    const bot = new TelegramBot(token, { polling: true });

    // Handle polling errors to prevent crash
    bot.on('polling_error', (error) => {
      console.error(`[Bot #${botId}] Polling Error:`, error.code || error.message);
    });

    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const conversationUserId = buildTelegramConversationUserId(msg);
      const imageFileId = extractTelegramImageFileId(msg);
      const messageText = typeof msg.text === 'string' && msg.text.trim()
        ? msg.text.trim()
        : '';
      const messageCaption = typeof msg.caption === 'string' && msg.caption.trim()
        ? msg.caption.trim()
        : '';
      const userMessage = messageText || messageCaption
        ? (messageText || messageCaption)
        : imageFileId
          ? 'Пользователь отправил изображение.'
          : '';
      const userName = msg.from.first_name || 'Пользователь';
      const userHandle = msg.from.username ? `@${msg.from.username}` : null;

      console.log(
        `[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] ${userName} (${userHandle}): ${userMessage}`
      );

      try {
        if (!userMessage) {
          await bot.sendMessage(chatId, 'Пришли текст или изображение, и я помогу.');
          return;
        }

        // Register / update user info
        await ensureUser(conversationUserId, userName, userHandle);
        await touchUser(conversationUserId);
        await addMessage(conversationUserId, 'user', userMessage, botId);

        if (userMessage === '/reset') {
          // Reset session for THIS bot
          await pool.query('DELETE FROM sessions WHERE user_id = ? AND bot_id = ?', [conversationUserId, botId]);
          // We do NOT delete messages history globally, maybe just for this context? 
          // Prompt says "Вся история переписки удалена". 
          // Let's keep it safe and delete messages for this bot only? 
          // Or global? Let's delete for this bot to be safe in multi-bot env.
          await pool.query('DELETE FROM messages WHERE user_id = ? AND bot_id = ?', [conversationUserId, botId]);

          console.log(`[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] ✅ Reset completed.`);
          bot.sendMessage(chatId, '🔄 История диалога с этим ботом очищена. Чем могу помочь?');
          if (controlBot && controlChatId) {
            controlBot.sendMessage(controlChatId, `🔄 Сброс (Bot #${botId}): ${userName} (chat:${chatId}, user:${conversationUserId})`);
          }
          return;
        }

        const session = await getSession(conversationUserId, botId);
        const currentCommand = session.last_command || '/start';
        let history = session.history || [];
        if (!Array.isArray(history)) history = [];

        const classifierContext = await getClassifierContext(botId, currentCommand);
        const newCommand = await classifyIntent(userMessage, classifierContext);
        console.log(
          `[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] Current: ${currentCommand} → New: ${newCommand}`
        );

        if (controlBot && controlChatId) {
          const cleanChatId = controlChatId.trim();
          const messageText = `\n📩 (Bot #${botId}) Новое сообщение:\n👤 ${userName} (chat:${chatId}, user:${conversationUserId})\n💬 "${userMessage}"\n🔄 ${currentCommand} → ${newCommand}\n`;

          controlBot.sendMessage(cleanChatId, messageText)
            .then(() => console.log(`[Control Bot] ✅ Notification sent to ${cleanChatId}`))
            .catch((err) => console.error(`[Control Bot] ❌ Failed to send notification: ${err.message}`));
        } else {
          console.log(`[Control Bot] ⚠️ Skipped notification. Bot: ${!!controlBot}, ChatID: ${!!controlChatId}`);
        }

        let responseContext = await getResponseContext(botId, newCommand, conversationUserId);
        console.log(`[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] [DEBUG] Response Context Length: ${responseContext.length}`);
        console.log(`[Bot #${botId}] [DEBUG] Response Context Preview: ${responseContext.substring(0, 50)}...`);

        if (imageFileId) {
          console.log(`[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] [VISION] triggered fileId=${imageFileId}`);
          try {
            const imagePayload = await buildTelegramImageDataUrl(bot, msg, imageFileId);
            const imageVisionContext = await getImageVisionContext(botId, newCommand);
            const vision = await analyzeImageWithVision(
              userMessage,
              imagePayload,
              imageVisionContext
            );
            responseContext = injectVisionIntoContext(responseContext, vision.text, imageVisionContext);
            console.log(
              `[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] [VISION] injected ok=${vision.ok} length=${vision.text.length} code=${vision.errorCode || 'none'}`
            );
          } catch (visionErr) {
            console.error(`[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] [VISION] failed:`, visionErr.message || visionErr);
          }
        }

        const reply = await askAI(userMessage, responseContext, history);
        console.log(`[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] Reply: ${reply}`);

        // Save assistant reply
        await addMessage(conversationUserId, 'assistant', reply, botId);
        await touchUser(conversationUserId);

        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: reply });
        await saveSession(conversationUserId, botId, newCommand, history);

        // Format for Telegram
        const formattedReply = reply
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

        bot.sendMessage(chatId, formattedReply, { parse_mode: 'HTML' });
      } catch (error) {
        console.error(`[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] Error:`, error);
        bot.sendMessage(chatId, 'Произошла ошибка, попробуйте позже.');
        if (controlBot && controlChatId) {
          controlBot.sendMessage(controlChatId, `❌ Ошибка (Bot #${botId}): ${userName} (chat:${chatId}, user:${conversationUserId}): ${error.message}`);
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
  const [rows] = await pool.query('SELECT * FROM bots WHERE is_active = TRUE AND token IS NOT NULL AND token <> ""');
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

  const users = await listUsersForBot(botId);

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
