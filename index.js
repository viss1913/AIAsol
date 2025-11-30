require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');

const {
  updateContext,
  loadContexts,
  migrateFromJSON,
  deleteContext,
} = require('./context');
const { initDB, pool } = require('./db');
const {
  ensureUser,
  touchUser,
  addMessage,
  listUsers,
  getUserMessages,
} = require('./user');
const basicAuth = require('./basicAuth');

// Инициализация БД и Ботов
const { initBots, startBot, stopBot, sendMessageToUser, broadcastMessage } = require('./telegram');

; (async () => {
  await initDB();
  await initBots();
  // await migrateFromJSON(1); // Optional: migrate for default bot if needed
})();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS: пока разрешаем всем (можно сузить позже)
app.use(cors());

// ---------- Защищаем админ‑часть ----------
app.use('/admin', basicAuth);      // статические файлы UI
app.use('/api/admin', basicAuth);  // REST‑эндпоинты

// ---------- Статические файлы ----------
app.use('/admin', express.static(path.join(__dirname, 'public')));

// ---------- API: Bots Management ----------

app.get('/api/admin/bots', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, token, is_active, created_at FROM bots');
    // Mask tokens for security
    const safeRows = rows.map(bot => ({
      ...bot,
      token: bot.token ? `${bot.token.substring(0, 5)}...` : ''
    }));
    res.json(safeRows);
  } catch (err) {
    console.error('GET /api/admin/bots error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/bots', async (req, res) => {
  const { name, token, baseBrainContext } = req.body;
  if (!name || !token) {
    return res.status(400).json({ error: 'Name and Token are required' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO bots (name, token, base_brain_context) VALUES (?, ?, ?)',
      [name, token, baseBrainContext || '']
    );
    const newBotId = result.insertId;

    // Start the new bot immediately
    const [rows] = await pool.query('SELECT * FROM bots WHERE id = ?', [newBotId]);
    if (rows.length > 0) {
      startBot(rows[0]);
    }

    res.json({ success: true, id: newBotId, message: 'Bot created and started' });
  } catch (err) {
    console.error('POST /api/admin/bots error', err);
    res.status(500).json({ error: 'Failed to create bot (Token must be unique)' });
  }
});

app.put('/api/admin/bots/:id', async (req, res) => {
  const botId = req.params.id;
  const { name, token, isActive, baseBrainContext } = req.body;

  try {
    // Build query dynamically
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (token !== undefined) { updates.push('token = ?'); params.push(token); }
    if (isActive !== undefined) { updates.push('is_active = ?'); params.push(isActive); }
    if (baseBrainContext !== undefined) { updates.push('base_brain_context = ?'); params.push(baseBrainContext); }

    if (updates.length === 0) return res.json({ success: true, message: 'No changes' });

    params.push(botId);
    await pool.query(`UPDATE bots SET ${updates.join(', ')} WHERE id = ?`, params);

    // Restart bot logic
    if (isActive === false) {
      await stopBot(botId);
    } else if (isActive === true || token) {
      // If reactivated or token changed, restart
      await stopBot(botId);
      const [rows] = await pool.query('SELECT * FROM bots WHERE id = ?', [botId]);
      if (rows.length > 0 && rows[0].is_active) {
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

// ---------- API: Contexts (Per Bot) ----------

app.get('/api/admin/context', async (req, res) => {
  const botId = req.query.botId;
  if (!botId) return res.status(400).json({ error: 'botId is required' });

  const data = await loadContexts(botId);
  res.json(data);
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
  const users = await listUsers();
  res.json(users);
});

app.get('/api/admin/users/:id/messages', async (req, res) => {
  const userId = req.params.id;
  const msgs = await getUserMessages(userId);
  res.json(msgs);
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

// ---------- Публичные эндпоинты ----------
app.get('/', (req, res) => res.send('Backend is running with MySQL and Multi-Bot support!'));

app.listen(PORT, () => {
  console.log(`✅ Server started: http://0.0.0.0:${PORT}`);
});
