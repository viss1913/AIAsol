const { getCommandResponse } = require('./context');
const { prepareImageGenPrompt, generateImageOpenRouter } = require('./ai');
const { compressImageDataUrl } = require('./imageCompress');
const {
  IMAGE_COMMANDS,
  resolveReferenceImage,
  usesMetaPrompt,
  imageByteLength,
  getLastUserImageTtlMinutes,
} = require('./imageAssets');

const DEFAULT_REPLY_OK = 'Готово! Вот изображение.';
const IMAGE_ONLY_PLACEHOLDER = 'Пользователь отправил изображение.';

const DEFAULT_META_TEMPLATES = {
  '/correct_image_my':
    'Подготовь точный промпт для редактирования приложенного изображения пользователя. Сохрани ключевые элементы исходника, измени только то, что просит пользователь. Верни только промпт на английском.',
  '/correct_image_your':
    'Подготовь точный промпт для редактирования последней картинки, которую сгенерировал бот. Сохрани композицию и ракурс, измени только то, что просит пользователь. Верни только промпт на английском.',
  '/create_image':
    'Реалистичное изображение, высокая детализация, естественное освещение.',
};

function isImageCommand(command) {
  return IMAGE_COMMANDS.includes(String(command || '').trim());
}

function getContextMessageLimit() {
  const parsed = parseInt(process.env.IMAGE_PROMPT_CONTEXT_MESSAGES || '10', 10);
  if (Number.isNaN(parsed) || parsed < 1) return 10;
  return Math.min(parsed, 50);
}

function getMaxStoredImageBytes() {
  const parsed = parseInt(process.env.MAX_STORED_IMAGE_BYTES || '14680064', 10);
  if (Number.isNaN(parsed) || parsed < 1) return 14680064;
  return parsed;
}

async function prepareStoredImage(imageDataUrl) {
  if (!imageDataUrl || !String(imageDataUrl).trim()) {
    return null;
  }
  const str = String(imageDataUrl).trim();
  if (str.startsWith('http://') || str.startsWith('https://')) {
    return str;
  }

  try {
    const compressed = await compressImageDataUrl(str, 'storage');
    const bytes = Buffer.byteLength(compressed, 'utf8');
    const maxBytes = getMaxStoredImageBytes();
    if (bytes > maxBytes) {
      console.warn(
        `[imageGen] Image still above MAX_STORED_IMAGE_BYTES after compress (${bytes} > ${maxBytes})`
      );
    }
    return compressed;
  } catch (error) {
    console.warn('[imageGen] prepareStoredImage compress failed:', error.message);
    return trimImageForStorage(str) || str;
  }
}

function sliceHistoryForMeta(history, limit) {
  if (!Array.isArray(history)) return [];
  return history.slice(-limit).map((item) => ({
    role: item.role,
    content: item.content,
  }));
}

function trimImageForStorage(imageDataUrl) {
  if (!imageDataUrl || !String(imageDataUrl).trim()) {
    return null;
  }
  const str = String(imageDataUrl);
  const maxBytes = getMaxStoredImageBytes();
  if (Buffer.byteLength(str, 'utf8') > maxBytes) {
    console.warn(
      `[imageGen] Generated image exceeds MAX_STORED_IMAGE_BYTES (${maxBytes}), not storing in session`
    );
    return null;
  }
  return str;
}

function formatImageGenError(errorCode, debug = false) {
  const code = String(errorCode || 'unknown');
  let msg = 'Не удалось сгенерировать изображение. Попробуй переформулировать запрос.';
  if (code === 'no_image') {
    msg = 'Модель не вернула картинку. Попробуй упростить описание или сменить формулировку.';
  } else if (code === '400' || code === '403' || code === '422') {
    msg = 'Запрос отклонён политикой или параметрами модели. Попробуй другое описание.';
  }
  if (debug && code !== 'null') {
    msg += ` (код: ${code})`;
  }
  return msg;
}

function isDebugImageGen() {
  return String(process.env.DEBUG_IMAGE_GEN || '').trim() === '1';
}

