'use strict';

const { verifyStaffAccessToken } = require('../lib/staffJwt.cjs');
const { isAdminRoleAllowed } = require('../lib/adminRoles.cjs');

// Admin panel uchun auth middleware. Staff JWT mashinasini qayta ishlatadi,
// lekin faqat admin/manager rollariga ruxsat beradi.
function createAdminAuth() {
  return function adminAuth(req, res, next) {
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
      if (!isAdminRoleAllowed(role)) {
        res.status(403).json({ error: 'forbidden', message: 'Admin or manager role required' });
        return;
      }

      req.adminUser = { id: userId, role, tenant };
      next();
    } catch {
      res.status(401).json({ error: 'invalid_token' });
    }
  };
}

// Faqat 'admin' roli uchun (manager ruxsati yo'q joylar uchun).
function requireAdmin(req, res, next) {
  if (req.adminUser && req.adminUser.role === 'admin') {
    next();
    return;
  }
  res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
}

module.exports = { createAdminAuth, requireAdmin };
