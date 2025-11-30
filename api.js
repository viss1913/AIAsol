require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const { classifyIntent, askAI } = require('./ai');
const { getClassifierContext, getResponseContext } = require('./context');
const { pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Helper: Get Default Bot ID
async function getDefaultBotId() {
    const [rows] = await pool.query('SELECT id FROM bots WHERE is_active = TRUE LIMIT 1');
    return rows.length > 0 ? rows[0].id : null;
}

// Helper: Get Session from MySQL
async function getSession(userId, botId) {
    const [rows] = await pool.query('SELECT * FROM sessions WHERE user_id = ? AND bot_id = ?', [String(userId), botId]);
    if (rows.length > 0) {
        return rows[0];
    }
    return { last_command: '/start', history: [] };
}

// Helper: Save Session to MySQL
async function saveSession(userId, botId, lastCommand, history) {
    await pool.query(
        `INSERT INTO sessions (user_id, bot_id, last_command, history)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_command = VALUES(last_command), history = VALUES(history)`,
        [String(userId), botId, lastCommand, JSON.stringify(history)]
    );
}

app.use((req, res, next) => {
    const requiredKey = process.env.PARTNER_API_KEY;
    if (requiredKey) {
        const provided = req.header('x-api-key');
        if (provided !== requiredKey) {
            return res.status(401).json({ error: 'Invalid API key' });
        }
    }
    next();
});

let openApiSpec = {};
try {
    const specPath = path.join(__dirname, 'YML', 'Правокард.yaml');
    const fileContents = fs.readFileSync(specPath, 'utf8');
    openApiSpec = yaml.load(fileContents);
    console.log('✅ OpenAPI spec loaded from YML/Правокард.yaml');
} catch (e) {
    console.error('❌ Error loading OpenAPI spec:', e.message);
}

app.get('/spec', (req, res) => {
    res.json(openApiSpec);
});

app.post('/chat', async (req, res) => {
    let { userId, message, botId } = req.body;
    if (!userId || !message) {
        return res.status(400).json({ error: 'userId and message are required' });
    }

    try {
        if (!botId) {
            botId = await getDefaultBotId();
            if (!botId) {
                return res.status(400).json({ error: 'No active bots found' });
            }
        }

        const session = await getSession(userId, botId);
        const lastCmd = session.last_command || '/start';
        let history = session.history || [];
        if (!Array.isArray(history)) history = [];

        const classifierContext = await getClassifierContext(botId, lastCmd);
        const newCommand = await classifyIntent(message, classifierContext);
        const responseContext = await getResponseContext(botId, newCommand);
        const reply = await askAI(message, responseContext, history); // Pass history if needed, ai.js askAI supports it

        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: reply });
        await saveSession(userId, botId, newCommand, history);

        res.json({
            reply,
            session: { lastCommand: newCommand, history },
            botId
        });
    } catch (err) {
        console.error('API error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Partner API listening on http://localhost:${PORT}`);
});
