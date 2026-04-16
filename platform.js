require('dotenv').config();
const { pool } = require('./db');
const { generateApiKey, hashApiKey, hashPassword, slugify, verifyPassword } = require('./security');

const DEFAULT_PROJECT_SLUG = 'system-project';
const DEFAULT_PROJECT_NAME = 'System Project';
const DEFAULT_BOT_SLUG = 'system-bot';
const DEFAULT_BOT_NAME = 'System Bot';

function buildScopedUserId(botId, externalUserId) {
  return `${botId}:${String(externalUserId)}`;
}

async function getAdminByUsername(username) {
  const [rows] = await pool.query(
    'SELECT id, username, password_hash, role, is_active, created_at, updated_at FROM admins WHERE username = ? LIMIT 1',
    [username]
  );
  return rows[0] || null;
}

async function getAdminById(adminId) {
  const [rows] = await pool.query(
    'SELECT id, username, role, is_active, created_at, updated_at FROM admins WHERE id = ? LIMIT 1',
    [adminId]
  );
  return rows[0] || null;
}

async function verifyAdminCredentials(username, password) {
  const admin = await getAdminByUsername(username);
  if (!admin || !admin.is_active) {
    return null;
  }

  const isValid = verifyPassword(password, admin.password_hash);
  if (!isValid) {
    return null;
  }

  return {
    id: admin.id,
    username: admin.username,
    role: admin.role
  };
}

async function listAdmins() {
  const [rows] = await pool.query(
    `SELECT id, username, role, is_active, created_at, updated_at
     FROM admins
     ORDER BY created_at DESC`
  );
  return rows;
}

async function createAdmin({ username, password, role = 'admin' }) {
  const passwordHash = hashPassword(password);
  const [result] = await pool.query(
    `INSERT INTO admins (username, password_hash, role)
     VALUES (?, ?, ?)`,
    [username, passwordHash, role]
  );

  return {
    id: result.insertId,
    username,
    role
  };
}

async function getProjectById(projectId) {
  const [rows] = await pool.query(
    `SELECT id, name, slug, description, created_by_admin_id, created_at, updated_at
     FROM projects
     WHERE id = ?
     LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

async function getBotById(botId) {
  const [rows] = await pool.query(
    `SELECT id, project_id, name, slug, status, telegram_enabled, telegram_bot_token_ref,
            is_default, created_by_admin_id, created_at, updated_at
     FROM bots
     WHERE id = ?
     LIMIT 1`,
    [botId]
  );
  return rows[0] || null;
}

async function listProjectsForAdmin(admin) {
  if (admin.role === 'super_admin') {
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.slug, p.description, p.created_by_admin_id, p.created_at, p.updated_at
       FROM projects p
       ORDER BY p.created_at DESC`
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.slug, p.description, p.created_by_admin_id, p.created_at, p.updated_at
     FROM projects p
     INNER JOIN admin_projects ap ON ap.project_id = p.id
     WHERE ap.admin_id = ?
     ORDER BY p.created_at DESC`,
    [admin.id]
  );
  return rows;
}

async function createProject({ name, description = null, createdByAdminId = null }) {
  const baseSlug = slugify(name) || `project-${Date.now()}`;
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const [rows] = await pool.query('SELECT id FROM projects WHERE slug = ? LIMIT 1', [slug]);
    if (!rows.length) {
      break;
    }
    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }

  const [result] = await pool.query(
    `INSERT INTO projects (name, slug, description, created_by_admin_id)
     VALUES (?, ?, ?, ?)`,
    [name, slug, description, createdByAdminId]
  );

  return getProjectById(result.insertId);
}

async function assignAdminToProject({ adminId, projectId }) {
  await pool.query(
    `INSERT IGNORE INTO admin_projects (admin_id, project_id)
     VALUES (?, ?)`,
    [adminId, projectId]
  );
}

async function canAccessProject(admin, projectId) {
  if (!admin) {
    return false;
  }

  if (admin.role === 'super_admin') {
    return true;
  }

  const [rows] = await pool.query(
    `SELECT 1
     FROM admin_projects
     WHERE admin_id = ? AND project_id = ?
     LIMIT 1`,
    [admin.id, projectId]
  );
  return rows.length > 0;
}

async function canAccessBot(admin, botId) {
  const bot = await getBotById(botId);
  if (!bot) {
    return false;
  }
  return canAccessProject(admin, bot.project_id);
}

async function createBot({
  projectId,
  name,
  status = 'active',
  telegramEnabled = false,
  telegramBotTokenRef = null,
  createdByAdminId = null,
  isDefault = false
}) {
  const baseSlug = slugify(name) || `bot-${Date.now()}`;
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const [rows] = await pool.query(
      'SELECT id FROM bots WHERE project_id = ? AND slug = ? LIMIT 1',
      [projectId, slug]
    );
    if (!rows.length) {
      break;
    }
    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }

  const [result] = await pool.query(
    `INSERT INTO bots (
      project_id, name, slug, status, telegram_enabled, telegram_bot_token_ref, is_default, created_by_admin_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectId, name, slug, status, telegramEnabled ? 1 : 0, telegramBotTokenRef, isDefault ? 1 : 0, createdByAdminId]
  );

  return getBotById(result.insertId);
}