async function runImageWithReference({
  botId,
  command,
  userMessage,
  history,
  metaTemplate,
  referenceUrl,
  systemInstruction = '',
}) {
  const limit = getContextMessageLimit();
  let genPrompt;
  let system = systemInstruction;

  if (usesMetaPrompt(command, { url: referenceUrl })) {
    const historySlice =
      command === '/correct_image_your'
        ? [{ role: 'user', content: userMessage }]
        : sliceHistoryForMeta(history, limit);

    genPrompt = await prepareImageGenPrompt(metaTemplate, {
      userMessage,
      historySlice,
      hasUserImage: Boolean(referenceUrl),
      mode: command.replace('/', ''),
    });
  } else {
    genPrompt = String(userMessage).trim();
    if (metaTemplate?.trim()) {
      system = metaTemplate.trim();
    }
  }

  return generateImageOpenRouter(genPrompt, referenceUrl, system);
}

async function runImagePipeline({
  botId,
  newCommand,
  userMessage,
  history = [],
  imagePayload = null,
  lastGeneratedImage = null,
  lastUserImage = null,
}) {
  const command = String(newCommand || '').trim();
  const metaTemplate =
    (await getCommandResponse(botId, command)) || DEFAULT_META_TEMPLATES[command] || '';

  const ref = resolveReferenceImage({
    command,
    imagePayload,
    lastUserImage,
    lastGeneratedImage,
    userMessage,
  });

  console.log(
    `[imageGen] cmd=${command} ref=${ref.source} refBytes=${imageByteLength(ref.url)} user=${history?.length ?? 0} msgs`
  );

  if (
    ref.url &&
    String(userMessage).trim() === IMAGE_ONLY_PLACEHOLDER &&
    (command === '/correct_image_my' || (command === '/create_image' && ref.source === 'upload'))
  ) {
    return {
      ok: false,
      replyText:
        'К фото добавь подпись — что нарисовать или что изменить (например: «добавь кепку мужчине»).',
      imageDataUrl: null,
      errorCode: 'image_needs_caption',
      refSource: ref.source,
    };
  }

  if (command === '/correct_image_my' && !ref.url) {
    const ttlMin = getLastUserImageTtlMinutes();
    return {
      ok: false,
      replyText: `Пришли фото вместе с описанием или используй недавно загруженное (хранится ${ttlMin} мин).`,
      imageDataUrl: null,
      errorCode: 'no_user_image',
      refSource: ref.source,
    };
  }

  if (command === '/correct_image_your' && !ref.url) {
    const ttlMin = parseInt(process.env.LAST_GENERATED_IMAGE_TTL_MINUTES || '10', 10) || 10;
    return {
      ok: false,
      replyText: `Нет свежей картинки бота для правки (хранится ${ttlMin} мин). Сгенерируй новую или пришли фото с описанием.`,
      imageDataUrl: null,
      errorCode: 'no_bot_image',
      refSource: ref.source,
    };
  }

  const generated = await runImageWithReference({
    botId,
    command,
    userMessage,
    history,
    metaTemplate,
    referenceUrl: ref.url
      ? await compressReferenceForApi(ref.url)
      : null,
    systemInstruction: command === '/create_image' && !ref.url ? metaTemplate : '',
  });

  const debug = isDebugImageGen();

  if (!generated.ok || !generated.imageUrl) {
    console.error(
      `[imageGen] generate failed cmd=${command} ref=${ref.source} errorCode=${generated.errorCode}`
    );
    return {
      ok: false,
      replyText: formatImageGenError(generated.errorCode, debug),
      imageDataUrl: null,
      errorCode: generated.errorCode,
      refSource: ref.source,
    };
  }

  const storedImage = await prepareStoredImage(generated.imageUrl);

  return {
    ok: true,
    replyText: generated.text?.trim() || DEFAULT_REPLY_OK,
    imageDataUrl: storedImage || generated.imageUrl,
    storedImage,
    errorCode: null,
    refSource: ref.source,
  };
}

async function compressReferenceForApi(referenceUrl) {
  if (!referenceUrl || !String(referenceUrl).startsWith('data:')) {
    return referenceUrl;
  }
  try {
    const compressed = await compressImageDataUrl(referenceUrl, 'reference');
    console.log(
      `[imageGen] ref compressed refBytes=${imageByteLength(compressed)} (was ${imageByteLength(referenceUrl)})`
    );
    return compressed;
  } catch (error) {
    console.warn('[imageGen] ref compress failed:', error.message);
    return referenceUrl;
  }
}

module.exports = {
  IMAGE_COMMANDS,
  isImageCommand,
  sliceHistoryForMeta,
  runImagePipeline,
  formatImageGenError,
  isDebugImageGen,
};
