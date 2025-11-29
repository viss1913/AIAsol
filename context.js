const { pool } = require('./db');
const fs = require('fs');
const path = require('path');

// --- Migration Helper ---
async function migrateFromJSON() {
  try {
    console.log('🚀 Checking contexts.json for migration/update...');
    const filePath = path.join(__dirname, 'contexts.json');
    if (!fs.existsSync(filePath)) {
      console.log('⚠️ contexts.json not found, skipping.');
      return;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // 1. Save Base Context (Always Update)
    if (data.baseBrainContext) {
      await pool.query(
        'INSERT INTO ai_globals (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        ['baseBrainContext', data.baseBrainContext]
      );
      console.log('✅ Global context updated from JSON.');
    }

    // 2. Save Commands (Always Update/Insert)
    if (data.contexts) {
      let count = 0;
      for (const [cmd, ctx] of Object.entries(data.contexts)) {
        await pool.query(
          'INSERT INTO ai_commands (command, classifier, response, section) VALUES (?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE classifier = VALUES(classifier), response = VALUES(response), section = VALUES(section)',
          [cmd, ctx.classifier || '', ctx.response || '', ctx.section || 'general']
        );
        count++;
      }
      console.log(`✅ Synced ${count} commands from JSON to MySQL.`);
    }
  } catch (err) {
    console.error('❌ Migration error:', err);
  }
}

// --- Public API ---

async function loadContexts() {
  try {
    const [globals] = await pool.query(
      'SELECT value FROM ai_globals WHERE `key` = ?',
      ['baseBrainContext']
    );
    const baseBrainContext = globals[0]?.value || '';

    const [commands] = await pool.query('SELECT * FROM ai_commands');
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
    console.error('Error loading contexts from DB:', err);
    return { baseBrainContext: '', contexts: {} };
  }
}

async function updateContext(key, { classifier, response, section } = {}) {
  try {
    if (key === 'baseBrainContext') {
      await pool.query(
        'INSERT INTO ai_globals (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        ['baseBrainContext', response || '']
      );
    } else {
      const sec = section || 'general';
      const cls = classifier || '';
      const resp = response || '';

      await pool.query(
        'INSERT INTO ai_commands (command, classifier, response, section) VALUES (?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE classifier = VALUES(classifier), response = VALUES(response), section = VALUES(section)',
        [key, cls, resp, sec]
      );
    }

    // --- Опциональный синк в contexts.json ---
    try {
      const filePath = path.join(__dirname, 'contexts.json');
      if (fs.existsSync(filePath)) {
        const jsonRaw = fs.readFileSync(filePath, 'utf8');
        const jsonData = JSON.parse(jsonRaw);

        if (key === 'baseBrainContext') {
          jsonData.baseBrainContext = response || '';
        } else {
          if (!jsonData.contexts) jsonData.contexts = {};
          if (!jsonData.contexts[key]) {
            jsonData.contexts[key] = {
              classifier: '',
              response: '',
              section: section || 'general',
            };
          }
          if (classifier !== undefined) {
            jsonData.contexts[key].classifier = classifier || '';
          }
          if (response !== undefined) {
            jsonData.contexts[key].response = response || '';
          }
          if (section) {
            jsonData.contexts[key].section = section;
          }
        }

        fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
      }
    } catch (fsErr) {
      console.error('Error syncing to contexts.json:', fsErr);
    }
    // -----------------------------

    return true;
  } catch (err) {
    console.error('Error updating context:', err);
    return false;
  }
}

async function deleteContext(command) {
  try {
    await pool.query('DELETE FROM ai_commands WHERE command = ?', [command]);
    return true;
  } catch (err) {
    console.error('Error deleting context:', err);
    return false;
  }
}

async function getClassifierContext(command) {
  try {
    let [rows] = await pool.query(
      'SELECT classifier FROM ai_commands WHERE command = ?',
      [command]
    );
    if (rows.length === 0) {
      [rows] = await pool.query(
        'SELECT classifier FROM ai_commands WHERE command = ?',
        ['/start']
      );
    }
    return rows[0]?.classifier || '';
  } catch (err) {
    console.error('Error getting classifier context:', err);
    return '';
  }
}

async function getResponseContext(command) {
  try {
    const [globals] = await pool.query(
      'SELECT value FROM ai_globals WHERE `key` = ?',
      ['baseBrainContext']
    );
    const baseContext = globals[0]?.value || '';

    let [cmdRes] = await pool.query(
      'SELECT response FROM ai_commands WHERE command = ?',
      [command]
    );
    if (cmdRes.length === 0) {
      [cmdRes] = await pool.query(
        'SELECT response FROM ai_commands WHERE command = ?',
        ['/start']
      );
    }
    const commandResponse = cmdRes[0]?.response || '';

    return `${baseContext}\n---\n${commandResponse}`;
  } catch (err) {
    console.error('Error getting response context:', err);
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
