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
async function addMessage(userId, role, content) {
    try {
        await pool.query(
            `INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)`,
            [String(userId), role, content]
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
        `SELECT role, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC`,
        [String(userId)]
    );
    return rows;
}

module.exports = {
    ensureUser,
    touchUser,
    addMessage,
    listUsers,
    getUserMessages,
};
