const { getCommandResponse } = require('./context');
const { prepareImageGenPrompt, generateImageOpenRouter } = require('./ai');

const IMAGE_COMMANDS = ['/create_image', '/correct_image_my', '/correct_image_your'];

const DEFAULT_REPLY_OK = 'Готово! Вот изображение.';
const DEFAULT_REPLY_FAIL = 'Не удалось сгенерировать изображение. Попробуй ещё раз.';

function isImageCommand(command) {
  return IMAGE_COMMANDS.includes(String(command || '').trim());
}

function getContextMessageLimit() {
  const parsed = parseInt(process.env.IMAGE_PROMPT_CONTEXT_MESSAGES || '10', 10);
  if (Number.isNaN(parsed) || parsed < 1) return 10;
  return Math.min(parsed, 50);
}

function getMaxStoredImageBytes() {
  const parsed = parseInt(process.env.MAX_STORED_IMAGE_BYTES || '1572864', 10);
  if (Number.isNaN(parsed) || parsed < 1) return 1572864;
  return parsed;
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

async function runImagePipeline({
  botId,
  newCommand,
  userMessage,
  history = [],
  imagePayload = null,
  lastGeneratedImage = null,
}) {
  const command = String(newCommand || '').trim();
  const metaTemplate = await getCommandResponse(botId, command);
  const limit = getContextMessageLimit();

  if (command === '/correct_image_my') {
    if (!imagePayload) {
      return {
        ok: false,
        replyText: 'Пришли фото вместе с описанием, что нужно изменить.',
        imageDataUrl: null,
      };
    }

    const historySlice = sliceHistoryForMeta(history, limit);
    const genPrompt = await prepareImageGenPrompt(metaTemplate, {
      userMessage,
      historySlice,
      hasUserImage: true,
      mode: 'correct_image_my',
    });

    const generated = await generateImageOpenRouter(genPrompt, imagePayload);
    if (!generated.ok || !generated.imageUrl) {
      return {
        ok: false,
        replyText: DEFAULT_REPLY_FAIL,
        imageDataUrl: null,
      };
    }

    return {
      ok: true,
      replyText: generated.text?.trim() || DEFAULT_REPLY_OK,
      imageDataUrl: generated.imageUrl,
      storedImage: trimImageForStorage(generated.imageUrl),
    };
  }

  if (command === '/correct_image_your') {
    if (!lastGeneratedImage) {
      return {
        ok: false,
        replyText: 'Сначала нужно сгенерировать изображение, потом можно его править.',
        imageDataUrl: null,
      };
    }

    const historySlice = [{ role: 'user', content: userMessage }];
    const genPrompt = await prepareImageGenPrompt(metaTemplate, {
      userMessage,
      historySlice,
      hasUserImage: false,
      mode: 'correct_image_your',
    });

    const generated = await generateImageOpenRouter(genPrompt, lastGeneratedImage);
    if (!generated.ok || !generated.imageUrl) {
      return {
        ok: false,
        replyText: DEFAULT_REPLY_FAIL,
        imageDataUrl: null,
      };
    }

    return {
      ok: true,
      replyText: generated.text?.trim() || DEFAULT_REPLY_OK,
      imageDataUrl: generated.imageUrl,
      storedImage: trimImageForStorage(generated.imageUrl),
    };
  }

  if (command === '/create_image') {
    const genPrompt = String(userMessage).trim();
    const systemInstruction = metaTemplate?.trim() || '';

    const generated = await generateImageOpenRouter(genPrompt, null, systemInstruction);
    if (!generated.ok || !generated.imageUrl) {
      return {
        ok: false,
        replyText: DEFAULT_REPLY_FAIL,
        imageDataUrl: null,
      };
    }

    return {
      ok: true,
      replyText: generated.text?.trim() || DEFAULT_REPLY_OK,
      imageDataUrl: generated.imageUrl,
      storedImage: trimImageForStorage(generated.imageUrl),
    };
  }

  return {
    ok: false,
    replyText: 'Неизвестная команда генерации изображений.',
    imageDataUrl: null,
  };
}

module.exports = {
  IMAGE_COMMANDS,
  isImageCommand,
  sliceHistoryForMeta,
  runImagePipeline,
};
