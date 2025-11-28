require('dotenv').config();

/**
 * Simple HTTP Basic Auth middleware for Express.
 * Reads ADMIN_USER and ADMIN_PASS from .env.
 */
module.exports = function (req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
        return res.status(401).send('Authentication required.');
    }

    // Header format: "Basic base64(username:password)"
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [user, pass] = credentials.split(':');

    const ADMIN_USER = process.env.ADMIN_USER || '';
    const ADMIN_PASS = process.env.ADMIN_PASS || '';

    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        return next();
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Invalid credentials.');
};
