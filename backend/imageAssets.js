const { pool } = require('./db');
const { compressImageDataUrl } = require('./imageCompress');

const IMAGE_COMMANDS = ['/create_image', '/correct_image_my', '/correct_image_your'];
const OCR_COMMAND = '/ocr';

const DEFAULT_REFERENCE_KEYWORDS = [
  'этот',
  'эта',
  'это',
  'эту',
  'график',
  'картин',
  'изображен',
  'фото',
  'вставь',
  'на экран',
  'тот же',
  'ту же',
];

const DEFAULT_EDIT_KEYWORDS = [
  'измени',
  'поправ',
  'исправ',
  'замени',
  'вместо',
  'сделай',
  'днём',
  'днем',
  'ночью',
  'добавь',
  'убери',
  'телепуз',
  'тот же',
  'ту же',
  'эту',
  'этот',
  'это',
];

const DEFAULT_ANALYSIS_KEYWORDS = [
  'позе',
  'поза',
  'позу',
  'опиши',
  'описать',
  'проанализируй',
  'анализируй',
  'анализ',
  'что на фото',
  'что на картин',
  'что изображ',
  'что видишь',
  'что вижу',
  'расскажи о',
  'какой я',
  'какая я',
  'кто на фото',
  'где я',
  'что за',
  'какого цвета',
  'сколько',
  'describe',
  'analyze',
];

function getLastUserImageTtlMinutes() {
  const parsed = parseInt(process.env.LAST_USER_IMAGE_TTL_MINUTES || '30', 10);
  if (Number.isNaN(parsed) || parsed < 1) return 30;
  return parsed;
}

function getReferenceKeywords() {
  const raw = (process.env.IMAGE_REFERENCE_KEYWORDS || '').trim();
  if (!raw) return DEFAULT_REFERENCE_KEYWORDS;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function getEditKeywords() {
  const raw = (process.env.IMAGE_EDIT_KEYWORDS || '').trim();
  if (!raw) return DEFAULT_EDIT_KEYWORDS;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function getAnalysisKeywords() {
  const raw = (process.env.IMAGE_ANALYSIS_KEYWORDS || '').trim();
  if (!raw) return DEFAULT_ANALYSIS_KEYWORDS;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function matchesKeywords(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function wantsPriorUserImage(userMessage) {
  return matchesKeywords(userMessage, getReferenceKeywords());
}

function wantsEditOfBotImage(userMessage) {
  return matchesKeywords(userMessage, getEditKeywords());
}

function wantsImageAnalysis(userMessage) {
  return matchesKeywords(userMessage, getAnalysisKeywords());
}

function resolveVisionImage({
  imagePayload = null,
  lastUserImage = null,
  lastGeneratedImage = null,
}) {
  if (imagePayload && String(imagePayload).trim()) {
    return { url: String(imagePayload).trim(), source: 'upload' };
  }
  if (lastGeneratedImage) {
    return { url: lastGeneratedImage, source: 'session_bot' };
  }
  if (lastUserImage) {
    return { url: lastUserImage, source: 'session_user' };
  }
  return { url: null, source: 'none' };
}

function isTimestampExpired(imageAt, ttlMinutes) {
  if (!imageAt) return true;
  const ts = imageAt instanceof Date ? imageAt.getTime() : new Date(imageAt).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > ttlMinutes * 60 * 1000;
}

function imageByteLength(url) {
  if (!url) return 0;
  return Buffer.byteLength(String(url), 'utf8');
}

async function saveUserImage(userId, botId, imagePayload) {
  if (!imagePayload || !String(imagePayload).trim()) return;

  let payload = String(imagePayload).trim();
  if (payload.startsWith('data:')) {
    try {
      payload = await compressImageDataUrl(payload, 'storage');
    } catch (error) {
      console.warn('[imageAssets] compress user image failed:', error.message);
    }
  }

  await pool.query(
    `INSERT INTO sessions (user_id, bot_id, last_user_image, last_user_image_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       last_user_image = VALUES(last_user_image),
       last_user_image_at = VALUES(last_user_image_at)`,
    [String(userId), botId, payload]
  );
  console.log(
    `[imageAssets] last_user_image saved (${imageByteLength(payload)} bytes, user=${userId}, bot=${botId})`
  );
}

async function clearExpiredUserImage(userId, botId) {
  await pool.query(
    `UPDATE sessions SET last_user_image = NULL, last_user_image_at = NULL
     WHERE user_id = ? AND bot_id = ?`,
    [String(userId), botId]
  );
}

async function resolveLastUserImage(row, userId, botId) {
  const raw = row.last_user_image || null;
  if (!raw) return null;

  const ttl = getLastUserImageTtlMinutes();
  if (!isTimestampExpired(row.last_user_image_at, ttl)) {
    return raw;
  }

  console.log(
    `[imageAssets] last_user_image expired (user=${userId}, bot=${botId}, ttl=${ttl}m)`
  );
  await clearExpiredUserImage(userId, botId);
  return null;
}

function resolveReferenceImage({
  command,
  imagePayload = null,
  lastUserImage = null,
  lastGeneratedImage = null,
  userMessage = '',
}) {
  const cmd = String(command || '').trim();
  const upload = imagePayload && String(imagePayload).trim() ? String(imagePayload).trim() : null;

  if (cmd === '/correct_image_your') {
    if (lastGeneratedImage) {
      return { url: lastGeneratedImage, source: 'session_bot' };
    }
    return { url: null, source: 'none' };
  }

  if (cmd === '/correct_image_my') {
    if (upload) return { url: upload, source: 'upload' };
    if (lastUserImage) return { url: lastUserImage, source: 'session_user' };
    return { url: null, source: 'none' };
  }

  if (cmd === '/create_image') {
    if (upload) return { url: upload, source: 'upload' };
    if (wantsPriorUserImage(userMessage) && lastUserImage) {
      return { url: lastUserImage, source: 'session_user' };
    }
    return { url: null, source: 'none' };
  }

  return { url: null, source: 'none' };
}

function usesMetaPrompt(command, ref) {
  const cmd = String(command || '').trim();
  if (cmd === '/correct_image_my' || cmd === '/correct_image_your') return true;
  if (cmd === '/create_image' && ref.url) return true;
  return false;
}

function isImageCommandName(command) {
  return IMAGE_COMMANDS.includes(String(command || '').trim());
}

function normalizeCommand(command) {
  const cmd = String(command || '').trim();
  if (cmd.toLowerCase() === '/ocr') {
    return OCR_COMMAND;
  }
  return cmd;
}

function isOcrCommand(command) {
  return normalizeCommand(command) === OCR_COMMAND;
}

module.exports = {
  IMAGE_COMMANDS,
  OCR_COMMAND,
  wantsPriorUserImage,
  wantsEditOfBotImage,
  wantsImageAnalysis,
  resolveVisionImage,
  normalizeCommand,
  isOcrCommand,
  saveUserImage,
  resolveLastUserImage,
  resolveReferenceImage,
  usesMetaPrompt,
  isImageCommandName,
  imageByteLength,
  getLastUserImageTtlMinutes,
};
