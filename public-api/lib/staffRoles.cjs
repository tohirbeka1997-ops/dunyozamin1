'use strict';

/**
 * Staff app roles — aligned with Electron rpcDispatch ROLE_RULES.
 *
 *   admin / manager / sales : full staff surface (incl. web orders, purchasing)
 *   cashier                 : floor POS — sales, returns, shifts, customers,
 *                             products (read, no cost), daily report.
 *                             NO web orders, suppliers, purchase orders, expenses.
 */
const STAFF_ALLOWED_ROLES = new Set(['admin', 'manager', 'sales', 'cashier']);

/** Areas blocked for cashier (match desktop POS floor operator matrix). */
const CASHIER_DENIED_AREAS = new Set([
  'orders',
  'purchaseOrders',
  'suppliers',
  'expenses',
  'cost',
]);

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

function isStaffRoleAllowed(role) {
  return STAFF_ALLOWED_ROLES.has(normalizeRole(role));
}

/**
 * @param {string} role
 * @param {string} area  e.g. 'orders' | 'sales' | 'cost' | 'purchaseOrders'
 */
function staffCanAccessArea(role, area) {
  const r = normalizeRole(role);
  if (!isStaffRoleAllowed(r)) return false;
  if (r === 'cashier' && CASHIER_DENIED_AREAS.has(String(area || ''))) return false;
  return true;
}

/** Express middleware — call after staffAuth. */
function requireStaffArea(area) {
  return function staffAreaGuard(req, res, next) {
    if (!staffCanAccessArea(req.staffUser?.role, area)) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Bu bo‘lim uchun ruxsat yo‘q',
      });
      return;
    }
    next();
  };
}

module.exports = {
  STAFF_ALLOWED_ROLES,
  CASHIER_DENIED_AREAS,
  isStaffRoleAllowed,
  staffCanAccessArea,
  requireStaffArea,
};
