require('dotenv').config();
const { pool } = require('./db');

/**
 * Insert a user if it does not exist yet.
 * nickname – Telegram nickname (first_name).
 * username – Telegram handle (@username).
 */
async function ensureUser(userId, nickname, username) {
    try {
        await pool.query(
            `INSERT INTO users (user_id, nickname, username)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nickname = IFNULL(VALUES(nickname), nickname),
         username = IFNULL(VALUES(username), username)`,
            [String(userId), nickname ?? null, username ?? null]
        );
    } catch (e) {
        console.error('ensureUser error:', e);
    }
}

/** Update last_message_date for a user */
async function touchUser(userId) {
    try {
        await pool.query(
            `UPDATE users SET last_message_date = CURRENT_TIMESTAMP WHERE user_id = ?`,
            [String(userId)]
        );
    } catch (e) {
        console.error('touchUser error:', e);
    }
}

/** Store a single message (role = 'user' | 'assistant') */
async function addMessage(userId, role, content, botId = null) {
    try {
        await pool.query(
            `INSERT INTO messages (user_id, role, content, bot_id) VALUES (?, ?, ?, ?)`,
            [String(userId), role, content, botId]
        );
    } catch (e) {
        console.error('addMessage error:', e);
    }
}

/** Get list of all users (legacy / internal; prefer listUsersForBot) */
async function listUsers() {
    const [rows] = await pool.query(
        `SELECT user_id, nickname, username, user_context, registration_date, last_message_date FROM users ORDER BY registration_date DESC`
    );
    return rows;
}

/**
 * Users who have a session or at least one message with this bot.
 * Includes API-only chats that never hit Telegram.
 */
async function listUsersForBot(botId) {
    const id = parseInt(botId, 10);
    if (!id || Number.isNaN(id)) return [];
    const [rows] = await pool.query(
        `SELECT
           ids.user_id,
           COALESCE(NULLIF(TRIM(u.nickname), ''), ids.user_id) AS nickname,
           u.username,
           u.user_context,
           COALESCE(u.registration_date, lm.min_created, s.updated_at) AS registration_date,
           COALESCE(lm.max_created, s.updated_at, u.last_message_date) AS last_message_date
         FROM (
           SELECT user_id FROM messages WHERE bot_id = ?
           UNION
           SELECT user_id FROM sessions WHERE bot_id = ?
         ) ids
         LEFT JOIN users u ON u.user_id = ids.user_id
         LEFT JOIN sessions s ON s.user_id = ids.user_id AND s.bot_id = ?
         LEFT JOIN (
           SELECT user_id, MAX(created_at) AS max_created, MIN(created_at) AS min_created
           FROM messages
           WHERE bot_id = ?
           GROUP BY user_id
         ) lm ON lm.user_id = ids.user_id
         ORDER BY last_message_date DESC`,
        [id, id, id, id]
    );
    return rows;
}

/** Get user context */
async function getUserContext(userId) {
    try {
        const [rows] = await pool.query(
            `SELECT user_context FROM users WHERE user_id = ?`,
            [String(userId)]
        );
        return rows[0]?.user_context || '';
    } catch (e) {
        console.error('getUserContext error:', e);
        return '';
    }
}

/** Set/Update user context */
async function setUserContext(userId, context) {
    try {
        await pool.query(
            `UPDATE users SET user_context = ? WHERE user_id = ?`,
            [context, String(userId)]
        );
        console.log(`✅ User context updated for user ${userId}`);
        return true;
    } catch (e) {
        console.error('setUserContext error:', e);
        return false;
    }
}

/** Delete user context */
async function deleteUserContext(userId) {
    try {
        await pool.query(
            `UPDATE users SET user_context = NULL WHERE user_id = ?`,
            [String(userId)]
        );
        console.log(`✅ User context deleted for user ${userId}`);
        return true;
    } catch (e) {
        console.error('deleteUserContext error:', e);
        return false;
    }
}

/** Get dialog (messages) for a specific user; optional bot filter */
async function getUserMessages(userId, botId = null) {
    const params = [String(userId)];
    let botClause = '';
    if (botId != null && botId !== '') {
      const id = parseInt(botId, 10);
      if (!Number.isNaN(id)) {
        botClause = ' AND m.bot_id = ?';
        params.push(id);
      }
    }
    const [rows] = await pool.query(
        `SELECT m.role, m.content, m.created_at, m.bot_id, b.name as bot_name 
         FROM messages m 
         LEFT JOIN bots b ON m.bot_id = b.id
         WHERE m.user_id = ? ${botClause}
         ORDER BY m.created_at ASC`,
        params
    );
    return rows;
}

/** Delete all messages for a specific user */
async function deleteUserMessages(userId) {
    try {
        await pool.query(
            `DELETE FROM messages WHERE user_id = ?`,
            [String(userId)]
        );
        console.log(`✅ Deleted all messages for user ${userId}`);
    } catch (e) {
        console.error('deleteUserMessages error:', e);
    }
}

module.exports = {
    ensureUser,
    touchUser,
    addMessage,
    listUsers,
    listUsersForBot,
    getUserMessages,
    deleteUserMessages,
    getUserContext,
    setUserContext,
    deleteUserContext,
};
