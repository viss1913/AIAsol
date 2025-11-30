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
       ON DUPLICATE KEY UPDATE nickname = VALUES(nickname), username = VALUES(username)`,
            [String(userId), nickname, username]
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

/** Get list of all users */
async function listUsers() {
    const [rows] = await pool.query(
        `SELECT user_id, nickname, username, registration_date, last_message_date FROM users ORDER BY registration_date DESC`
    );
    return rows;
}

/** Get dialog (messages) for a specific user */
async function getUserMessages(userId) {
    const [rows] = await pool.query(
        `SELECT m.role, m.content, m.created_at, m.bot_id, b.name as bot_name 
         FROM messages m 
         LEFT JOIN bots b ON m.bot_id = b.id
         WHERE m.user_id = ? 
         ORDER BY m.created_at ASC`,
        [String(userId)]
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
    getUserMessages,
    deleteUserMessages,
};
