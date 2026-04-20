'use strict';

const { verifyAccessToken } = require('../lib/jwtUtil.cjs');

function createBearerAuth() {
  return function bearerAuth(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthorized', message: 'Bearer token required' });
      return;
    }
    try {
      const payload = verifyAccessToken(header.slice(7));
      const customerId = Number(payload.sub);
      if (!Number.isFinite(customerId) || customerId <= 0) {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
      req.customerId = customerId;
      next();
    } catch {
      res.status(401).json({ error: 'invalid_token' });
    }
  };
}

module.exports = { createBearerAuth };
