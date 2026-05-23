const { pool } = require('./db');
const { classifyIntent, askAI, analyzeImageWithVision } = require('./ai');
const {
  getClassifierContext,
  getResponseContext,
  getImageVisionContext,
  injectVisionIntoContext,
} = require('./context');
const { isImageCommand, runImagePipeline, isDebugImageGen } = require('./imageGen');
const {
  saveUserImage,
  resolveLastUserImage,
  wantsEditOfBotImage,
} = require('./imageAssets');

function getLastGeneratedImageTtlMinutes() {
  const parsed = parseInt(process.env.LAST_GENERATED_IMAGE_TTL_MINUTES || '10', 10);
  if (Number.isNaN(parsed) || parsed < 1) return 10;
  return parsed;
}

function isLastGeneratedImageExpired(imageAt) {
  if (!imageAt) return true;
  const ts = imageAt instanceof Date ? imageAt.getTime() : new Date(imageAt).getTime();
  if (Number.isNaN(ts)) return true;
  const ttlMs = getLastGeneratedImageTtlMinutes() * 60 * 1000;
  return Date.now() - ts > ttlMs;
}

async function resolveLastGeneratedImage(row, userId, botId) {
  const raw = row.last_generated_image || null;
  if (!raw) return null;

  if (!isLastGeneratedImageExpired(row.last_generated_image_at)) {
    return raw;
  }

  console.log(
    `[chatPipeline] last_generated_image expired (user=${userId}, bot=${botId}, ttl=${getLastGeneratedImageTtlMinutes()}m)`
  );
  await pool.query(
    `UPDATE sessions SET last_generated_image = NULL, last_generated_image_at = NULL
     WHERE user_id = ? AND bot_id = ?`,
    [String(userId), botId]
  );
  return null;
}

