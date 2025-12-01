require('dotenv').config();

console.log('ENV MYSQLHOST:', process.env.MYSQLHOST);
console.log('ENV MYSQLPORT:', process.env.MYSQLPORT); 

const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

if (dbConfig.host !== 'localhost' && dbConfig.host !== '127.0.0.1') {
  console.log('🔒 Enabling SSL for remote database connection');
  dbConfig.ssl = { rejectUnauthorized: false };
}

console.log('DB CONFIG:', {
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  database: dbConfig.database
});

const pool = mysql.createPool(dbConfig);

// Initialize database tables
async function initDB() {
  try {
    const connection = await pool.getConnection();
    console.log('🔌 Connected to MySQL, initializing tables...');

    // 1. Table for Bots
    await connection.query(`
      CREATE TABLE IF NOT EXISTS bots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        base_brain_context TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Check if we need to insert the default bot from .env
    const [bots] = await connection.query('SELECT * FROM bots');
    let defaultBotId = null;
    if (bots.length === 0 && process.env.TELEGRAM_TOKEN) {
      console.log('🤖 Creating default bot from .env...');
      const [result] = await connection.query(
        'INSERT INTO bots (name, token, base_brain_context) VALUES (?, ?, ?)',
        ['Default Bot', process.env.TELEGRAM_TOKEN, '']
      );
      defaultBotId = result.insertId;

      // Migrate global context to this bot
      const [globals] = await connection.query("SELECT value FROM ai_globals WHERE `key` = 'baseBrainContext'");
      if (globals.length > 0) {
        await connection.query('UPDATE bots SET base_brain_context = ? WHERE id = ?', [globals[0].value, defaultBotId]);
      }
    } else if (bots.length > 0) {
      defaultBotId = bots[0].id;
    }

    // 2. Table for Commands Contexts
    // We need to alter this table to support bot_id. 
    // Since dropping PK is hard, we will check if bot_id exists first.

    // Create table if not exists (old structure) - strictly speaking we should create new structure directly if new
    // But let's assume it might exist.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ai_commands (
        command VARCHAR(255),
        classifier TEXT,
        response TEXT,
        section VARCHAR(255) DEFAULT 'general',
        bot_id INT,
        PRIMARY KEY (command, bot_id),
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration for ai_commands: Add bot_id if missing
    try {
      await connection.query('SELECT bot_id FROM ai_commands LIMIT 1');
    } catch (e) {
      console.log('⚠️ Column "bot_id" missing in ai_commands. Migrating...');
      // This is tricky because of the PRIMARY KEY on 'command'.
      // We need to:
      // 1. Drop the existing PRIMARY KEY
      // 2. Add the column
      // 3. Set default bot_id
      // 4. Add new PRIMARY KEY

      if (defaultBotId) {
        await connection.query('ALTER TABLE ai_commands DROP PRIMARY KEY');
        await connection.query('ALTER TABLE ai_commands ADD COLUMN bot_id INT DEFAULT ?', [defaultBotId]);
        await connection.query('ALTER TABLE ai_commands ADD CONSTRAINT fk_commands_bot FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE');
        await connection.query('ALTER TABLE ai_commands ADD PRIMARY KEY (command, bot_id)');
        console.log('✅ ai_commands migrated to multi-bot.');
      } else {
        console.error('❌ Cannot migrate ai_commands: No default bot found.');
      }
    }

    // 3. Table for User Sessions
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        user_id VARCHAR(255),
        bot_id INT,
        last_command VARCHAR(255) DEFAULT '/start',
        history JSON,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, bot_id),
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration for sessions
    try {
      await connection.query('SELECT bot_id FROM sessions LIMIT 1');
    } catch (e) {
      console.log('⚠️ Column "bot_id" missing in sessions. Migrating...');
      if (defaultBotId) {
        await connection.query('ALTER TABLE sessions DROP PRIMARY KEY');
        await connection.query('ALTER TABLE sessions ADD COLUMN bot_id INT DEFAULT ?', [defaultBotId]);
        await connection.query('ALTER TABLE sessions ADD CONSTRAINT fk_sessions_bot FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE');
        await connection.query('ALTER TABLE sessions ADD PRIMARY KEY (user_id, bot_id)');
        console.log('✅ sessions migrated to multi-bot.');
      }
    }

    // 4. Table for Users (Global, no bot_id needed, but maybe we want to know which bot they registered with? 
    // The prompt says "История переписки... общая для всех ботов". Users are likely global entities.)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(255) PRIMARY KEY,
        nickname VARCHAR(255),
        username VARCHAR(255),
        registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_date TIMESTAMP NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. Table for individual messages
    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(255),
        bot_id INT,
        role ENUM('user','assistant') NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX(user_id),
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration for messages
    try {
      await connection.query('SELECT bot_id FROM messages LIMIT 1');
    } catch (e) {
      console.log('⚠️ Column "bot_id" missing in messages. Migrating...');
      if (defaultBotId) {
        await connection.query('ALTER TABLE messages ADD COLUMN bot_id INT DEFAULT ?', [defaultBotId]);
        await connection.query('ALTER TABLE messages ADD CONSTRAINT fk_messages_bot FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE SET NULL');
        console.log('✅ messages migrated to multi-bot.');
      }
    }

    // 6. ai_globals can remain for truly global settings if any, but baseBrainContext is now per-bot.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ai_globals (
        \`key\` VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('✅ Database tables checked/created.');
    connection.release();
  } catch (err) {
    console.error('❌ Error initializing database:', err);
    throw err; // Re-throw to stop application startup
  }
}

module.exports = {
  pool,
  initDB
};
