require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { processUserMessage, seedSessionAfterReset } = require('./chatPipeline');
const { pool } = require('./db');
const { ensureUser, touchUser, addMessage, deleteUserContext, listUsersForBot } = require('./user');

// Global Control Bot (Optional, for monitoring)
const controlToken = process.env.CONTROL_BOT_TOKEN;
const controlChatId = process.env.CONTROL_CHAT_ID;
const controlBot = controlToken ? new TelegramBot(controlToken) : null;
const TELEGRAM_MAX_TEXT_CHARS = 3000;
const TELEGRAM_MAX_CAPTION_CHARS = 900;
const TYPING_REFRESH_MS = 4000;
const IMAGE_ONLY_PLACEHOLDER = 'Пользователь отправил изображение.';
const pendingMediaGroups = new Map();

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

function getMediaGroupWaitMs() {
  const parsed = parseInt(process.env.TELEGRAM_MEDIA_GROUP_WAIT_MS || '900', 10);
  if (Number.isNaN(parsed) || parsed < 200) return 900;
  return Math.min(parsed, 4000);
}

function getMediaGroupMaxImages() {
  const parsed = parseInt(process.env.TELEGRAM_MEDIA_GROUP_MAX || '10', 10);
  if (Number.isNaN(parsed) || parsed < 2) return 10;
  return Math.min(parsed, 10);
}