async function listBotsForAdmin(admin, projectId = null) {
  const params = [];
  let query = `
    SELECT b.id, b.project_id, b.name, b.slug, b.status, b.telegram_enabled, b.telegram_bot_token_ref,
           b.is_default, b.created_by_admin_id, b.created_at, b.updated_at
    FROM bots b
  `;

  if (admin.role !== 'super_admin') {
    query += ' INNER JOIN admin_projects ap ON ap.project_id = b.project_id ';
    params.push(admin.id);
  }

  query += ' WHERE 1 = 1 ';

  if (admin.role !== 'super_admin') {
    query += ' AND ap.admin_id = ? ';
  }

  if (projectId) {
    query += ' AND b.project_id = ? ';
    params.push(projectId);
  }

  query += ' ORDER BY b.created_at DESC ';

  const [rows] = await pool.query(query, params);
  return rows;
}

async function createBotApiKey({ botId, name = 'Default key', createdByAdminId = null }) {
  const { prefix, fullKey } = generateApiKey();
  const keyHash = hashApiKey(fullKey);

  const [result] = await pool.query(
    `INSERT INTO bot_api_keys (bot_id, key_name, key_prefix, key_hash, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?)`,
    [botId, name, prefix, keyHash, createdByAdminId]
  );

  return {
    id: result.insertId,
    key: fullKey,
    prefix
  };
}

async function listBotApiKeys(botId) {
  const [rows] = await pool.query(
    `SELECT id, bot_id, key_name, key_prefix, created_by_admin_id, created_at, last_used_at, revoked_at
     FROM bot_api_keys
     WHERE bot_id = ?
     ORDER BY created_at DESC`,
    [botId]
  );
  return rows;
}

async function revokeBotApiKey(keyId) {
  await pool.query(
    `UPDATE bot_api_keys
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [keyId]
  );
}

async function getBotApiKeyById(keyId) {
  const [rows] = await pool.query(
    `SELECT id, bot_id, key_name, key_prefix, created_by_admin_id, created_at, last_used_at, revoked_at
     FROM bot_api_keys
     WHERE id = ?
     LIMIT 1`,
    [keyId]
  );
  return rows[0] || null;
}

async function authenticateBotApiKey(rawKey) {
  if (!rawKey || !rawKey.includes('.')) {
    return null;
  }

  const prefix = rawKey.split('.')[0];
  const keyHash = hashApiKey(rawKey);
  const [rows] = await pool.query(
    `SELECT k.id, k.bot_id, k.key_name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at,
            b.project_id, b.name AS bot_name, b.status
     FROM bot_api_keys k
     INNER JOIN bots b ON b.id = k.bot_id
     WHERE k.key_prefix = ? AND k.key_hash = ? AND k.revoked_at IS NULL
     LIMIT 1`,
    [prefix, keyHash]
  );

  return rows[0] || null;
}

async function touchBotApiKeyUsage(keyId) {
  await pool.query(
    `UPDATE bot_api_keys
     SET last_used_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [keyId]
  );
}

async function getOrCreateDefaultProjectAndBot() {
  let [projectRows] = await pool.query(
    'SELECT id, name, slug FROM projects WHERE slug = ? LIMIT 1',
    [DEFAULT_PROJECT_SLUG]
  );

  let project = projectRows[0];
  if (!project) {
    const [projectResult] = await pool.query(
      `INSERT INTO projects (name, slug, description)
       VALUES (?, ?, ?)`,
      [DEFAULT_PROJECT_NAME, DEFAULT_PROJECT_SLUG, 'Bootstrap project for legacy flows']
    );
    project = await getProjectById(projectResult.insertId);
  }

  let [botRows] = await pool.query(
    'SELECT id, project_id, name, slug, telegram_bot_token_ref FROM bots WHERE project_id = ? AND slug = ? LIMIT 1',
    [project.id, DEFAULT_BOT_SLUG]
  );

  let bot = botRows[0];
  if (!bot) {
    const legacyTelegramToken = process.env.TELEGRAM_TOKEN || null;
    const [botResult] = await pool.query(
      `INSERT INTO bots (
        project_id,
        name,
        slug,
        status,
        telegram_enabled,
        telegram_bot_token_ref,
        is_default
       ) VALUES (?, ?, ?, 'active', 1, ?, 1)`,
      [project.id, DEFAULT_BOT_NAME, DEFAULT_BOT_SLUG, legacyTelegramToken]
    );
    bot = await getBotById(botResult.insertId);
  } else {
    const legacyTelegramToken = process.env.TELEGRAM_TOKEN || null;
    if (legacyTelegramToken && !bot.telegram_bot_token_ref) {
      await pool.query(
        'UPDATE bots SET telegram_bot_token_ref = ? WHERE id = ?',
        [legacyTelegramToken, bot.id]
      );
    }
  }

  return { project, bot };
}

module.exports = {
  DEFAULT_BOT_NAME,
  DEFAULT_BOT_SLUG,
  DEFAULT_PROJECT_NAME,
  DEFAULT_PROJECT_SLUG,
  assignAdminToProject,
  authenticateBotApiKey,
  buildScopedUserId,
  canAccessBot,
  canAccessProject,
  createAdmin,
  createBot,
  createBotApiKey,
  createProject,
  getAdminByUsername,
  getAdminById,
  getBotApiKeyById,
  getBotById,
  getOrCreateDefaultProjectAndBot,
  getProjectById,
  listAdmins,
  listBotApiKeys,
  listBotsForAdmin,
  listProjectsForAdmin,
  revokeBotApiKey,
  touchBotApiKeyUsage,
  verifyAdminCredentials
};
