const crypto = require('crypto');

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function randomToken(size = 32) {
  return crypto.randomBytes(size).toString('hex');
}

function generateApiKey() {
  const prefix = `bk_${randomToken(4)}`;
  const secret = randomToken(24);
  return {
    prefix,
    fullKey: `${prefix}.${secret}`
  };
}

function hashApiKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }

  const [salt, expectedHash] = storedHash.split(':');
  if (!salt || !expectedHash) {
    return false;
  }

  try {
    const actualHash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const a = Buffer.from(actualHash, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = {
  generateApiKey,
  hashApiKey,
  hashPassword,
  randomToken,
  slugify,
  verifyPassword
};
