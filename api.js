require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const { classifyIntent, askAI } = require('./ai');
const { getClassifierContext, getResponseContext } = require('./context');
const { initDB, pool } = require('./db');
const { ensureUser, touchUser, addMessage } = require('./user');
const { authenticateBotApiKey, buildScopedUserId, getOrCreateDefaultProjectAndBot, touchBotApiKeyUsage } = require('./platform');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

async function ensureDefaultBotContext() {
    return getOrCreateDefaultProjectAndBot();
}

// Helper: Get Session from MySQL
async function getSession(userId) {
    const [rows] = await pool.query('SELECT * FROM sessions WHERE user_id = ?', [String(userId)]);
    if (rows.length > 0) {
        return rows[0];
    }
    return { last_command: '/start', history: [] };
}

// Helper: Save Session to MySQL
async function saveSession(userId, lastCommand, history, context = {}) {
    const { projectId = null, botId = null, externalUserId = null } = context;
    await pool.query(
        `INSERT INTO sessions (user_id, project_id, bot_id, external_user_id, last_command, history)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        project_id = VALUES(project_id),
        bot_id = VALUES(bot_id),
        external_user_id = VALUES(external_user_id),
        last_command = VALUES(last_command),
        history = VALUES(history)`,
        [String(userId), projectId, botId, externalUserId ? String(externalUserId) : null, lastCommand, JSON.stringify(history)]
    );
}

app.use(async (req, res, next) => {
    try {
        const providedKey = req.header('x-api-key');
        if (!providedKey) {
            return res.status(401).json({ error: 'API key is required' });
        }

        const apiKey = await authenticateBotApiKey(providedKey);
        if (!apiKey) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        if (apiKey.status !== 'active') {
            return res.status(403).json({ error: 'Bot is not active' });
        }

        req.botApiKey = apiKey;
        await touchBotApiKeyUsage(apiKey.id);
        next();
    } catch (error) {
        console.error('bot api auth error:', error);
        res.status(500).json({ error: 'Failed to authenticate bot API key' });
    }
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
    const { userId, message } = req.body;
    if (!userId || !message) {
        return res.status(400).json({ error: 'userId and message are required' });
    }

    try {
        const botContext = req.botApiKey || await ensureDefaultBotContext();
        const botId = botContext.bot_id || botContext.bot?.id;
        const projectId = botContext.project_id || botContext.project?.id;
        const scopedUserId = buildScopedUserId(botId, userId);

        await ensureUser(scopedUserId, 'API User', {
            externalUserId: userId,
            projectId,
            botId
        });
        await touchUser(scopedUserId);
        await addMessage(scopedUserId, 'user', message, {
            externalUserId: userId,
            projectId,
            botId
        });

        const session = await getSession(scopedUserId);
        const lastCmd = session.last_command || '/start';
        let history = session.history || [];
        if (!Array.isArray(history)) history = [];

        const classifierContext = await getClassifierContext(botId, lastCmd);
        const newCommand = await classifyIntent(message, classifierContext);
        const responseContext = await getResponseContext(botId, newCommand);
        const reply = await askAI(message, responseContext, history);

        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: reply });
        await addMessage(scopedUserId, 'assistant', reply, {
            externalUserId: userId,
            projectId,
            botId
        });
        await touchUser(scopedUserId);
        await saveSession(scopedUserId, newCommand, history, {
            externalUserId: userId,
            projectId,
            botId
        });

        res.json({
            reply,
            botId,
            session: { lastCommand: newCommand, history }
        });
    } catch (err) {
        console.error('API error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

;(async () => {
    await initDB();
    await ensureDefaultBotContext();
    app.listen(PORT, () => {
        console.log(`✅ Partner API listening on http://localhost:${PORT}`);
    });
})();
