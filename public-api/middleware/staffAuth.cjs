'use strict';

const { verifyStaffAccessToken } = require('../lib/staffJwt.cjs');
const { isStaffRoleAllowed } = require('../lib/staffRoles.cjs');

function createStaffAuth() {
  return function staffAuth(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthorized', message: 'Bearer token required' });
      return;
    }
    try {
      const payload = verifyStaffAccessToken(header.slice(7));
      const userId = String(payload.sub || '').trim();
      const role = String(payload.role || '').trim().toLowerCase();
      const tenant = String(payload.tenant || 'default').trim().toLowerCase();

      if (!userId) {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
      if (!isStaffRoleAllowed(role)) {
        res.status(403).json({
          error: 'forbidden',
          message: 'Staff role required (admin, manager, sales, cashier)',
        });
        return;
      }

      req.staffUser = { id: userId, role, tenant };
      next();
    } catch {
      res.status(401).json({ error: 'invalid_token' });
    }
  };
}

module.exports = { createStaffAuth };
