require('dotenv').config();
const mysql = require('mysql2/promise');

// Create a connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Initialize database tables (including users & messages)
async function initDB() {
  try {
    const connection = await pool.getConnection();
    console.log('🔌 Connected to MySQL, initializing tables...');

    // 1. Table for Global Settings
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ai_globals (
        \`key\` VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Table for Commands Contexts
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ai_commands (
        command VARCHAR(255) PRIMARY KEY,
        classifier TEXT,
        response TEXT,
        section VARCHAR(255) DEFAULT 'general'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration: Add section column if it doesn't exist
    try {
      await connection.query(`
        SELECT section FROM ai_commands LIMIT 1;
      `);
    } catch (e) {
      console.log('⚠️ Column "section" missing in ai_commands. Adding it...');
      await connection.query(`
        ALTER TABLE ai_commands ADD COLUMN section VARCHAR(255) DEFAULT 'general';
      `);
    }

    // 3. Table for User Sessions (legacy, can stay)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        user_id VARCHAR(255) PRIMARY KEY,
        last_command VARCHAR(255) DEFAULT '/start',
        history JSON,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. Table for Users (admin view)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(255) PRIMARY KEY,
        nickname VARCHAR(255),
        username VARCHAR(255),
        registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_date TIMESTAMP NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration: Add username column to users if it doesn't exist
    try {
      await connection.query(`SELECT username FROM users LIMIT 1;`);
    } catch (e) {
      console.log('⚠️ Column "username" missing in users. Adding it...');
      await connection.query(`ALTER TABLE users ADD COLUMN username VARCHAR(255);`);
    }

    // 5. Table for individual messages (dialog history)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(255),
        role ENUM('user','assistant') NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX(user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('✅ Database tables checked/created.');
    connection.release();
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  }
}

module.exports = {
  pool,
  initDB
};
