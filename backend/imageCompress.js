let sharpModule = null;
let sharpLoadFailed = false;

function getSharp() {
  if (sharpLoadFailed) {
    return null;
  }
  if (sharpModule) {
    return sharpModule;
  }
  try {
    sharpModule = require('sharp');
    return sharpModule;
  } catch (error) {
    sharpLoadFailed = true;
    console.warn('[imageCompress] sharp unavailable, skipping compression:', error.message);
    return null;
  }
}

function readIntEnv(name, fallback) {
  const parsed = parseInt(process.env[name] || String(fallback), 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

function getWebpQuality() {
  const parsed = parseInt(process.env.IMAGE_WEBP_QUALITY || '82', 10);
  if (Number.isNaN(parsed) || parsed < 1) return 82;
  return Math.min(parsed, 100);
}

function getMaxEdgePx() {
  return readIntEnv('IMAGE_MAX_EDGE_PX', 1536);
}

function getMaxStoredImageBytes() {
  return readIntEnv('MAX_STORED_IMAGE_BYTES', 14680064);
}

function getMaxReferenceBytes() {
  return readIntEnv('IMAGE_MAX_REFERENCE_BYTES', 786432);
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[\w+.-]+);base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!match) return null;
  return {
    mime: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function toWebpDataUrl(buffer) {
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

async function encodeWebp(sharp, buffer, { quality, maxEdge, targetMaxBytes }) {
  let currentQuality = quality;
  let smallest = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const encoded = await sharp(buffer)
      .rotate()
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: currentQuality })
      .toBuffer();

    smallest = encoded;
    if (!targetMaxBytes || encoded.length <= targetMaxBytes) {
      return encoded;
    }
    currentQuality = Math.max(40, currentQuality - 12);
  }

  return smallest;
}

async function compressImageDataUrl(dataUrl, purpose = 'storage') {
  const source = String(dataUrl || '').trim();
  if (!source.startsWith('data:')) {
    return source;
  }

  const sharp = getSharp();
  if (!sharp) {
    return source;
  }

  const parsed = parseDataUrl(source);
  if (!parsed) {
    return source;
  }

  const quality = getWebpQuality();
  const maxEdge =
    purpose === 'reference'
      ? Math.min(getMaxEdgePx(), 1280)
      : getMaxEdgePx();

  const targetBinaryBytes =
    purpose === 'reference'
      ? getMaxReferenceBytes()
      : Math.floor(getMaxStoredImageBytes() / 1.4);

  const beforeBytes = parsed.buffer.length;
  const compressed = await encodeWebp(sharp, parsed.buffer, {
    quality,
    maxEdge,
    targetMaxBytes: targetBinaryBytes,
  });
  const result = toWebpDataUrl(compressed);

  console.log(
    `[imageCompress] ${purpose} ${beforeBytes} -> ${compressed.length} bytes (webp, edge<=${maxEdge})`
  );

  return result;
}

module.exports = {
  compressImageDataUrl,
  getMaxStoredImageBytes,
};
