const { canAccessBot, canAccessProject, getBotById, getProjectById, verifyAdminCredentials } = require('./platform');

function sendUnauthorized(res, message = 'Authentication required.') {
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
  return res.status(401).send(message);
}

function parseBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  const encoded = authHeader.split(' ')[1];
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }

  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1)
  };
}

function matchEnvAdmin(credentials) {
  const envUser = process.env.ADMIN_USER;
  const envPass = process.env.ADMIN_PASS;
  if (!envUser || !envPass || !credentials) {
    return false;
  }
  return credentials.username === envUser && credentials.password === envPass;
}

async function authenticateAdmin(req, res, next) {
  const credentials = parseBasicAuth(req.headers.authorization);
  if (!credentials) {
    return sendUnauthorized(res);
  }

  // Fallback auth via env vars for bootstrap/recovery.
  if (matchEnvAdmin(credentials)) {
    req.admin = {
      id: 0,
      username: credentials.username,
      role: 'super_admin'
    };
    return next();
  }

  try {
    const admin = await verifyAdminCredentials(credentials.username, credentials.password);
    if (!admin) {
      return sendUnauthorized(res, 'Invalid credentials.');
    }

    req.admin = admin;
    return next();
  } catch (error) {
    console.error('authenticateAdmin error:', error);
    return res.status(500).json({ error: 'Failed to authenticate admin' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.admin || req.admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  return next();
}

async function requireProjectAccess(req, res, next) {
  const projectId = Number(req.params.id || req.params.projectId || req.body.projectId);
  if (!projectId) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  const project = await getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const allowed = await canAccessProject(req.admin, projectId);
  if (!allowed) {
    return res.status(403).json({ error: 'Access denied for this project' });
  }

  req.projectId = projectId;
  req.project = project;
  return next();
}

async function requireBotAccess(req, res, next) {
  const botId = Number(req.params.id || req.params.botId || req.body.botId);
  if (!botId) {
    return res.status(400).json({ error: 'Bot id is required' });
  }

  const bot = await getBotById(botId);
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  const allowed = await canAccessBot(req.admin, botId);
  if (!allowed) {
    return res.status(403).json({ error: 'Access denied for this bot' });
  }

  req.botId = botId;
  req.bot = bot;
  return next();
}

module.exports = {
  authenticateAdmin,
  parseBasicAuth,
  requireBotAccess,
  requireProjectAccess,
  requireSuperAdmin
};