function normalizeHistory(history) {
  if (history == null) return [];
  if (typeof history === 'string') {
    try {
      history = JSON.parse(history);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(history)) return [];
  return history;
}

async function loadSession(userId, botId) {
  const [rows] = await pool.query(
    'SELECT * FROM sessions WHERE user_id = ? AND bot_id = ?',
    [String(userId), botId]
  );
  if (rows.length > 0) {
    const row = rows[0];
    const lastGeneratedImage = await resolveLastGeneratedImage(row, userId, botId);
    const lastUserImage = await resolveLastUserImage(row, userId, botId);
    return {
      last_command: row.last_command || '/start',
      history: normalizeHistory(row.history),
      last_generated_image: lastGeneratedImage,
      last_user_image: lastUserImage,
      after_reset: Boolean(row.after_reset),
    };
  }
  return {
    last_command: '/start',
    history: [],
    last_generated_image: null,
    last_user_image: null,
    after_reset: false,
  };
}

async function seedSessionAfterReset(userId, botId) {
  await pool.query(
    `INSERT INTO sessions (user_id, bot_id, last_command, history, last_generated_image, last_generated_image_at, last_user_image, last_user_image_at, after_reset)
     VALUES (?, ?, '/start', '[]', NULL, NULL, NULL, NULL, 1)
     ON DUPLICATE KEY UPDATE
       last_command = '/start',
       history = '[]',
       last_generated_image = NULL,
       last_generated_image_at = NULL,
       last_user_image = NULL,
       last_user_image_at = NULL,
       after_reset = 1`,
    [String(userId), botId]
  );
}

async function saveSession(userId, botId, lastCommand, history, lastGeneratedImage = undefined) {
  const hasImageUpdate = lastGeneratedImage !== undefined;
  if (hasImageUpdate) {
    const imageAt = lastGeneratedImage ? new Date() : null;
    await pool.query(
      `INSERT INTO sessions (user_id, bot_id, last_command, history, last_generated_image, last_generated_image_at, after_reset)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         last_command = VALUES(last_command),
         history = VALUES(history),
         last_generated_image = VALUES(last_generated_image),
         last_generated_image_at = VALUES(last_generated_image_at),
         after_reset = 0`,
      [
        String(userId),
        botId,
        lastCommand,
        JSON.stringify(history),
        lastGeneratedImage,
        imageAt,
      ]
    );
    return;
  }

  await pool.query(
    `INSERT INTO sessions (user_id, bot_id, last_command, history, after_reset)
     VALUES (?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       last_command = VALUES(last_command),
       history = VALUES(history),
       after_reset = 0`,
    [String(userId), botId, lastCommand, JSON.stringify(history)]
  );
}

function buildAssistantHistoryEntry(replyText, isImage) {
  if (isImage) {
    return `[image] ${replyText}`;
  }
  return replyText;
}

function shouldRerouteToCorrectYour(command, userMessage, lastGeneratedImage) {
  if (String(process.env.IMAGE_EDIT_REROUTE || '1').trim() !== '1') {
    return false;
  }
  if (command !== '/create_image' || !lastGeneratedImage) {
    return false;
  }
  return wantsEditOfBotImage(userMessage);
}

/**
 * Unified chat processing for Partner API and Telegram.
 */
async function processUserMessage({
  botId,
  userId,
  userMessage,
  imagePayload = null,
}) {
  if (imagePayload) {
    await saveUserImage(userId, botId, imagePayload);
  }

  const session = await loadSession(userId, botId);
  const lastCmd = session.last_command || '/start';
  const history = session.history;
  const lastGeneratedImage = session.last_generated_image;
  const lastUserImage = session.last_user_image;

  let newCommand;
  if (session.after_reset) {
    newCommand = '/start';
    console.log(`[chatPipeline] after_reset → force /start (user=${userId}, bot=${botId})`);
  } else {
    const classifierContext = await getClassifierContext(botId, lastCmd);
    newCommand = await classifyIntent(userMessage, classifierContext);
  }

  if (shouldRerouteToCorrectYour(newCommand, userMessage, lastGeneratedImage)) {
    console.warn(
      `[chatPipeline] reroute /create_image → /correct_image_your (user=${userId}, bot=${botId})`
    );
    newCommand = '/correct_image_your';
  }

  if (isImageCommand(newCommand)) {
    const imageResult = await runImagePipeline({
      botId,
      newCommand,
      userMessage,
      history,
      imagePayload,
      lastGeneratedImage,
      lastUserImage,
    });

    const replyText = imageResult.replyText;
    const assistantEntry = buildAssistantHistoryEntry(replyText, imageResult.ok);

    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: assistantEntry });

    const storedImage = imageResult.ok
      ? imageResult.storedImage || imageResult.imageDataUrl || lastGeneratedImage
      : lastGeneratedImage;

    if (imageResult.ok && !storedImage) {
      console.warn(
        `[chatPipeline] Image generated but nothing to store (user=${userId}, bot=${botId}, cmd=${newCommand})`
      );
    } else if (imageResult.ok && storedImage) {
      console.log(
        `[chatPipeline] last_generated_image saved (${Buffer.byteLength(String(storedImage), 'utf8')} bytes, user=${userId})`
      );
    }

    await saveSession(userId, botId, newCommand, history, storedImage);

    const imageGenDebug = isDebugImageGen()
      ? {
          command: newCommand,
          refSource: imageResult.refSource,
          errorCode: imageResult.errorCode,
        }
      : undefined;

    return {
      type: imageResult.ok ? 'image' : 'error',
      newCommand,
      reply: replyText,
      imageDataUrl: imageResult.imageDataUrl || null,
      history,
      lastGeneratedImage: storedImage,
      visionDebug: { triggered: false, ok: null, errorCode: null },
      imageGenDebug,
    };
  }

  let responseContext = await getResponseContext(botId, newCommand, userId);

  const visionDebug = {
    triggered: false,
    ok: null,
    errorCode: null,
  };

  const imageVisionContext = await getImageVisionContext(botId, newCommand);
  if (imagePayload && imageVisionContext.trim()) {
    visionDebug.triggered = true;
    const vision = await analyzeImageWithVision(userMessage, imagePayload, imageVisionContext);
    visionDebug.ok = vision.ok;
    visionDebug.errorCode = vision.errorCode;
    responseContext = injectVisionIntoContext(responseContext, vision.text, imageVisionContext);
  }

  const reply = await askAI(userMessage, responseContext, history);

  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: reply });
  await saveSession(userId, botId, newCommand, history);

  return {
    type: 'text',
    newCommand,
    reply,
    imageDataUrl: null,
    history,
    lastGeneratedImage,
    visionDebug,
  };
}

module.exports = {
  processUserMessage,
  loadSession,
  saveSession,
  seedSessionAfterReset,
  normalizeHistory,
};
