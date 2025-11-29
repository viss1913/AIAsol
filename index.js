require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const { updateContext, loadContexts, migrateFromJSON, deleteContext } = require('./context');
const { initDB } = require('./db');
const { ensureUser, touchUser, addMessage, listUsers, getUserMessages } = require('./user');
const basicAuth = require('./basicAuth');

// Инициализация БД и миграция
; (async () => {
  await initDB();
  await migrateFromJSON();
})();

require('./telegram'); // Запускаем Telegram‑бота


const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(cors({
  origin: [
    'https://bank-future-front.vercel.app',
    'http://localhost:5173',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ---------- Защищаем админ‑часть ----------
app.use('/admin', basicAuth);
app.use('/api/admin', basicAuth);


// ---------- Статические файлы ----------
app.use('/admin', express.static(path.join(__dirname, 'public')));

// ---------- API‑эндпоинты ----------
app.get('/api/admin/context', async (req, res) => {
  const data = await loadContexts();
  res.json(data);
});

app.post('/api/admin/context', async (req, res) => {
  const { key, value, type, section } = req.body;
  if (!key || !value) {
    return res.status(400).json({ error: 'Missing key or value' });
  }
  const success = await updateContext(key, value, type, section);
  if (success) {
    res.json({ success: true, message: 'Context updated successfully' });
  } else {
    res.status(500).json({ error: 'Failed to update context' });
  }
});

app.put('/api/admin/context/brain', async (req, res) => {
  const { baseBrainContext } = req.body;
  if (typeof baseBrainContext !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid baseBrainContext' });
  }
  const success = await updateContext('baseBrainContext', baseBrainContext);
  if (success) {
    res.json({ success: true, message: 'Base brain context updated' });
  } else {
    res.status(500).json({ error: 'Failed to update base brain context' });
  }
});

app.post('/api/admin/context/delete', async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'Missing key' });
  }
  const success = await deleteContext(key);
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

// ---------- Публичные эндпоинты ----------
app.get('/', (req, res) => res.send('Backend is running with MySQL!'));

app.listen(PORT, () => {
  console.log(`✅ Server started: http://0.0.0.0:${PORT}`);
});