function mediaGroupKey(botId, chatId, groupId) {
  return `${botId}:${chatId}:${groupId}`;
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

function extractTelegramUserText(msg, imageFileId) {
  const messageText = typeof msg.text === 'string' && msg.text.trim()
    ? msg.text.trim()
    : '';
  const messageCaption = typeof msg.caption === 'string' && msg.caption.trim()
    ? msg.caption.trim()
    : '';
  if (messageText || messageCaption) {
    return messageText || messageCaption;
  }
  return imageFileId ? IMAGE_ONLY_PLACEHOLDER : '';
}

function collectAlbumUserMessage(items) {
  const captions = [];
  for (const item of items) {
    const text = String(item.userMessage || '').trim();
    if (text && text !== IMAGE_ONLY_PLACEHOLDER && !captions.includes(text)) {
      captions.push(text);
    }
  }
  if (captions.length) return captions.join('\n');
  if (items.some((item) => item.imageFileId)) return IMAGE_ONLY_PLACEHOLDER;
  return '';
}

async function processTelegramTurn({
  bot,
  botId,
  chatId,
  conversationUserId,
  userName,
  userHandle,
  userMessage,
  imagePayload,
  imageFileId,
}) {
  console.log(
    `[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] ${userName} (${userHandle}): ${userMessage}`
  );

  if (!userMessage) {
    await bot.sendMessage(chatId, 'Пришли текст или изображение, и я помогу.');
    return;
  }

  await ensureUser(conversationUserId, userName, userHandle);

  if (userMessage === '/reset') {
    await pool.query('DELETE FROM sessions WHERE user_id = ? AND bot_id = ?', [conversationUserId, botId]);
    await pool.query('DELETE FROM messages WHERE user_id = ? AND bot_id = ?', [conversationUserId, botId]);
    await deleteUserContext(conversationUserId);
    await seedSessionAfterReset(conversationUserId, botId);
    await touchUser(conversationUserId);

    console.log(
      `[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] ✅ Reset completed; next message → /start`
    );
    bot.sendMessage(chatId, '🔄 История диалога и персональный контекст очищены. Чем могу помочь?');
    if (controlBot && controlChatId) {
      controlBot.sendMessage(controlChatId, `🔄 Сброс (Bot #${botId}): ${userName} (chat:${chatId}, user:${conversationUserId})`);
    }
    return;
  }

  await touchUser(conversationUserId);
  await addMessage(conversationUserId, 'user', userMessage, botId);

  const chatAction = pickTelegramChatAction({ imageFileId, userMessage });
  const result = await runWithTelegramChatAction(bot, chatId, chatAction, () =>
    processUserMessage({
      botId,
      userId: conversationUserId,
      userMessage,
      imagePayload,
    })
  );

  console.log(
    `[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] Command: ${result.newCommand} type: ${result.type}`
  );

  if (controlBot && controlChatId) {
    const cleanChatId = controlChatId.trim();
    const photoHint = Array.isArray(imagePayload) && imagePayload.length > 1
      ? ` 🖼×${imagePayload.length}`
      : (result.type === 'image' ? ' 🖼' : '');
    const notifyText = `\n📩 (Bot #${botId}) Новое сообщение:\n👤 ${userName} (chat:${chatId}, user:${conversationUserId})\n💬 "${userMessage}"\n🔄 → ${result.newCommand}${photoHint}\n`;

    controlBot
      .sendMessage(cleanChatId, notifyText)
      .then(() => console.log(`[Control Bot] ✅ Notification sent to ${cleanChatId}`))
      .catch((err) => console.error(`[Control Bot] ❌ Failed to send notification: ${err.message}`));
  }

  await addMessage(conversationUserId, 'assistant', result.reply, botId);
  await touchUser(conversationUserId);

  if (result.type === 'image' && result.imageDataUrl) {
    await sendTelegramPhotoWithReply(bot, chatId, result.imageDataUrl, result.reply);
  } else {
    await sendTelegramText(bot, chatId, result.reply);
  }
}

async function flushTelegramMediaGroup(bot, botId, items) {
  if (!Array.isArray(items) || items.length === 0) return;

  const first = items[0];
  const chatId = first.chatId;
  const conversationUserId = first.conversationUserId;
  const userName = first.userName;
  const userHandle = first.userHandle;
  const userMessage = collectAlbumUserMessage(items);
  const maxImages = getMediaGroupMaxImages();
  const limited = items.slice(0, maxImages);

  const imagePayload = [];
  for (const item of limited) {
    if (!item.imageFileId) continue;
    try {
      const dataUrl = await buildTelegramImageDataUrl(bot, item.msg, item.imageFileId);
      imagePayload.push(dataUrl);
    } catch (imgErr) {
      console.error(
        `[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] Album image download failed:`,
        imgErr.message || imgErr
      );
    }
  }

  console.log(
    `[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] media_group photos=${imagePayload.length}`
  );

  try {
    await processTelegramTurn({
      bot,
      botId,
      chatId,
      conversationUserId,
      userName,
      userHandle,
      userMessage,
      imagePayload: imagePayload.length > 1 ? imagePayload : (imagePayload[0] || null),
      imageFileId: imagePayload[0] ? 'album' : null,
    });
  } catch (error) {
    console.error(`[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] Error:`, error);
    bot.sendMessage(chatId, 'Произошла ошибка, попробуйте позже.');
    if (controlBot && controlChatId) {
      controlBot.sendMessage(controlChatId, `❌ Ошибка (Bot #${botId}): ${userName} (chat:${chatId}, user:${conversationUserId}): ${error.message}`);
    }
  }
}

async function downloadSingleTelegramImage(bot, botId, chatId, conversationUserId, msg, imageFileId) {
  if (!imageFileId) return null;
  try {
    return await buildTelegramImageDataUrl(bot, msg, imageFileId);
  } catch (imgErr) {
    console.error(
      `[Bot #${botId}] [chat:${chatId}] [user:${conversationUserId}] Image download failed:`,
      imgErr.message || imgErr
    );
    return null;
  }
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

function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/[\w+.-]+;base64,(.+)$/i.exec(String(dataUrl));
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

function formatTelegramHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
}

function splitTelegramText(text, maxChars = TELEGRAM_MAX_TEXT_CHARS) {
  const source = String(text || '').trim();
  if (!source) return [];

  const chunks = [];
  let rest = source;

  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n', maxChars);
    if (cut < Math.floor(maxChars * 0.5)) {
      cut = rest.lastIndexOf(' ', maxChars);
    }
    if (cut < Math.floor(maxChars * 0.5)) {
      cut = maxChars;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) {
    chunks.push(rest);
  }

  return chunks.filter(Boolean);
}

async function sendTelegramText(bot, chatId, text) {
  const chunks = splitTelegramText(text);
  if (chunks.length === 0) {
    await bot.sendMessage(chatId, ' ');
    return;
  }

  for (const chunk of chunks) {
    await bot.sendMessage(chatId, formatTelegramHtml(chunk), { parse_mode: 'HTML' });
  }
}

function pickTelegramChatAction({ imageFileId, userMessage }) {
  if (imageFileId) {
    return 'upload_photo';
  }

  const lower = String(userMessage || '').toLowerCase();
  const imageHints = [
    'нарисуй',
    'сгенерируй',
    'картинк',
    'изображен',
    'добавь',
    'замени',
    'измени',
    'поправ',
    'убери',
    'сделай меня',
    'фото',
  ];
  if (imageHints.some((hint) => lower.includes(hint))) {
    return 'upload_photo';
  }

  const visionHints = ['позе', 'поза', 'опиши', 'проанализируй', 'что на фото', 'ocr', '/ocr'];
  if (visionHints.some((hint) => lower.includes(hint))) {
    return 'typing';
  }

  return 'typing';
}

async function runWithTelegramChatAction(bot, chatId, action, work) {
  const sendAction = async () => {
    try {
      await bot.sendChatAction(chatId, action);
    } catch (_) {
      // ignore chat action errors
    }
  };

  await sendAction();
  const timer = setInterval(sendAction, TYPING_REFRESH_MS);

  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

async function sendTelegramPhotoWithReply(bot, chatId, imageDataUrl, replyText) {
  const caption = formatTelegramHtml(replyText);

  if (caption.length <= TELEGRAM_MAX_CAPTION_CHARS) {
    const photoOptions = { caption, parse_mode: 'HTML' };
    if (String(imageDataUrl).startsWith('data:')) {
      const buffer = dataUrlToBuffer(imageDataUrl);
      if (buffer) {
        await bot.sendPhoto(chatId, buffer, photoOptions);
        return;
      }
    } else {
      await bot.sendPhoto(chatId, imageDataUrl, photoOptions);
      return;
    }
  }

  if (String(imageDataUrl).startsWith('data:')) {
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (buffer) {
      await bot.sendPhoto(chatId, buffer);
    } else {
      await bot.sendMessage(chatId, 'Картинка готова, но подпись была слишком длинной.');
    }
  } else {
    await bot.sendPhoto(chatId, imageDataUrl);
  }

  if (replyText && String(replyText).trim()) {
    await sendTelegramText(bot, chatId, replyText);
  }
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
      const userMessage = extractTelegramUserText(msg, imageFileId);
      const userName = msg.from.first_name || 'Пользователь';
      const userHandle = msg.from.username ? `@${msg.from.username}` : null;
      const groupId = msg.media_group_id ? String(msg.media_group_id) : '';

      if (groupId && imageFileId) {
        const key = mediaGroupKey(botId, chatId, groupId);
        let pending = pendingMediaGroups.get(key);
        if (!pending) {
          pending = { items: [], timer: null };
          pendingMediaGroups.set(key, pending);
        }
        pending.items.push({
          msg,
          imageFileId,
          userMessage,
          userName,
          userHandle,
          conversationUserId,
          chatId,
        });
        pending.items.sort((a, b) => (a.msg.message_id || 0) - (b.msg.message_id || 0));
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = setTimeout(() => {
          pendingMediaGroups.delete(key);
          flushTelegramMediaGroup(bot, botId, pending.items).catch((error) => {
            console.error(`[Bot #${botId}] media_group flush error:`, error);
          });
        }, getMediaGroupWaitMs());
        return;
      }

      try {
        const imagePayload = await downloadSingleTelegramImage(
          bot,
          botId,
          chatId,
          conversationUserId,
          msg,
          imageFileId
        );
        await processTelegramTurn({
          bot,
          botId,
          chatId,
          conversationUserId,
          userName,
          userHandle,
          userMessage,
          imagePayload,
          imageFileId,
        });
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
    const prefix = `${botId}:`;
    for (const [key, pending] of pendingMediaGroups.entries()) {
      if (key.startsWith(prefix)) {
        if (pending.timer) clearTimeout(pending.timer);
        pendingMediaGroups.delete(key);
      }
    }
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
