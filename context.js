const { pool } = require('./db');
const fs = require('fs');
const path = require('path');

// --- Migration Helper (Legacy - migrates to a specific bot or default) ---
async function migrateFromJSON(botId) {
  try {
    console.log(`🚀 Checking contexts.json for migration/update for bot ${botId}...`);
    const filePath = path.join(__dirname, 'contexts.json');
    if (!fs.existsSync(filePath)) {
      console.log('⚠️ contexts.json not found, skipping.');
      return;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // 1. Save Base Context
    if (data.baseBrainContext) {
      await pool.query(
        'UPDATE bots SET base_brain_context = ? WHERE id = ?',
        [data.baseBrainContext, botId]
      );
      console.log('✅ Bot base context updated from JSON.');
    }

    // 2. Save Commands
    if (data.contexts) {
      let count = 0;
      for (const [cmd, ctx] of Object.entries(data.contexts)) {
        await pool.query(
          'INSERT INTO ai_commands (command, classifier, response, section, bot_id) VALUES (?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE classifier = VALUES(classifier), response = VALUES(response), section = VALUES(section)',
          [cmd, ctx.classifier || '', ctx.response || '', ctx.section || 'general', botId]
        );
        count++;
      }
      console.log(`✅ Synced ${count} commands from JSON to MySQL for bot ${botId}.`);
    }
  } catch (err) {
    console.error('❌ Migration error:', err);
  }
}

// --- Public API ---

async function loadContexts(botId) {
  try {
    const [bots] = await pool.query(
      'SELECT base_brain_context FROM bots WHERE id = ?',
      [botId]
    );
    const baseBrainContext = bots[0]?.base_brain_context || '';

    const [commands] = await pool.query('SELECT * FROM ai_commands WHERE bot_id = ?', [botId]);
    const contexts = {};
    commands.forEach((row) => {
      contexts[row.command] = {
        classifier: row.classifier,
        response: row.response,
        section: row.section || 'general',
      };
    });

    return { baseBrainContext, contexts };
  } catch (err) {
    console.error(`Error loading contexts for bot ${botId}:`, err);
    return { baseBrainContext: '', contexts: {} };
  }
}

async function updateContext(botId, key, { classifier, response, section } = {}) {
  try {
    if (key === 'baseBrainContext') {
      await pool.query(
        'UPDATE bots SET base_brain_context = ? WHERE id = ?',
        [response || '', botId]
      );
    } else {
      const sec = section || 'general';
      const cls = classifier || '';
      const resp = response || '';

      await pool.query(
        'INSERT INTO ai_commands (command, classifier, response, section, bot_id) VALUES (?, ?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE classifier = VALUES(classifier), response = VALUES(response), section = VALUES(section)',
        [key, cls, resp, sec, botId]
      );
    }
    return true;
  } catch (err) {
    console.error(`Error updating context for bot ${botId}:`, err);
    return false;
  }
}

async function deleteContext(botId, command) {
  try {
    await pool.query('DELETE FROM ai_commands WHERE command = ? AND bot_id = ?', [command, botId]);
    return true;
  } catch (err) {
    console.error(`Error deleting context for bot ${botId}:`, err);
    return false;
  }
}

async function getClassifierContext(botId, command) {
  try {
    let [rows] = await pool.query(
      'SELECT classifier FROM ai_commands WHERE command = ? AND bot_id = ?',
      [command, botId]
    );
    if (rows.length === 0) {
      [rows] = await pool.query(
        'SELECT classifier FROM ai_commands WHERE command = ? AND bot_id = ?',
        ['/start', botId]
      );
    }
    return rows[0]?.classifier || '';
  } catch (err) {
    console.error(`Error getting classifier context for bot ${botId}:`, err);
    return '';
  }
}

async function getResponseContext(botId, command, userId = null) {
  try {
    const [bots] = await pool.query(
      'SELECT base_brain_context FROM bots WHERE id = ?',
      [botId]
    );
    const baseContext = bots[0]?.base_brain_context || '';

    let [cmdRes] = await pool.query(
      'SELECT response FROM ai_commands WHERE command = ? AND bot_id = ?',
      [command, botId]
    );
    if (cmdRes.length === 0) {
      [cmdRes] = await pool.query(
        'SELECT response FROM ai_commands WHERE command = ? AND bot_id = ?',
        ['/start', botId]
      );
    }
    const commandResponse = cmdRes[0]?.response || '';

    // Get user context if userId is provided
    let userContext = '';
    if (userId) {
      const [userRows] = await pool.query(
        'SELECT user_context FROM users WHERE user_id = ?',
        [String(userId)]
      );
      userContext = userRows[0]?.user_context || '';
    }

    console.log(`[DEBUG] getResponseContext botId=${botId} command=${command} userId=${userId}`);
    console.log(`[DEBUG] Base Context Found: ${!!baseContext}, Length: ${baseContext.length}`);
    console.log(`[DEBUG] Command Response Found: ${!!commandResponse}, Length: ${commandResponse.length}`);
    console.log(`[DEBUG] User Context Found: ${!!userContext}, Length: ${userContext.length}`);

    // Assemble final context: baseContext + commandResponse + userContext
    let finalContext = `${baseContext}\n---\n${commandResponse}`;
    if (userContext) {
      finalContext += `\n---\nКонтекст пользователя:\n${userContext}`;
    }

    return finalContext;
  } catch (err) {
    console.error(`Error getting response context for bot ${botId}:`, err);
    return '';
  }
}

module.exports = {
  migrateFromJSON,
  loadContexts,
  updateContext,
  deleteContext,
  getClassifierContext,
  getResponseContext,
};
