require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const cors = require('cors');
const multer = require('multer');

const {
  updateContext,
  loadContexts,
  migrateFromJSON,
  deleteContext,
} = require('./context');
const { processUserMessage } = require('./chatPipeline');
const { initDB, pool } = require('./db');
const {
  ensureUser,
  touchUser,
  addMessage,
  listUsersForBot,
  getUserMessages,
  getUserContext,
  setUserContext,
  deleteUserContext,
} = require('./user');
const basicAuth = require('./basicAuth');
const { generateApiKey } = require('./security');

// Инициализация БД и Ботов
const { initBots, startBot, stopBot, sendMessageToUser, broadcastMessage } = require('./telegram');

; (async () => {
  try {
    await initDB();
    await initBots();
    // await migrateFromJSON(1); // Optional: migrate for default bot if needed
  } catch (err) {
    console.error('❌ Critical startup error:', err);
    process.exit(1);
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));

// CORS: пока разрешаем всем (можно сузить позже)
app.use(cors());
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function toDataUrlFromBase64(imageBase64, mimeType = 'image/jpeg') {
  const normalized = String(imageBase64 || '').trim();
  if (!normalized) return null;
  if (normalized.startsWith('data:image/')) return normalized;
  return `data:${mimeType};base64,${normalized}`;
}

function extractImagePayload(req) {
  if (req.file) {
    if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
      throw new Error('Uploaded file must be an image');
    }
    return `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  }

  const { imageUrl, imageBase64, imageMimeType } = req.body || {};
  if (imageUrl && String(imageUrl).trim()) {
    return String(imageUrl).trim();
  }
  if (imageBase64 && String(imageBase64).trim()) {
    return toDataUrlFromBase64(imageBase64, imageMimeType || 'image/jpeg');
  }

  return null;
}

// OpenAPI для партнёрского runtime (`POST /chat`) — тот же файл лежит в YML/
let partnerRuntimeOpenApi = null;
try {
  const specPath = path.join(__dirname, '..', 'YML', 'partner-runtime-chat.openapi.yaml');
  partnerRuntimeOpenApi = yaml.load(fs.readFileSync(specPath, 'utf8'));
} catch (e) {
  console.warn('Partner OpenAPI spec not loaded:', e.message);
}

app.get('/spec', (req, res) => {
  if (!partnerRuntimeOpenApi) {
    return res.status(503).json({ error: 'OpenAPI spec unavailable' });
  }
  res.json(partnerRuntimeOpenApi);
});

// ---------- Защищаем админ‑часть ----------
app.use('/admin', basicAuth);      // статические файлы UI
app.use('/api/admin', basicAuth);  // REST‑эндпоинты

// ---------- Статические файлы ----------
app.use('/admin', express.static(path.join(__dirname, 'public')));

// ---------- API: Bots Management ----------

app.get('/api/admin/bots', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, token, api_key, is_active, created_at FROM bots');
    // Mask tokens for security
    const safeRows = rows.map(bot => ({
      ...bot,
      token: bot.token ? `${bot.token.substring(0, 5)}...` : '',
      api_key: bot.api_key ? `${bot.api_key.substring(0, 5)}...` : '',
      hasApiKey: Boolean(bot.api_key)
    }));
    res.json(safeRows);
  } catch (err) {
    console.error('GET /api/admin/bots error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/bots', async (req, res) => {
  const { name, token, baseBrainContext } = req.body;
  const normalizedToken = typeof token === 'string' && token.trim() ? token.trim() : null;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    // Generate unique API key on server side and return it once in create response.
    let newBotId = null;
    let generatedApiKey = null;
    let created = false;

    for (let attempt = 1; attempt <= 5; attempt++) {
      const keyCandidate = generateApiKey().fullKey;
      try {
        const [result] = await pool.query(
          'INSERT INTO bots (name, token, api_key, base_brain_context) VALUES (?, ?, ?, ?)',
          [name, normalizedToken, keyCandidate, baseBrainContext || '']
        );
        newBotId = result.insertId;
        generatedApiKey = keyCandidate;
        created = true;
        break;
      } catch (insertErr) {
        if (insertErr && insertErr.code === 'ER_DUP_ENTRY') {
          continue;
        }
        throw insertErr;
      }
    }

    if (!created || !newBotId || !generatedApiKey) {
      return res.status(500).json({ error: 'Failed to generate unique API key for bot' });
    }

    // Start Telegram bot only when token exists
    const [rows] = await pool.query('SELECT * FROM bots WHERE id = ?', [newBotId]);
    if (rows.length > 0 && rows[0].token) {
      startBot(rows[0]);
    }

    res.json({
      success: true,
      id: newBotId,
      apiKey: generatedApiKey,
      message: 'Bot created and started'
    });
  } catch (err) {
    console.error('POST /api/admin/bots error', err);
    res.status(500).json({ error: 'Failed to create bot (Token must be unique)' });
  }
});

app.put('/api/admin/bots/:id', async (req, res) => {
  const botId = req.params.id;
  const { name, token, apiKey, isActive, baseBrainContext } = req.body;

  try {
    // Build query dynamically
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (token !== undefined) {
      const normalizedToken = typeof token === 'string' && token.trim() ? token.trim() : null;
      updates.push('token = ?');
      params.push(normalizedToken);
    }
    if (apiKey !== undefined) {
      const normalizedApiKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
      updates.push('api_key = ?');
      params.push(normalizedApiKey);
    }
    if (isActive !== undefined) { updates.push('is_active = ?'); params.push(isActive); }
    if (baseBrainContext !== undefined) { updates.push('base_brain_context = ?'); params.push(baseBrainContext); }

    if (updates.length === 0) return res.json({ success: true, message: 'No changes' });

    params.push(botId);
    await pool.query(`UPDATE bots SET ${updates.join(', ')} WHERE id = ?`, params);

    // Restart bot logic
    if (isActive === false) {
      await stopBot(botId);
    } else if (isActive === true || token !== undefined) {
      // If reactivated or token changed, restart
      await stopBot(botId);
      const [rows] = await pool.query('SELECT * FROM bots WHERE id = ?', [botId]);
      if (rows.length > 0 && rows[0].is_active && rows[0].token) {
        startBot(rows[0]);
      }
    }

    res.json({ success: true, message: 'Bot updated' });
  } catch (err) {
    console.error('PUT /api/admin/bots error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/bots/:id', async (req, res) => {
  const botId = req.params.id;
  try {
    await stopBot(botId);
    await pool.query('DELETE FROM bots WHERE id = ?', [botId]);
    res.json({ success: true, message: 'Bot deleted' });
  } catch (err) {
    console.error('DELETE /api/admin/bots error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Backward-compatible alias: "project" maps to bot in current admin panel flow.
app.delete('/api/admin/projects/:id', async (req, res) => {
  const projectId = req.params.id;
  try {
    await stopBot(projectId);
    const [result] = await pool.query('DELETE FROM bots WHERE id = ?', [projectId]);
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ success: true, message: 'Project deleted' });
  } catch (err) {
    console.error('DELETE /api/admin/projects error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- API: Contexts (Per Bot) ----------

app.get('/api/admin/context', async (req, res) => {
  const botId = req.query.botId;
  if (!botId) return res.status(400).json({ error: 'botId is required' });

  try {
    const data = await loadContexts(botId);
    const [botRows] = await pool.query('SELECT api_key FROM bots WHERE id = ? LIMIT 1', [botId]);
    const apiKey = botRows.length > 0 ? botRows[0].api_key : null;
    res.json({ ...data, apiKey });
  } catch (err) {
    console.error('GET /api/admin/context error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/context', async (req, res) => {
  try {
    const { botId, key, response, classifier, section } = req.body;

    if (!botId) return res.status(400).json({ error: 'botId is required' });
    if (!key) return res.status(400).json({ error: 'Missing key' });

    const success = await updateContext(botId, key, {
      classifier,
      response,
      section,
    });

    if (success) {
      res.json({ success: true, message: 'Context updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update context' });
    }
  } catch (err) {
    console.error('POST /api/admin/context error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/admin/context/brain', async (req, res) => {
  const { botId, baseBrainContext } = req.body;

  if (!botId) return res.status(400).json({ error: 'botId is required' });
  if (typeof baseBrainContext !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid baseBrainContext' });
  }

  const success = await updateContext(botId, 'baseBrainContext', {
    response: baseBrainContext,
  });

  if (success) {
    res.json({ success: true, message: 'Base brain context updated' });
  } else {
    res.status(500).json({ error: 'Failed to update base brain context' });
  }
});

app.post('/api/admin/context/delete', async (req, res) => {
  const { botId, key } = req.body;

  if (!botId) return res.status(400).json({ error: 'botId is required' });
  if (!key) return res.status(400).json({ error: 'Missing key' });

  const success = await deleteContext(botId, key);
  if (success) {
    res.json({ success: true, message: 'Context deleted successfully' });
  } else {
    res.status(500).json({ error: 'Failed to delete context' });
  }
});

// ---------- Пользователи (admin) ----------
app.get('/api/admin/users', async (req, res) => {
  try {
    const botId = req.query.botId;
    if (!botId) {
      return res.status(400).json({ error: 'botId query parameter is required' });
    }
    const users = await listUsersForBot(botId);
    res.json(users);
  } catch (err) {
    console.error('GET /api/admin/users error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/users/:id/messages', async (req, res) => {
  try {
    const botId = req.query.botId;
    if (!botId) {
      return res.status(400).json({ error: 'botId query parameter is required' });
    }
    const userId = req.params.id;
    const msgs = await getUserMessages(userId, botId);
    res.json(msgs);
  } catch (err) {
    console.error('GET /api/admin/users/:id/messages error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/users/:id/send', async (req, res) => {
  const userId = req.params.id;
  const { message, botId } = req.body;

  if (!botId) return res.status(400).json({ error: 'botId is required' });
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const result = await sendMessageToUser(userId, message, botId);
  if (result.success) {
    // Сохраняем исходящее сообщение в историю
    await addMessage(userId, 'assistant', message, botId);
    res.json({ success: true, message: 'Message sent' });
  } else {
    res.status(500).json({ error: 'Failed to send message', details: result.error });
  }
});

app.post('/api/admin/users/broadcast', async (req, res) => {
  const { message, botId } = req.body;

  if (!botId) return res.status(400).json({ error: 'botId is required' });
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const result = await broadcastMessage(message, botId);
  res.json(result);
});

// ---------- User Context Management ----------

// Get user context
app.get('/api/admin/users/:id/context', async (req, res) => {
  const userId = req.params.id;
  try {
    const context = await getUserContext(userId);
    res.json({ userId, userContext: context });
  } catch (err) {
    console.error('GET /api/admin/users/:id/context error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set/Update user context
app.put('/api/admin/users/:id/context', async (req, res) => {
  const userId = req.params.id;
  const { userContext } = req.body;

  if (typeof userContext !== 'string') {
    return res.status(400).json({ error: 'userContext must be a string' });
  }

  try {
    const success = await setUserContext(userId, userContext);
    if (success) {
      res.json({ success: true, message: 'User context updated' });
    } else {
      res.status(500).json({ error: 'Failed to update user context' });
    }
  } catch (err) {
    console.error('PUT /api/admin/users/:id/context error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user context
app.delete('/api/admin/users/:id/context', async (req, res) => {
  const userId = req.params.id;
  try {
    const success = await deleteUserContext(userId);
    if (success) {
      res.json({ success: true, message: 'User context deleted' });
    } else {
      res.status(500).json({ error: 'Failed to delete user context' });
    }
  } catch (err) {
    console.error('DELETE /api/admin/users/:id/context error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Partner API: /chat (x-api-key = bot api_key) -----------
async function resolveBotByApiKey(req, res, next) {
  const provided = req.header('x-api-key');
  if (!provided) {
    return res.status(401).json({ error: 'x-api-key header is required' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, is_active FROM bots WHERE api_key = ? LIMIT 1',
      [provided]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (!rows[0].is_active) {
      return res.status(403).json({ error: 'Bot is inactive' });
    }
    req.apiBotId = rows[0].id;
    next();
  } catch (err) {
    console.error('API key lookup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

app.post('/chat', resolveBotByApiKey, upload.single('image'), async (req, res) => {
  const { userId, message, displayName, username } = req.body;
  const botId = req.apiBotId;
  const debugVision = String(process.env.DEBUG_VISION_RESPONSE || '').trim() === '1';
  if (!userId || !message) {
    return res.status(400).json({ error: 'userId and message are required' });
  }
  try {
    const nick =
      typeof displayName === 'string' && displayName.trim()
        ? displayName.trim()
        : null;
    const handle =
      typeof username === 'string' && username.trim()
        ? username.trim().startsWith('@')
          ? username.trim()
          : `@${username.trim()}`
        : null;

    await ensureUser(userId, nick, handle);
    await touchUser(userId);
    await addMessage(userId, 'user', message, botId);

    let imagePayload = null;
    try {
      imagePayload = extractImagePayload(req);
    } catch (imgError) {
      return res.status(400).json({ error: imgError.message });
    }

    const result = await processUserMessage({
      botId,
      userId,
      userMessage: message,
      imagePayload,
    });

    await addMessage(userId, 'assistant', result.reply, botId);
    await touchUser(userId);

    const payload = {
      reply: result.reply,
      session: { lastCommand: result.newCommand, history: result.history },
      botId,
    };
    if (result.imageDataUrl) {
      payload.imageUrl = result.imageDataUrl;
      payload.imageAction = result.newCommand;
    }
    if (debugVision) {
      payload.visionDebug = result.visionDebug;
    }
    if (result.imageGenDebug) {
      payload.imageGenDebug = result.imageGenDebug;
    }
    res.json(payload);
  } catch (err) {
    console.error('POST /chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image file is too large (max 10MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// ---------- Публичные эндпоинты ----------
app.get('/', (req, res) => res.send('Backend is running with MySQL and Multi-Bot support!'));

app.listen(PORT, () => {
  console.log(`✅ Server started: http://0.0.0.0:${PORT}`);
});
